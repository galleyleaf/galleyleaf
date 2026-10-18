// Private paragraph comments stored at users/{uid}/comments/{commentId}.
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase.js";

export const MAX_COMMENT = 2000;

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

export function addComment(uid, chapterId, paragraphIndex, text) {
  return addDoc(commentsRef(uid), {
    chapterId,
    paragraphIndex,
    text,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function updateComment(uid, commentId, text) {
  return updateDoc(doc(db, "users", uid, "comments", commentId), {
    text,
    updatedAt: serverTimestamp(),
  });
}

export function deleteComment(uid, commentId) {
  return deleteDoc(doc(db, "users", uid, "comments", commentId));
}
