// Local, per-user reading state: progress, bookmarks, completed chapters and preferences.
// Everything is wrapped in try/catch so the app still works when storage is unavailable.

let uid = "anon";

export function setStorageUser(id) {
  uid = id || "anon";
}

function key(name) {
  return `reader:${uid}:${name}`;
}

function read(name, fallback) {
  try {
    const raw = localStorage.getItem(key(name));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(name, value) {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    /* storage full or blocked: progress just won't persist */
  }
}

/* ---------- Progress ---------- */

// progress = { [chapterId]: { last: index, furthest: index } }
export function getProgress(chapterId) {
  const all = read("progress", {});
  return all[chapterId] || { last: 0, furthest: 0 };
}

export function getAllProgress() {
  return read("progress", {});
}

export function saveProgress(chapterId, index) {
  const all = read("progress", {});
  const prev = all[chapterId] || { last: 0, furthest: 0 };
  all[chapterId] = { last: index, furthest: Math.max(prev.furthest, index) };
  write("progress", all);
  write("last", { chapterId, index, at: Date.now() });
}

export function getLastPosition() {
  return read("last", null);
}

/* ---------- Completed chapters ---------- */

export function getCompleted() {
  return new Set(read("completed", []));
}

export function markCompleted(chapterId) {
  const done = getCompleted();
  const isNew = !done.has(chapterId);
  done.add(chapterId);
  write("completed", [...done]);
  return isNew;
}

/* ---------- Bookmarks ---------- */

// bookmarks = [{ chapterId, index, excerpt, createdAt }]
export function getBookmarks() {
  return read("bookmarks", []);
}

export function isBookmarked(chapterId, index) {
  return getBookmarks().some((b) => b.chapterId === chapterId && b.index === index);
}

export function toggleBookmark(chapterId, index, excerpt) {
  const list = getBookmarks();
  const at = list.findIndex((b) => b.chapterId === chapterId && b.index === index);
  if (at >= 0) {
    list.splice(at, 1);
  } else {
    list.push({ chapterId, index, excerpt, createdAt: Date.now() });
  }
  write("bookmarks", list);
  return at < 0;
}

export function removeBookmark(chapterId, index) {
  write(
    "bookmarks",
    getBookmarks().filter((b) => !(b.chapterId === chapterId && b.index === index))
  );
}

/* ---------- Preferences (not per user) ---------- */

export function getPref(name, fallback) {
  try {
    const v = localStorage.getItem(`reader:pref:${name}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function setPref(name, value) {
  try {
    localStorage.setItem(`reader:pref:${name}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}
