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
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db, googleProvider } from "./firebase.js";

// The site owner's email, written to /site.json by setup.sh. The owner's
// profile is created as admin; the security rules check the same address.
async function siteOwnerEmail() {
  try {
    const res = await fetch("/site.json");
    if (res.ok) return String((await res.json()).ownerEmail || "").toLowerCase();
  } catch {
    /* no site.json: nobody is bootstrapped as admin */
  }
  return "";
}

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

/**
 * Returns the user's profile, creating it on first sign-in. New accounts start
 * approved; the site owner's account starts as admin. Every page that needs
 * the profile calls this, so the first sign-in can happen on any of them.
 */
export async function ensureProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const owner = await siteOwnerEmail();
  const profile = {
    displayName: (user.displayName || "").slice(0, 100),
    email: user.email || "",
    photoURL: GOOGLE_PHOTO.test(user.photoURL || "") && user.photoURL.length <= 500 ? user.photoURL : "",
    approved: true,
    admin: !!owner && (user.email || "").toLowerCase() === owner,
    createdAt: serverTimestamp(),
  };
  try {
    await setDoc(ref, profile);
    return profile;
  } catch (err) {
    // Another tab may have created it first; the rules then refuse this write.
    const again = await getDoc(ref);
    if (again.exists()) return again.data();
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
          // First login: create the profile. The snapshot fires again once
          // the document exists.
          if (creating) return;
          creating = true;
          ensureProfile(user).catch((error) => callback({ state: "error", user, error }));
          return;
        }
        const profile = snap.data();
        callback({ state: profile.approved === true ? "approved" : "pending", user, profile });
      },
      (error) => callback({ state: "error", user, error })
    );
  });
}
