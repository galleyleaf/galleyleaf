// Parses a Word .docx manuscript into the same shape as parseBook() in md-parser.js.
// A .docx is a zip of XML parts; the zip is read here and inflated with the browser's
// DecompressionStream, so no library is needed.
// Supported: "Heading 1" paragraphs as sections, the "Title" paragraph as the title,
// an "Author" paragraph or a "Subtitle" like "by Jane Doe" (or the document's author property) as the author,
// a section headed "Dedication" as the dedication, paragraphs such as "***" or "#" and
// horizontal lines as scene breaks, and italic and bold text.

import { PLACEHOLDER, dropEmptySections, escapeHtml, slugify } from "./md-parser.js";

const SCENE_BREAK = /^[*#~⁂•·—–-](\s*[*#~⁂•·—–-])*$/;
const GENERIC_AUTHORS = /^(microsoft office user|user|author|unknown|python-docx)$/i;
// Far more than any manuscript's XML; stops a crafted file from inflating to gigabytes.
const MAX_PART_BYTES = 100 * 1024 * 1024;

/* ---------- Zip ---------- */

// Inflates raw deflate data, giving up once it passes MAX_PART_BYTES.
async function inflate(data) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PART_BYTES) {
      reader.cancel();
      throw new Error("too-large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

async function unzip(buffer, wanted) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not-a-zip");

  const files = {};
  let p = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad-zip");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const unpacked = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const skip = nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + skip;
    if (!wanted.includes(name)) continue;
    if (unpacked > MAX_PART_BYTES) throw new Error("too-large");

    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) files[name] = new TextDecoder().decode(data);
    else if (method === 8) files[name] = await inflate(data);
    else throw new Error("unsupported-zip");
  }
  return files;
}

/* ---------- XML helpers (by local name, so any namespace prefix works) ---------- */

const xml = (text) => (text ? new DOMParser().parseFromString(text, "application/xml") : null);
const kids = (el, name) => [...(el?.children || [])].filter((c) => c.localName === name);
const kid = (el, name) => kids(el, name)[0] || null;
const val = (el) => (el ? [...el.attributes].find((a) => a.localName === "val")?.value ?? "" : null);
// A toggle such as <w:i/> is on unless its value is "0", "false" or "none".
const isOn = (el) => !!el && !/^(0|false|none)$/.test(val(el));

function readStyles(doc) {
  const styles = new Map();
  for (const s of doc ? doc.getElementsByTagNameNS("*", "style") : []) {
    const id = [...s.attributes].find((a) => a.localName === "styleId")?.value;
    if (!id) continue;
    const rPr = kid(s, "rPr");
    styles.set(id, {
      name: (val(kid(s, "name")) || id).toLowerCase(),
      basedOn: val(kid(s, "basedOn")),
      outline: val(kid(kid(s, "pPr"), "outlineLvl")),
      italic: rPr && kid(rPr, "i") ? isOn(kid(rPr, "i")) : null,
      bold: rPr && kid(rPr, "b") ? isOn(kid(rPr, "b")) : null,
    });
  }
  return styles;
}

// Follows a style's basedOn chain and returns the first value `pick` finds.
function inherit(styles, id, pick) {
  for (let i = 0; id && i < 20; i++) {
    const s = styles.get(id);
    if (!s) return null;
    const v = pick(s);
    if (v !== null && v !== undefined) return v;
    id = s.basedOn;
  }
  return null;
}

/* ---------- Paragraphs ---------- */

// A horizontal line drawn as a picture (Word's Horizontal Line, and Pandoc's "---").
const hasRuleShape = (p) => [...p.getElementsByTagName("*")].some((e) => [...e.attributes].some((a) => a.localName === "hr" && a.value === "t"));
// A bottom border without a top one, which Word draws when you type "---" and press Enter.
function hasBottomRule(pPr) {
  const border = kid(pPr, "pBdr");
  return !!kid(border, "bottom") && !kid(border, "top");
}

// Paragraphs of the body in reading order, including those inside tables and content controls.
function bodyParagraphs(el, out = []) {
  for (const c of el.children) {
    if (c.localName === "p") out.push(c);
    else if (["tbl", "tr", "tc", "sdt", "sdtContent", "customXml"].includes(c.localName)) bodyParagraphs(c, out);
  }
  return out;
}

// Text segments of a paragraph's runs, with italic and bold resolved. Deleted text is skipped.
function runs(p, styles, paraStyle) {
  const out = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (c.localName === "r") out.push(run(c));
      else if (!["pPr", "del", "moveFrom", "rPr"].includes(c.localName)) walk(c);
    }
  };
  const run = (r) => {
    const rPr = kid(r, "rPr");
    const charStyle = val(kid(rPr, "rStyle"));
    const flag = (tag, key) => {
      if (kid(rPr, tag)) return isOn(kid(rPr, tag));
      const name = inherit(styles, charStyle, (s) => s.name) || "";
      if (key === "italic" && name === "emphasis") return true;
      if (key === "bold" && name === "strong") return true;
      return !!(inherit(styles, charStyle, (s) => s[key]) ?? inherit(styles, paraStyle, (s) => s[key]));
    };
    let text = "";
    for (const c of r.children) {
      if (c.localName === "t") text += c.textContent;
      else if (c.localName === "tab" || (c.localName === "br" && !/page|column/.test(c.getAttribute("w:type") || ""))) text += " ";
      else if (c.localName === "noBreakHyphen") text += "‑";
    }
    return { text, em: flag("i", "italic"), strong: flag("b", "bold") };
  };
  walk(p);
  return out;
}

function runsToHtml(segments) {
  // Merge neighbouring runs with the same formatting; a run of only spaces joins the one before it.
  const merged = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && (/^\s*$/.test(s.text) || (s.em === last.em && s.strong === last.strong))) last.text += s.text;
    else if (s.text) merged.push({ ...s });
  }
  return merged
    .map(({ text, em, strong }) => {
      const t = escapeHtml(text);
      return (strong ? "<strong>" : "") + (em ? "<em>" : "") + t + (em ? "</em>" : "") + (strong ? "</strong>" : "");
    })
    .join("")
    .replace(/\s+/g, " ")
    // Keep spaces outside the tags, and drop tags left empty.
    .replace(/((?:<(?:em|strong)>)+) /g, " $1")
    .replace(/ ((?:<\/(?:em|strong)>)+)/g, "$1 ")
    .replace(/<(em|strong)>\s*<\/\1>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {ArrayBuffer} buffer the .docx file
 * @param {string} [fileName] used for the title when the document has none
 * @returns {Promise<{ title: string, author: string, dedication: string,
 *   sections: { id: string, title: string, order: number, paragraphs: string[], breaks: number[] }[] }>}
 */
export async function parseDocx(buffer, fileName = "") {
  const parts = await unzip(buffer, ["word/document.xml", "word/styles.xml", "docProps/core.xml"]);
  const doc = xml(parts["word/document.xml"]);
  const body = doc && doc.getElementsByTagNameNS("*", "body")[0];
  if (!body) throw new Error("not-a-docx");
  const styles = readStyles(xml(parts["word/styles.xml"]));
  const core = xml(parts["docProps/core.xml"]);
  const coreValue = (name) => core?.getElementsByTagNameNS("*", name)[0]?.textContent.trim() || "";

  const book = { title: "", author: "", dedication: "", sections: [] };
  const used = new Set();
  let section = null;
  let inDedication = false;
  const dedication = [];
  let pendingBreak = false;

  for (const p of bodyParagraphs(body)) {
    const pPr = kid(p, "pPr");
    const styleId = val(kid(pPr, "pStyle"));
    const styleName = inherit(styles, styleId, (s) => s.name) || "";
    const outline = val(kid(pPr, "outlineLvl")) ?? inherit(styles, styleId, (s) => s.outline);
    const segments = runs(p, styles, styleId);
    const plain = segments.map((s) => s.text).join("").replace(/\s+/g, " ").trim();
    if (/^toc /.test(styleName)) continue;

    if (styleName === "title") {
      if (!book.title && plain) book.title = plain;
      continue;
    }
    if (styleName === "subtitle" || styleName === "author") {
      const by = plain.match(/^by\s+(.+)$/i);
      if (!book.author && (by || styleName === "author")) book.author = by ? by[1] : plain;
      continue;
    }
    if (styleName === "heading 1" || outline === "0") {
      if (!plain) continue;
      pendingBreak = false;
      if (/^dedication$/i.test(plain)) {
        section = null;
        inDedication = true;
        continue;
      }
      inDedication = false;
      section = { id: slugify(plain, used), title: plain, order: book.sections.length, paragraphs: [], breaks: [] };
      book.sections.push(section);
      continue;
    }
    if (!plain) {
      if (section && (hasRuleShape(p) || kid(kid(pPr, "pBdr"), "bottom"))) pendingBreak = true;
      continue;
    }
    if (inDedication) {
      dedication.push(runsToHtml(segments));
      continue;
    }
    if (!section) continue; // Front matter before the first chapter, such as a title page.
    if (SCENE_BREAK.test(plain)) {
      pendingBreak = true;
      continue;
    }
    if (pendingBreak && section.paragraphs.length) section.breaks.push(section.paragraphs.length);
    section.paragraphs.push(runsToHtml(segments));
    pendingBreak = hasBottomRule(pPr);
  }

  const ded = dedication.join(" ");
  if (ded && !PLACEHOLDER.test(ded)) book.dedication = ded;
  if (!book.title) book.title = coreValue("title") || fileName.replace(/\.docx$/i, "");
  if (!book.author && !GENERIC_AUTHORS.test(coreValue("creator"))) book.author = coreValue("creator");
  return dropEmptySections(book);
}
