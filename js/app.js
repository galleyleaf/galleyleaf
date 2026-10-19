// App shell: access gate, routing, library screen, theme and text size.
import { signIn, signOut, watchAccess } from "./auth.js";
import { renderAccount } from "./account-menu.js";
import { clearBookCache, loadMeta } from "./book.js";
import { closeReader, initReader, openChapter } from "./reader.js";
import {
  getAllProgress,
  getBookmarks,
  getCompleted,
  getLastPosition,
  getPref,
  removeBookmark,
  setPref,
  setStorageUser,
} from "./storage.js";

const $ = (id) => document.getElementById(id);
const VIEWS = ["loading", "login", "pending", "error", "library", "reader"];
const TEXT_SIZES = 4;

let access = { state: "loading" };

/* ---------- Views ---------- */

function show(view) {
  for (const name of VIEWS) $(`view-${name}`).hidden = name !== view;
  document.body.dataset.view = view;
}

let toastTimer = 0;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  t.classList.remove("is-leaving");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.add("is-leaving");
    setTimeout(() => (t.hidden = true), 250);
  }, 2200);
}

function showError(title, message) {
  $("error-title").textContent = title;
  $("error-message").textContent = message;
  show("error");
}

/* ---------- Theme and text size ---------- */

function effectiveTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  const label = effectiveTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme";
  document.querySelectorAll('[data-action="toggle-theme"]').forEach((b) => b.setAttribute("aria-label", label));
}

function applyTextSize(size) {
  document.documentElement.dataset.size = String(size);
}

applyTheme(getPref("theme", null));
applyTextSize(getPref("textSize", 1));

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(getPref("theme", null)));

$("btn-text-size").addEventListener("click", () => {
  const size = (getPref("textSize", 1) + 1) % TEXT_SIZES;
  setPref("textSize", size);
  applyTextSize(size);
  toast(["Small text", "Medium text", "Large text", "Extra large text"][size]);
});

/* ---------- Global actions ---------- */

document.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "sign-out") {
    signOut();
  } else if (action === "toggle-theme") {
    const theme = effectiveTheme() === "dark" ? "light" : "dark";
    setPref("theme", theme);
    applyTheme(theme);
  }
});

$("btn-sign-in").addEventListener("click", async () => {
  const err = $("login-error");
  err.hidden = true;
  try {
    await signIn();
  } catch (error) {
    err.textContent =
      error.code === "auth/unauthorized-domain"
        ? "Sign-in isn’t enabled for this web address yet. Ask the site owner to add it to Firebase’s authorized domains."
        : "Sign-in didn’t finish. Try again, and allow pop-ups for this site if your browser blocks them.";
    err.hidden = false;
  }
});

$("btn-retry").addEventListener("click", () => {
  clearBookCache();
  if (access.state === "approved") route();
  else location.reload();
});

/* ---------- Library ---------- */

function setBookTitle(title) {
  document.querySelectorAll("[data-book-title]").forEach((n) => (n.textContent = title));
  document.title = title;
}

function chapterHref(id, index) {
  return `#/read/${encodeURIComponent(id)}/${index + 1}`;
}

async function renderLibrary() {
  const message = $("library-message");
  let meta;
  try {
    meta = await loadMeta();
  } catch (error) {
    $("chapter-list").replaceChildren();
    message.hidden = false;
    message.textContent =
      error.message === "book-missing"
        ? "The book hasn’t been published yet. Check back soon."
        : "The library couldn’t be loaded. Check your connection, then reload the page.";
    return;
  }
  message.hidden = true;

  setBookTitle(meta.title || "Book Reader");
  $("book-author").textContent = meta.author ? `by ${meta.author}` : "";
  const dedication = $("book-dedication");
  dedication.hidden = !meta.dedication;
  dedication.textContent = meta.dedication ? new DOMParser().parseFromString(meta.dedication, "text/html").body.textContent : "";

  const progress = getAllProgress();
  const completed = getCompleted();
  const byId = new Map(meta.chapters.map((c) => [c.id, c]));

  // Chapter list
  $("chapter-list").replaceChildren(
    ...meta.chapters.map((c) => {
      const p = progress[c.id];
      const done = completed.has(c.id);
      const read = done ? c.paragraphCount : p ? p.furthest + 1 : 0;
      const resumeAt = p && !(done && p.last >= c.paragraphCount - 1) ? p.last : 0;

      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "chapter";
      a.href = chapterHref(c.id, resumeAt);
      if (done) a.classList.add("is-done");

      const title = document.createElement("span");
      title.className = "chapter-title";
      title.textContent = c.title;

      const meta2 = document.createElement("span");
      meta2.className = "chapter-meta";
      meta2.textContent = done
        ? "Finished"
        : read
          ? `${read} of ${c.paragraphCount} paragraphs read`
          : `${c.paragraphCount} paragraphs`;

      const bar = document.createElement("span");
      bar.className = "chapter-bar";
      const fill = document.createElement("span");
      fill.style.width = `${Math.round((read / c.paragraphCount) * 100)}%`;
      bar.append(fill);

      const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      mark.setAttribute("class", "chapter-mark");
      mark.setAttribute("aria-hidden", "true");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", done ? "#i-check" : "#i-next");
      mark.append(use);

      a.append(title, meta2, bar, mark);
      li.append(a);
      return li;
    })
  );

  // Continue reading
  const last = getLastPosition();
  const card = $("continue-card");
  const lastChapter = last && byId.get(last.chapterId);
  if (lastChapter && !(completed.has(lastChapter.id) && last.index >= lastChapter.paragraphCount - 1)) {
    card.hidden = false;
    card.href = chapterHref(lastChapter.id, last.index);
    $("continue-title").textContent = lastChapter.title;
    $("continue-meta").textContent = `Paragraph ${last.index + 1} of ${lastChapter.paragraphCount}`;
    $("continue-fill").style.width = `${Math.round(((last.index + 1) / lastChapter.paragraphCount) * 100)}%`;
  } else {
    card.hidden = true;
  }

  // Bookmarks
  const bookmarks = getBookmarks()
    .filter((b) => byId.has(b.chapterId))
    .sort((a, b) => byId.get(a.chapterId).order - byId.get(b.chapterId).order || a.index - b.index);
  $("bookmarks-empty").hidden = bookmarks.length > 0;
  $("bookmark-list").replaceChildren(
    ...bookmarks.map((b) => {
      const li = document.createElement("li");
      li.className = "bookmark";
      const a = document.createElement("a");
      a.href = chapterHref(b.chapterId, b.index);
      const where = document.createElement("span");
      where.className = "bookmark-where";
      where.textContent = `${byId.get(b.chapterId).title}, paragraph ${b.index + 1}`;
      const text = document.createElement("span");
      text.className = "bookmark-text";
      text.textContent = b.excerpt;
      a.append(where, text);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-btn bookmark-remove";
      remove.setAttribute("aria-label", `Remove bookmark: ${where.textContent}`);
      remove.innerHTML = '<svg aria-hidden="true"><use href="#i-close"/></svg>';
      remove.addEventListener("click", () => {
        removeBookmark(b.chapterId, b.index);
        renderLibrary();
      });
      li.append(a, remove);
      return li;
    })
  );
}

/* ---------- Routing ---------- */

async function route() {
  if (access.state !== "approved") return;
  const match = location.hash.match(/^#\/read\/([^/]+)(?:\/(\d+))?$/);
  if (!match) {
    closeReader();
    show("library");
    renderLibrary();
    return;
  }
  show("reader");
  const chapterId = decodeURIComponent(match[1]);
  const index = match[2] ? Number(match[2]) - 1 : undefined;
  try {
    await openChapter(chapterId, index);
    $("reader-stage").focus({ preventScroll: true });
  } catch (error) {
    if (error.message === "chapter-missing") {
      toast("That chapter doesn’t exist.");
      location.hash = "#/";
    } else {
      showError("This chapter couldn’t be loaded", "Check your connection and try again.");
    }
  }
}

window.addEventListener("hashchange", route);

/* ---------- Access ---------- */

watchAccess((next) => {
  const prevState = access.state;
  access = next;

  switch (next.state) {
    case "signed-out":
      setStorageUser(null);
      clearBookCache();
      closeReader();
      show("login");
      break;

    case "pending":
      $("pending-email").textContent = next.user.email || next.user.displayName || "your Google account";
      closeReader();
      show("pending");
      break;

    case "approved":
      setStorageUser(next.user.uid);
      initReader({ uid: next.user.uid, toast });
      renderAccount(next.user, next.profile);
      if (prevState !== "approved") {
        if (prevState === "pending") toast("Your access is back on. Welcome!");
        route();
      }
      break;

    case "starting":
      $("loading-message").hidden = false;
      show("loading");
      break;

    case "error":
      if (!next.user) {
        $("login-error").textContent = "Sign-in didn’t finish. Try again.";
        $("login-error").hidden = false;
        show("login");
      } else {
        showError(
          "Your account couldn’t be checked",
          "Reload the page to try again. If this keeps happening, sign out and sign back in."
        );
      }
      break;
  }
});
