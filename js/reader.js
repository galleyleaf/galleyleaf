// One-paragraph-at-a-time reader, bookmarks, comment sheet and chapter completion.
import { loadChapter, loadMeta } from "./book.js";
import { addComment, deleteComment, updateComment, watchChapterComments, MAX_COMMENT } from "./comments.js";
import { getPref, getProgress, isBookmarked, markCompleted, saveProgress, setPref, toggleBookmark } from "./storage.js";
import { confetti } from "./celebrate.js";

const $ = (id) => document.getElementById(id);

const el = {
  chapter: $("reader-chapter"),
  track: $("reader-track"),
  fill: $("track-fill"),
  star: $("track-star"),
  count: $("reader-count"),
  stage: $("reader-stage"),
  passage: $("passage"),
  sceneBreak: $("scene-break"),
  text: $("passage-text"),
  flow: $("scroll-flow"),
  view: $("view-reader"),
  modeBtn: $("btn-view-mode"),
  prev: $("btn-prev"),
  next: $("btn-next"),
  nextLabel: $("next-label"),
  bookmark: $("btn-bookmark"),
  comment: $("btn-comment"),
  badge: $("comment-badge"),
  // comments sheet
  dialog: $("comment-dialog"),
  sub: $("comment-sub"),
  quote: $("comment-quote"),
  list: $("comment-list"),
  empty: $("comments-empty"),
  form: $("comment-form"),
  input: $("comment-text"),
  charCount: $("char-count"),
  save: $("btn-save-comment"),
  cancelEdit: $("btn-cancel-edit"),
  error: $("comment-error"),
  // celebration
  celebrate: $("celebrate-dialog"),
  celebrateTitle: $("celebrate-title"),
  celebrateText: $("celebrate-text"),
  canvas: $("confetti-canvas"),
  nextChapter: $("btn-next-chapter"),
};

const state = {
  uid: null,
  chapter: null,
  index: 0,
  comments: new Map(),
  unsubComments: null,
  editingId: null,
  token: 0,
  toast: () => {},
  // Scroll view
  mode: "paragraph", // "paragraph" | "scroll"
  flowFor: null, // chapter id the scroll flow was built for
  flowEls: [], // paragraph elements by index
  ignoreScrollUntil: 0, // skip scroll tracking while we scroll programmatically
};

// The paragraph crossing this fraction of the viewport height is the active one.
const READING_LINE = 0.35;

/* ---------- Helpers ---------- */

// Paragraphs are escaped at publish time; only <em>/<strong> are allowed through.
function safeHtml(html) {
  return String(html).replace(/<[^>]*>/g, (tag) =>
    /^<\/?(em|strong)>$/.test(tag) ? tag : tag.replace(/</g, "&lt;").replace(/>/g, "&gt;")
  );
}

function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = safeHtml(html);
  return div.textContent;
}

function excerpt(html, max = 140) {
  const text = plainText(html);
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function formatDate(ts) {
  const date = ts?.toDate ? ts.toDate() : new Date();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------- Public API ---------- */

export function initReader({ uid, toast }) {
  state.uid = uid;
  state.toast = toast;
}

export function closeReader() {
  state.unsubComments?.();
  state.unsubComments = null;
  state.chapter = null;
  state.comments = new Map();
  if (el.dialog.open) el.dialog.close();
  if (el.celebrate.open) el.celebrate.close();
}

/** Opens a chapter at a 0-based paragraph index. */
export async function openChapter(chapterId, index) {
  const token = ++state.token;
  const sameChapter = state.chapter?.id === chapterId;
  if (!sameChapter) {
    el.chapter.textContent = "";
    el.text.textContent = "";
    el.count.textContent = "";
  }

  const chapter = await loadChapter(chapterId);
  if (token !== state.token) return;

  if (!sameChapter) {
    state.unsubComments?.();
    state.comments = new Map();
    state.chapter = chapter;
    state.flowFor = null;
    state.unsubComments = watchChapterComments(
      state.uid,
      chapterId,
      (byParagraph) => {
        state.comments = byParagraph;
        renderCommentState();
        renderFlowNotes();
        if (el.dialog.open) renderCommentList();
      },
      () => state.toast("Comments couldn’t be loaded. Check your connection and reopen the chapter.")
    );
  }

  const last = chapter.paragraphs.length - 1;
  const target = Number.isInteger(index) ? index : getProgress(chapterId).last;
  go(Math.min(Math.max(target, 0), last), 0, { instant: true });
}

export function isReading() {
  return Boolean(state.chapter);
}

/* ---------- Rendering ---------- */

/**
 * Makes `index` the current paragraph. In paragraph view it is shown alone;
 * in scroll view it is highlighted and (unless scroll: false) scrolled to.
 */
function go(index, direction, { scroll = true, instant = false } = {}) {
  const { chapter } = state;
  if (!chapter) return;
  state.index = index;
  const total = chapter.paragraphs.length;
  const isLast = index === total - 1;

  el.chapter.textContent = chapter.title;

  const pct = total > 1 ? (index / (total - 1)) * 100 : 100;
  el.fill.style.width = `${pct}%`;
  el.star.style.left = `${pct}%`;
  el.track.setAttribute("aria-valuemax", String(total));
  el.track.setAttribute("aria-valuenow", String(index + 1));
  el.track.setAttribute("aria-valuetext", `Paragraph ${index + 1} of ${total}`);
  el.count.textContent = `${index + 1} of ${total}`;

  el.prev.disabled = index === 0;
  el.nextLabel.textContent = isLast ? "Finish" : "Next";
  el.next.classList.toggle("is-finish", isLast);

  const marked = isBookmarked(chapter.id, index);
  el.bookmark.setAttribute("aria-pressed", String(marked));
  el.bookmark.setAttribute("aria-label", marked ? "Remove bookmark" : "Bookmark this paragraph");
  renderCommentState();

  if (state.mode === "scroll") {
    buildFlow();
    highlight(index);
    if (scroll) scrollToParagraph(index, instant);
  } else {
    el.text.innerHTML = safeHtml(chapter.paragraphs[index]);
    el.sceneBreak.hidden = !(chapter.breaks || []).includes(index);
    el.stage.scrollTop = 0;
    if (direction && !reducedMotion()) {
      el.passage.classList.remove("enter-next", "enter-prev");
      void el.passage.offsetWidth; // restart the animation
      el.passage.classList.add(direction > 0 ? "enter-next" : "enter-prev");
    }
  }

  saveProgress(chapter.id, index);
  history.replaceState(null, "", `#/read/${encodeURIComponent(chapter.id)}/${index + 1}`);
}

function renderCommentState() {
  const count = state.comments.get(state.index)?.length || 0;
  el.comment.classList.toggle("has-comments", count > 0);
  el.badge.hidden = count === 0;
  el.badge.textContent = count > 9 ? "9+" : String(count);
  el.comment.setAttribute(
    "aria-label",
    count ? `Comments on this paragraph (${count})` : "Add a comment to this paragraph"
  );
}

/* ---------- Scroll view ---------- */

function sceneBreakEl() {
  const div = document.createElement("div");
  div.className = "scene-break";
  div.setAttribute("aria-hidden", "true");
  div.innerHTML = '<svg><use href="#i-star"/></svg>'.repeat(3);
  return div;
}

// Renders the whole chapter once per chapter; later calls are no-ops.
function buildFlow() {
  const { chapter } = state;
  if (state.flowFor === chapter.id) return;

  const breaks = new Set(chapter.breaks || []);
  const nodes = [];
  state.flowEls = chapter.paragraphs.map((html, i) => {
    if (breaks.has(i)) nodes.push(sceneBreakEl());
    const p = document.createElement("p");
    p.className = "flow-p";
    p.dataset.index = String(i);
    p.innerHTML = safeHtml(html);
    nodes.push(p);
    return p;
  });

  const end = document.createElement("div");
  end.className = "flow-end";
  const note = document.createElement("p");
  note.textContent = `End of ${chapter.title}`;
  const finish = document.createElement("button");
  finish.type = "button";
  finish.className = "btn btn-primary";
  finish.textContent = "Finish chapter";
  finish.addEventListener("click", () => {
    go(state.flowEls.length - 1, 0, { scroll: false });
    completeChapter();
  });
  end.append(note, finish);

  el.flow.replaceChildren(...nodes, end);
  state.flowFor = chapter.id;
  renderFlowNotes();
}

function highlight(index) {
  el.flow.querySelector(".flow-p.is-active")?.classList.remove("is-active");
  el.flow.querySelector('.flow-p[aria-current="true"]')?.removeAttribute("aria-current");
  const p = state.flowEls[index];
  if (!p) return;
  p.classList.add("is-active");
  p.setAttribute("aria-current", "true");
}

// Puts the paragraph's top just above the reading line.
function scrollToParagraph(index, instant) {
  const p = state.flowEls[index];
  if (!p) return;
  const top = Math.max(0, p.offsetTop - el.stage.clientHeight * (READING_LINE - 0.05));
  const smooth = !instant && !reducedMotion();
  state.ignoreScrollUntil = performance.now() + (smooth ? 900 : 100);
  el.stage.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
}

function paragraphAtReadingLine() {
  const { stage } = el;
  const last = state.flowEls.length - 1;
  if (stage.scrollTop <= 2) return 0;
  if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2) return last;
  const line = stage.scrollTop + stage.clientHeight * READING_LINE;
  let active = 0;
  for (let i = 0; i <= last; i++) {
    if (state.flowEls[i].offsetTop > line) break;
    active = i;
  }
  return active;
}

// Gold comment badges on paragraphs that have comments.
function renderFlowNotes() {
  if (state.mode !== "scroll" || !state.chapter || state.flowFor !== state.chapter.id) return;
  state.flowEls.forEach((p, i) => {
    const count = state.comments.get(i)?.length || 0;
    let badge = p.querySelector(".flow-note");
    if (!count) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("button");
      badge.type = "button";
      badge.className = "flow-note";
      badge.innerHTML = '<svg aria-hidden="true"><use href="#i-comment"/></svg><span></span>';
      p.append(badge);
    }
    badge.querySelector("span").textContent = count > 9 ? "9+" : String(count);
    badge.setAttribute("aria-label", `Comments on paragraph ${i + 1} (${count})`);
  });
}

let scrollFrame = 0;
el.stage.addEventListener("scroll", () => {
  if (state.mode !== "scroll" || !state.chapter || scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    if (performance.now() < state.ignoreScrollUntil || state.flowFor !== state.chapter?.id) return;
    const index = paragraphAtReadingLine();
    if (index !== state.index) go(index, 0, { scroll: false });
  });
}, { passive: true });

// Any direct scrolling by the reader takes over from a programmatic scroll.
for (const type of ["wheel", "touchstart", "keydown", "mousedown"]) {
  el.stage.addEventListener(type, () => (state.ignoreScrollUntil = 0), { passive: true });
}

// Tapping a paragraph makes it active and opens its comments.
el.flow.addEventListener("click", (e) => {
  const p = e.target.closest(".flow-p");
  if (!p) return;
  const index = Number(p.dataset.index);
  if (index !== state.index) go(index, 0, { scroll: false });
  openComments();
});
el.passage.addEventListener("click", openComments);

// Discourage copying the book text: no copy, cut, drag or context menu in the
// reading area (selection is also turned off in CSS). Inputs are unaffected.
for (const type of ["copy", "cut", "contextmenu", "dragstart"]) {
  el.stage.addEventListener(type, (e) => e.preventDefault());
}

function setMode(mode) {
  state.mode = mode === "scroll" ? "scroll" : "paragraph";
  el.view.dataset.mode = state.mode;
  el.passage.hidden = state.mode !== "paragraph";
  el.flow.hidden = state.mode !== "scroll";
  el.modeBtn.setAttribute(
    "aria-label",
    state.mode === "scroll" ? "Switch to one paragraph at a time" : "Switch to scrolling view"
  );
}

setMode(getPref("readMode", "paragraph"));

el.modeBtn.addEventListener("click", () => {
  const mode = state.mode === "scroll" ? "paragraph" : "scroll";
  setPref("readMode", mode);
  setMode(mode);
  if (state.chapter) go(state.index, 0, { instant: true });
  state.toast(mode === "scroll" ? "Scrolling view" : "One paragraph at a time");
});

// Text size changes reflow the chapter; keep the active paragraph in place.
$("btn-text-size").addEventListener("click", () => {
  if (state.mode === "scroll" && state.chapter) requestAnimationFrame(() => scrollToParagraph(state.index, true));
});

/* ---------- Navigation ---------- */

function next() {
  if (!state.chapter) return;
  if (state.index < state.chapter.paragraphs.length - 1) go(state.index + 1, 1);
  else completeChapter();
}

function prev() {
  if (state.chapter && state.index > 0) go(state.index - 1, -1);
}

el.next.addEventListener("click", next);
el.prev.addEventListener("click", prev);

el.bookmark.addEventListener("click", () => {
  const { chapter, index } = state;
  if (!chapter) return;
  const added = toggleBookmark(chapter.id, index, excerpt(chapter.paragraphs[index], 120));
  el.bookmark.setAttribute("aria-pressed", String(added));
  el.bookmark.setAttribute("aria-label", added ? "Remove bookmark" : "Bookmark this paragraph");
  state.toast(added ? "Bookmark added" : "Bookmark removed");
});

document.addEventListener("keydown", (e) => {
  if (!state.chapter || document.getElementById("view-reader").hidden) return;
  if (el.dialog.open || el.celebrate.open) return;
  if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "ArrowRight") { e.preventDefault(); next(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
  else if (e.key === "b") el.bookmark.click();
  else if (e.key === "c") openComments();
});

// Horizontal swipe on touch screens.
let touchStart = null;
el.stage.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1) return (touchStart = null);
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
}, { passive: true });
el.stage.addEventListener("touchend", (e) => {
  if (!touchStart || state.mode !== "paragraph") return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  const quick = Date.now() - touchStart.t < 800;
  touchStart = null;
  if (quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx < 0) next();
    else prev();
  }
}, { passive: true });

/* ---------- Completion ---------- */

async function completeChapter() {
  const { chapter } = state;
  markCompleted(chapter.id);

  let following = null;
  try {
    const meta = await loadMeta();
    const pos = meta.chapters.findIndex((c) => c.id === chapter.id);
    following = meta.chapters[pos + 1] || null;
  } catch {
    /* without meta we just offer the library */
  }

  el.celebrateTitle.textContent = following ? "Chapter complete" : "You finished the book";
  el.celebrateText.textContent = following
    ? `You’ve finished ${chapter.title}.`
    : `You’ve read every chapter, ending with ${chapter.title}.`;
  el.nextChapter.hidden = !following;
  if (following) {
    el.nextChapter.textContent = `Start ${following.title}`;
    el.nextChapter.onclick = () => {
      el.celebrate.close();
      location.hash = `#/read/${encodeURIComponent(following.id)}/1`;
    };
  }

  el.celebrate.showModal();
  confetti(el.canvas);
}

el.celebrate.addEventListener("click", (e) => {
  if (e.target.closest("#btn-to-library")) el.celebrate.close();
});

/* ---------- Comments sheet ---------- */

function openComments() {
  const { chapter, index } = state;
  if (!chapter) return;
  el.sub.textContent = `${chapter.title}, paragraph ${index + 1}`;
  el.quote.textContent = excerpt(chapter.paragraphs[index], 220);
  resetForm();
  renderCommentList();
  el.dialog.showModal();
  if (!state.comments.get(index)?.length && window.matchMedia("(hover: hover)").matches) el.input.focus();
}

function renderCommentList() {
  const list = state.comments.get(state.index) || [];
  el.list.replaceChildren(
    ...list.map((c) => {
      const li = document.createElement("li");
      li.className = "comment";
      if (c.id === state.editingId) li.classList.add("is-editing");

      const body = document.createElement("p");
      body.className = "comment-body";
      body.textContent = c.text;

      const foot = document.createElement("div");
      foot.className = "comment-foot";
      const time = document.createElement("span");
      const edited = c.updatedAt && c.createdAt && c.updatedAt.toMillis?.() - c.createdAt.toMillis?.() > 1000;
      time.textContent = formatDate(c.createdAt) + (edited ? " (edited)" : "");

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "link-btn";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => startEdit(c));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "link-btn link-danger";
      del.textContent = "Delete";
      del.addEventListener("click", async () => {
        if (!confirm("Delete this comment? This can’t be undone.")) return;
        try {
          await deleteComment(state.uid, c.id);
          if (state.editingId === c.id) resetForm();
          state.toast("Comment deleted");
        } catch {
          state.toast("The comment couldn’t be deleted. Check your connection and try again.");
        }
      });

      foot.append(time, edit, del);
      li.append(body, foot);
      return li;
    })
  );
  el.empty.hidden = list.length > 0;
}

function startEdit(comment) {
  state.editingId = comment.id;
  el.input.value = comment.text;
  el.save.textContent = "Update comment";
  el.cancelEdit.hidden = false;
  updateCharCount();
  renderCommentList();
  el.input.focus();
}

function resetForm() {
  state.editingId = null;
  el.form.reset();
  el.save.textContent = "Save comment";
  el.cancelEdit.hidden = true;
  el.error.hidden = true;
  updateCharCount();
}

function updateCharCount() {
  el.charCount.textContent = `${el.input.value.length} / ${MAX_COMMENT}`;
}

el.comment.addEventListener("click", openComments);
el.input.addEventListener("input", updateCharCount);
el.cancelEdit.addEventListener("click", () => {
  resetForm();
  renderCommentList();
});
$("btn-close-comments").addEventListener("click", () => el.dialog.close());

// Close the sheet when the backdrop is tapped.
el.dialog.addEventListener("click", (e) => {
  if (e.target === el.dialog) el.dialog.close();
});

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = el.input.value.trim();
  if (!text) return;
  el.save.disabled = true;
  el.error.hidden = true;
  try {
    if (state.editingId) {
      await updateComment(state.uid, state.editingId, text);
      state.toast("Comment updated");
    } else {
      await addComment(state.uid, state.chapter.id, state.index, text);
      state.toast("Comment saved");
    }
    resetForm();
    renderCommentList();
  } catch {
    el.error.textContent = "Your comment wasn’t saved. Check your connection and try again.";
    el.error.hidden = false;
  } finally {
    el.save.disabled = false;
  }
});
