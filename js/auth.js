// Google sign-in plus the access flag stored in users/{uid}.approved.
// New accounts are approved on creation; admins can remove access later.
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db, googleProvider } from "./firebase.js";

// The security rules only accept Google-hosted profile photos (or none).
const GOOGLE_PHOTO = /^https:\/\/lh3\.googleusercontent\.com\//;

export async function signIn() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return;
    throw err;
  }
}

export function signOut() {
  return fbSignOut(auth);
}

/**
 * Watches auth + the user's profile document and reports one of:
 *   { state: "signed-out" }
 *   { state: "pending", user, profile }
 *   { state: "approved", user, profile }
 *   { state: "error", user, error }
 */
export function watchAccess(callback) {
  let unsubProfile = null;

  getRedirectResult(auth).catch((error) => callback({ state: "error", user: null, error }));

  return onAuthStateChanged(auth, (user) => {
    unsubProfile?.();
    unsubProfile = null;

    if (!user) {
      callback({ state: "signed-out" });
      return;
    }

    const ref = doc(db, "users", user.uid);
    let creating = false;

    unsubProfile = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          // First login: create the profile. New accounts start approved; the
          // snapshot fires again once the document exists.
          if (creating) return;
          creating = true;
          setDoc(ref, {
            displayName: (user.displayName || "").slice(0, 100),
            email: user.email || "",
            photoURL: GOOGLE_PHOTO.test(user.photoURL || "") && user.photoURL.length <= 500 ? user.photoURL : "",
            approved: true,
            admin: false,
            createdAt: serverTimestamp(),
          }).catch((error) => callback({ state: "error", user, error }));
          return;
        }
        const profile = snap.data();
        callback({ state: profile.approved === true ? "approved" : "pending", user, profile });
      },
      (error) => callback({ state: "error", user, error })
    );
  });
}
