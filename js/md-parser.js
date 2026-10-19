// Parses the Pandoc-flavoured book.md into sections of paragraphs.
// Supported: YAML front matter (title, author), ::: fenced divs (copyright, dedication),
// "# " headings as sections, "---" scene breaks, _italic_ / *italic* and **bold**.

export const PLACEHOLDER = /^\[[A-Z0-9 _-]+\]$/;

export function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function inlineToHtml(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w*])\*([^*\n]+?)\*(?=[^\w*]|$)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_([^_\n]+?)_(?=[^\w]|$)/g, "$1<em>$2</em>");
}

export function slugify(title, used) {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section";
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function unquote(value) {
  const v = value.trim();
  return /^".*"$|^'.*'$/.test(v) ? v.slice(1, -1) : v;
}

/**
 * @returns {{ title: string, author: string, dedication: string,
 *   sections: { id: string, title: string, order: number, paragraphs: string[], breaks: number[] }[] }}
 */
export function parseBook(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const book = { title: "", author: "", dedication: "", sections: [] };
  let i = 0;

  // YAML front matter
  if (lines[0]?.trim() === "---") {
    for (i = 1; i < lines.length && lines[i].trim() !== "---"; i++) {
      const m = lines[i].match(/^(\w+):\s*(.*)$/);
      if (m && (m[1] === "title" || m[1] === "author")) book[m[1]] = unquote(m[2]);
    }
    i++;
  }

  const used = new Set();
  let section = null;
  let buffer = [];
  let pendingBreak = false;
  let fence = null; // { cls, lines }

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    buffer = [];
    if (!text || !section) return;
    if (pendingBreak && section.paragraphs.length) section.breaks.push(section.paragraphs.length);
    pendingBreak = false;
    section.paragraphs.push(inlineToHtml(text));
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (fence) {
      if (trimmed === ":::") {
        if (fence.cls === "dedication") {
          const text = fence.lines.join(" ").trim();
          if (text && !PLACEHOLDER.test(text)) book.dedication = inlineToHtml(text);
        }
        fence = null;
      } else {
        fence.lines.push(trimmed);
      }
      continue;
    }

    const fenceOpen = trimmed.match(/^:::\s*\{\.([\w-]+)/);
    if (fenceOpen) {
      flush();
      fence = { cls: fenceOpen[1], lines: [] };
      continue;
    }

    const heading = line.match(/^#\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      section = {
        id: slugify(heading[1], used),
        title: heading[1],
        order: book.sections.length,
        paragraphs: [],
        breaks: [],
      };
      book.sections.push(section);
      pendingBreak = false;
      continue;
    }

    if (/^(\s*[-*_]\s*){3,}$/.test(trimmed)) {
      flush();
      pendingBreak = true;
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }

    buffer.push(trimmed);
  }
  flush();

  return dropEmptySections(book);
}

// Drops sections that are empty or contain only an unfilled placeholder such as "[ACKNOWLEDGMENTS]".
export function dropEmptySections(book) {
  book.sections = book.sections
    .filter((s) => s.paragraphs.length && !s.paragraphs.every((p) => /^\[[^\]]+\]( \[[^\]]+\])*$/.test(p)))
    .map((s, order) => ({ ...s, order }));
  return book;
}
