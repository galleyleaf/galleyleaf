// Reads the book from Firestore. Only approved users pass the security rules.
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase.js";

let metaPromise = null;
const chapters = new Map();

function cacheGet(id) {
  try {
    const raw = sessionStorage.getItem(`book:${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function cacheSet(id, value) {
  try {
    sessionStorage.setItem(`book:${id}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** @returns {Promise<{ title, author, dedication, chapters: { id, title, order, paragraphCount }[] }>} */
export function loadMeta() {
  if (!metaPromise) {
    const cached = cacheGet("meta");
    metaPromise = cached
      ? Promise.resolve(cached)
      : getDoc(doc(db, "book", "meta")).then((snap) => {
          if (!snap.exists()) throw new Error("book-missing");
          const meta = snap.data();
          meta.chapters = [...(meta.chapters || [])].sort((a, b) => a.order - b.order);
          cacheSet("meta", meta);
          return meta;
        });
    metaPromise.catch(() => (metaPromise = null));
  }
  return metaPromise;
}

/** @returns {Promise<{ id, title, order, paragraphs: string[], breaks: number[] }>} */
export async function loadChapter(id) {
  if (chapters.has(id)) return chapters.get(id);
  let chapter = cacheGet(`ch:${id}`);
  if (!chapter) {
    const snap = await getDoc(doc(db, "chapters", id));
    if (!snap.exists()) throw new Error("chapter-missing");
    chapter = { id, ...snap.data() };
    cacheSet(`ch:${id}`, chapter);
  }
  chapters.set(id, chapter);
  return chapter;
}

export function clearBookCache() {
  metaPromise = null;
  chapters.clear();
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("book:"))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
