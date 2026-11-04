// Private paragraph reactions, one document per reader and chapter at
// users/{uid}/reactions/{chapterId}: marks maps a paragraph index to a reaction.
// Only the reader and admins can see them, as with comments.
import {
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase.js";

// Each id has an icon, #i-{id}, in index.html. Must match isReactionKind in firestore.rules.
export const REACTIONS = [
  { id: "loved", label: "Loved it" },
  { id: "funny", label: "Funny" },
  { id: "moved", label: "Moved" },
  { id: "confused", label: "Confused" },
  { id: "dragging", label: "Dragging" },
];

function reactionsRef(uid, chapterId) {
  return doc(db, "users", uid, "reactions", chapterId);
}

/**
 * Live-subscribes to the user's reactions for one chapter.
 * Calls back with a Map(paragraphIndex -> reaction id).
 */
export function watchChapterReactions(uid, chapterId, callback, onError) {
  return onSnapshot(
    reactionsRef(uid, chapterId),
    (snap) => {
      const marks = snap.exists() ? snap.data().marks : {};
      callback(new Map(Object.entries(marks).map(([index, id]) => [Number(index), id])));
    },
    onError
  );
}

// Sets the reaction on a paragraph, or removes it when `reaction` is null.
// `last` names the paragraph for the security rules, which can't loop over `marks`.
export function setReaction(uid, chapterId, paragraphIndex, reaction) {
  const key = String(paragraphIndex);
  return setDoc(
    reactionsRef(uid, chapterId),
    { marks: { [key]: reaction ?? deleteField() }, last: key, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
