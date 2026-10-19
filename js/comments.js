// Private paragraph comments stored at users/{uid}/comments/{commentId}.
// Every create or edit also counts against a daily quota kept at
// users/{uid}/limits/commentWrites, written in the same batch; the security rules
// refuse a comment write that doesn't advance it (see firestore.rules).
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase.js";

export const MAX_COMMENT = 2000;
// Must match MAX_COMMENT_WRITES_PER_DAY in firestore.rules.
export const MAX_COMMENT_WRITES_PER_DAY = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

function commentsRef(uid) {
  return collection(db, "users", uid, "comments");
}

/**
 * Live-subscribes to the user's comments for one chapter.
 * Calls back with a Map(paragraphIndex -> comment[] sorted oldest first).
 */
export function watchChapterComments(uid, chapterId, callback, onError) {
  const q = query(commentsRef(uid), where("chapterId", "==", chapterId));
  return onSnapshot(
    q,
    (snap) => {
      const byParagraph = new Map();
      snap.forEach((d) => {
        const c = { id: d.id, ...d.data() };
        if (!byParagraph.has(c.paragraphIndex)) byParagraph.set(c.paragraphIndex, []);
        byParagraph.get(c.paragraphIndex).push(c);
      });
      for (const list of byParagraph.values()) {
        list.sort((a, b) => (a.createdAt?.toMillis?.() ?? Date.now()) - (b.createdAt?.toMillis?.() ?? Date.now()));
      }
      callback(byParagraph);
    },
    onError
  );
}

// Writes the comment change and the quota counter, which names the comment, together.
// Throws an error with code "quota-exceeded" when today's limit is reached.
async function writeWithQuota(uid, commentRef, write) {
  const quotaRef = doc(db, "users", uid, "limits", "commentWrites");
  const snap = await getDoc(quotaRef);
  const quota = snap.exists() ? snap.data() : null;
  // A minute of margin, so a fast local clock doesn't start a new day the server refuses.
  const newDay = !quota || Date.now() > quota.windowStart.toMillis() + DAY_MS + 60_000;
  if (!newDay && quota.count >= MAX_COMMENT_WRITES_PER_DAY) {
    throw Object.assign(new Error("Daily comment limit reached."), { code: "quota-exceeded" });
  }
  const batch = writeBatch(db);
  batch.set(
    quotaRef,
    newDay
      ? { count: 1, windowStart: serverTimestamp(), commentId: commentRef.id, updatedAt: serverTimestamp() }
      : { count: quota.count + 1, windowStart: quota.windowStart, commentId: commentRef.id, updatedAt: serverTimestamp() }
  );
  write(batch, commentRef);
  await batch.commit();
}

export function addComment(uid, chapterId, paragraphIndex, text) {
  return writeWithQuota(uid, doc(commentsRef(uid)), (batch, ref) =>
    batch.set(ref, {
      chapterId,
      paragraphIndex,
      text,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
}

export function updateComment(uid, commentId, text) {
  return writeWithQuota(uid, doc(db, "users", uid, "comments", commentId), (batch, ref) =>
    batch.update(ref, {
      text,
      updatedAt: serverTimestamp(),
    })
  );
}

export function deleteComment(uid, commentId) {
  return deleteDoc(doc(db, "users", uid, "comments", commentId));
}
