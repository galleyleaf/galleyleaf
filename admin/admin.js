// Admin-only: manage reader access and read (or remove) every reader's comments.
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "../js/firebase.js";
import { ensureProfile, signIn, whenRulesReady } from "../js/auth.js";
import { renderAccount } from "../js/account-menu.js";
import { showSiteVersion } from "../js/site-version.js";
import "../js/theme.js";
import { loadChapter, loadMeta } from "../js/book.js";
import { getCommentsSeen, setCommentsSeen } from "../js/comments.js";
import { REACTIONS } from "../js/reactions.js";

const $ = (id) => document.getElementById(id);

const state = {
  me: null,
  users: new Map(), // uid -> profile
  comments: [], // { id, uid, chapterId, paragraphIndex, text, createdAt, updatedAt }
  reactions: [], // { chapterId, marks } per reader and chapter
  chapters: new Map(), // chapterId -> { title, order }
  paragraphs: new Map(), // chapterId -> string[] (HTML)
  seenAt: 0, // comments created after this (ms) are marked new; read once per page load
  unsubs: [],
};

/* ---------- Helpers ---------- */

function status(message, isError = false) {
  const s = $("status");
  s.textContent = message;
  s.classList.toggle("is-error", isError);
  s.hidden = false;
}

let toastTimer = 0;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

function formatDate(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function plainText(html) {
  return new DOMParser().parseFromString(html || "", "text/html").body.textContent;
}

function excerpt(html, max = 160) {
  const text = plainText(html);
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function displayName(uid) {
  const u = state.users.get(uid);
  return u?.displayName || u?.email || "Unknown reader";
}

function avatar(profile) {
  const name = profile.displayName || profile.email || "?";
  if (profile.photoURL) {
    const img = document.createElement("img");
    img.className = "person-avatar";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.src = profile.photoURL;
    return img;
  }
  const span = document.createElement("span");
  span.className = "person-avatar";
  span.setAttribute("aria-hidden", "true");
  span.textContent = name.trim().charAt(0).toUpperCase();
  return span;
}

/* ---------- Access ---------- */

onAuthStateChanged(auth, async (user) => {
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
  $("content").hidden = true;

  renderAccount(user, null);
  if (!user) {
    status("Sign in with the admin account to manage readers.");
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Sign in with Google";
    btn.style.marginTop = "0.75rem";
    btn.onclick = () => signIn().catch(() => status("Sign-in didn’t finish. Try again.", true));
    $("status").append(document.createElement("br"), btn);
    return;
  }

  try {
    const profile = await whenRulesReady(() => ensureProfile(user), () =>
      status("Your site is getting ready. Right after setup this can take a few minutes. This page opens by itself."));
    renderAccount(user, profile);
    if (profile.admin !== true) {
      status(`${user.email} isn’t an admin. Sign in with the admin email you gave during setup, or in the Firestore console set admin: true on users/${user.uid}, then reload this page.`, true);
      return;
    }
  } catch {
    status("Your account couldn’t be checked. Reload the page to try again.", true);
    return;
  }

  state.me = user.uid;
  state.seenAt = getCommentsSeen(user.uid).at;
  $("status").hidden = true;
  $("content").hidden = false;
  showSiteVersion();

  try {
    const meta = await loadMeta();
    if (meta.title) document.querySelectorAll("[data-book-title]").forEach((n) => (n.textContent = meta.title));
    meta.chapters.forEach((c) => state.chapters.set(c.id, c));
  } catch {
    /* book not published yet: comments will show chapter ids */
  }

  state.unsubs.push(
    onSnapshot(
      collection(db, "users"),
      (snap) => {
        state.users = new Map(snap.docs.map((d) => [d.id, d.data()]));
        renderPeople();
        renderComments();
      },
      () => status("Readers couldn’t be loaded. Check that the latest security rules are deployed.", true)
    ),
    onSnapshot(
      collectionGroup(db, "comments"),
      (snap) => {
        state.comments = snap.docs.map((d) => ({ id: d.id, uid: d.ref.parent.parent.id, ...d.data() }));
        state.comments.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        // Everything listed now counts as seen for the account menu's badge and the next visit.
        const newest = state.comments[0]?.createdAt?.toMillis?.() ?? 0;
        setCommentsSeen(user.uid, { count: state.comments.length, at: Math.max(newest, getCommentsSeen(user.uid).at) });
        loadExcerpts().then(renderComments);
        renderComments();
      },
      () => status("Comments couldn’t be loaded. Check that the latest security rules are deployed.", true)
    ),
    onSnapshot(
      collectionGroup(db, "reactions"),
      (snap) => {
        state.reactions = snap.docs.map((d) => ({ chapterId: d.id, marks: d.data().marks }));
        loadExcerpts().then(renderReactions);
        renderReactions();
      },
      () => status("Reactions couldn’t be loaded. Check that the latest security rules are deployed.", true)
    )
  );
});

/* ---------- Readers ---------- */

async function setApproved(uid, approved, button) {
  button.disabled = true;
  try {
    await updateDoc(doc(db, "users", uid), { approved });
    toast(approved ? `${displayName(uid)} approved` : `Access removed for ${displayName(uid)}`);
  } catch {
    toast("That change wasn’t saved. Check your connection and try again.");
    button.disabled = false;
  }
}

function personRow(uid, profile, action) {
  const li = document.createElement("li");
  li.className = "person";

  const info = document.createElement("div");
  info.className = "person-info";
  const name = document.createElement("p");
  name.className = "person-name";
  name.textContent = profile.displayName || profile.email || uid;
  const meta = document.createElement("p");
  meta.className = "person-meta";
  const since = profile.createdAt?.toDate ? `Signed up ${formatDate(profile.createdAt)}` : "";
  meta.textContent = [profile.email, since].filter(Boolean).join(", ");
  info.append(name, meta);

  const actions = document.createElement("div");
  actions.className = "person-actions";
  if (action) actions.append(action);

  li.append(avatar(profile), info, actions);
  return li;
}

function renderPeople() {
  const all = [...state.users.entries()];
  const pending = all
    .filter(([, u]) => u.approved !== true)
    .sort(([, a], [, b]) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
  const approved = all
    .filter(([, u]) => u.approved === true)
    .sort(([, a], [, b]) => (a.displayName || a.email || "").localeCompare(b.displayName || b.email || ""));

  $("pending-list").replaceChildren(
    ...pending.map(([uid, u]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = "Approve";
      btn.addEventListener("click", () => setApproved(uid, true, btn));
      return personRow(uid, u, btn);
    })
  );
  $("pending-empty").hidden = pending.length > 0;
  $("pending-count").textContent = pending.length;
  $("pending-count").classList.toggle("is-alert", pending.length > 0);

  $("reader-list").replaceChildren(
    ...approved.map(([uid, u]) => {
      let btn = null;
      if (uid !== state.me && u.admin !== true) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-quiet";
        btn.textContent = "Remove access";
        btn.addEventListener("click", () => {
          if (confirm(`Remove access for ${displayName(uid)}? They’ll see an “access paused” screen until you approve them again. Their comments are kept.`)) {
            setApproved(uid, false, btn);
          }
        });
      }
      return personRow(uid, u, btn);
    })
  );
  $("readers-empty").hidden = approved.length > 0;
  $("readers-count").textContent = approved.length;

  renderReaderFilter();
}

/* ---------- Comments ---------- */

async function loadExcerpts() {
  // Only chapters of the published book: a comment's chapterId is chosen by the reader,
  // so unknown ids would each cost a read.
  const needed = [...new Set([...state.comments, ...state.reactions].map((c) => c.chapterId))].filter(
    (id) => state.chapters.has(id) && !state.paragraphs.has(id)
  );
  await Promise.all(
    needed.map(async (id) => {
      try {
        state.paragraphs.set(id, (await loadChapter(id)).paragraphs);
      } catch {
        state.paragraphs.set(id, []);
      }
    })
  );
}

function chapterTitle(id) {
  return state.chapters.get(id)?.title || id;
}

function renderReaderFilter() {
  const select = $("filter-reader");
  const current = select.value;
  const uids = [...new Set(state.comments.map((c) => c.uid))].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  select.replaceChildren(new Option("All readers", ""), ...uids.map((uid) => new Option(displayName(uid), uid)));
  select.value = uids.includes(current) ? current : "";
}

function renderChapterFilter() {
  const select = $("filter-chapter");
  const current = select.value;
  const ids = [...new Set(state.comments.map((c) => c.chapterId))].sort(
    (a, b) => (state.chapters.get(a)?.order ?? 999) - (state.chapters.get(b)?.order ?? 999)
  );
  select.replaceChildren(new Option("All chapters", ""), ...ids.map((id) => new Option(chapterTitle(id), id)));
  select.value = ids.includes(current) ? current : "";
}

const isNew = (c) => (c.createdAt?.toMillis?.() ?? 0) > state.seenAt;

function renderComments() {
  renderChapterFilter();
  renderReaderFilter();

  const chapter = $("filter-chapter").value;
  const reader = $("filter-reader").value;
  const list = state.comments.filter((c) => (!chapter || c.chapterId === chapter) && (!reader || c.uid === reader));

  $("comments-count").textContent = state.comments.length;
  const fresh = state.comments.filter(isNew).length;
  $("comments-new").hidden = !fresh;
  $("comments-new").textContent = `${fresh} new`;
  $("comments-empty").hidden = list.length > 0;
  $("comments-empty").textContent = state.comments.length ? "No comments match these filters." : "No comments yet.";

  $("comment-list").replaceChildren(
    ...list.map((c) => {
      const li = document.createElement("li");
      li.className = "admin-comment";
      li.classList.toggle("is-new", isNew(c));

      const head = document.createElement("div");
      head.className = "admin-comment-head";
      const who = document.createElement("strong");
      who.textContent = displayName(c.uid);
      const where = document.createElement("span");
      where.textContent = `${chapterTitle(c.chapterId)}, paragraph ${c.paragraphIndex + 1}`;
      const when = document.createElement("span");
      when.textContent = formatDate(c.createdAt);
      const open = document.createElement("a");
      open.href = `../#/read/${encodeURIComponent(c.chapterId)}/${c.paragraphIndex + 1}`;
      open.textContent = "Open paragraph";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "link-btn link-danger";
      del.textContent = "Delete";
      del.addEventListener("click", () => removeComment(c, del));
      if (isNew(c)) {
        const tag = document.createElement("span");
        tag.className = "new-tag";
        tag.textContent = "New";
        head.append(tag);
      }
      head.append(who, where, when, open, del);

      li.append(head);

      const paragraph = state.paragraphs.get(c.chapterId)?.[c.paragraphIndex];
      if (paragraph) {
        const quote = document.createElement("blockquote");
        quote.className = "admin-comment-quote";
        quote.textContent = excerpt(paragraph);
        li.append(quote);
      }

      const text = document.createElement("p");
      text.className = "admin-comment-text";
      text.textContent = c.text;
      li.append(text);
      return li;
    })
  );
}

async function removeComment(c, button) {
  if (!confirm(`Delete this comment by ${displayName(c.uid)}? This can’t be undone.`)) return;
  button.disabled = true;
  try {
    await deleteDoc(doc(db, "users", c.uid, "comments", c.id));
    toast("Comment deleted");
  } catch {
    toast("The comment wasn’t deleted. Check your connection and try again.");
    button.disabled = false;
  }
}

/* ---------- Reactions ---------- */

const MAX_REACTION_ROWS = 50;

// One row per paragraph with its tally, for chapters still in the book.
function reactionRows() {
  const rows = new Map();
  for (const { chapterId, marks } of state.reactions) {
    if (!state.chapters.has(chapterId)) continue;
    for (const [key, kind] of Object.entries(marks)) {
      if (!REACTIONS.some((r) => r.id === kind)) continue;
      const id = `${chapterId}/${key}`;
      if (!rows.has(id)) rows.set(id, { chapterId, paragraphIndex: Number(key), tally: {}, total: 0 });
      const row = rows.get(id);
      row.tally[kind] = (row.tally[kind] || 0) + 1;
      row.total++;
    }
  }
  return [...rows.values()];
}

function renderReactionFilters(rows) {
  const chapter = $("filter-reaction-chapter");
  const current = chapter.value;
  const ids = [...new Set(rows.map((r) => r.chapterId))].sort(
    (a, b) => state.chapters.get(a).order - state.chapters.get(b).order
  );
  chapter.replaceChildren(new Option("All chapters", ""), ...ids.map((id) => new Option(chapterTitle(id), id)));
  chapter.value = ids.includes(current) ? current : "";
}

function renderReactions() {
  const rows = reactionRows();
  renderReactionFilters(rows);

  const chapter = $("filter-reaction-chapter").value;
  const kind = $("filter-reaction-kind").value;
  const score = (r) => (kind ? r.tally[kind] : r.total);
  const list = rows
    .filter((r) => (!chapter || r.chapterId === chapter) && (!kind || r.tally[kind]))
    .sort((a, b) =>
      score(b) - score(a)
      || state.chapters.get(a.chapterId).order - state.chapters.get(b.chapterId).order
      || a.paragraphIndex - b.paragraphIndex
    );

  $("reactions-count").textContent = rows.reduce((sum, r) => sum + r.total, 0);
  $("reactions-empty").hidden = list.length > 0;
  $("reactions-empty").textContent = rows.length ? "No reactions match these filters." : "No reactions yet.";
  $("reactions-more").hidden = list.length <= MAX_REACTION_ROWS;
  $("reactions-more").textContent = `Showing the ${MAX_REACTION_ROWS} paragraphs with the most reactions, out of ${list.length}.`;

  $("reaction-list").replaceChildren(
    ...list.slice(0, MAX_REACTION_ROWS).map((r) => {
      const li = document.createElement("li");
      li.className = "admin-comment";

      const head = document.createElement("div");
      head.className = "admin-comment-head";
      const where = document.createElement("strong");
      where.textContent = `${chapterTitle(r.chapterId)}, paragraph ${r.paragraphIndex + 1}`;
      const open = document.createElement("a");
      open.href = `../#/read/${encodeURIComponent(r.chapterId)}/${r.paragraphIndex + 1}`;
      open.textContent = "Open paragraph";
      head.append(where, open);
      li.append(head);

      const paragraph = state.paragraphs.get(r.chapterId)?.[r.paragraphIndex];
      if (paragraph) {
        const quote = document.createElement("blockquote");
        quote.className = "admin-comment-quote";
        quote.textContent = excerpt(paragraph);
        li.append(quote);
      }

      const tally = document.createElement("ul");
      tally.className = "reaction-tally";
      for (const { id, label } of REACTIONS) {
        if (!r.tally[id]) continue;
        const item = document.createElement("li");
        const count = document.createElement("strong");
        count.textContent = r.tally[id];
        item.append(`${label} `, count);
        tally.append(item);
      }
      li.append(tally);
      return li;
    })
  );
}

$("filter-reaction-kind").append(...REACTIONS.map((r) => new Option(r.label, r.id)));
$("filter-reaction-chapter").addEventListener("change", renderReactions);
$("filter-reaction-kind").addEventListener("change", renderReactions);
$("filter-chapter").addEventListener("change", renderComments);
$("filter-reader").addEventListener("change", renderComments);
