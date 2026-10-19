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

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Whether this is the site owner's email. Setup writes a SHA-256 hash of the
// lowercased address to /site.json, so the address itself isn't published.
// The owner's profile is created as admin; the security rules check the same
// address.
async function isSiteOwner(email) {
  if (!email) return false;
  try {
    const res = await fetch("/site.json");
    if (!res.ok) return false;
    const { ownerEmailHash } = await res.json();
    return !!ownerEmailHash && ownerEmailHash === (await sha256(email.toLowerCase()));
  } catch {
    return false; // no site.json: nobody is bootstrapped as admin
  }
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
  const owner = await isSiteOwner(user.email);
  const profile = {
    displayName: (user.displayName || "").slice(0, 100),
    email: user.email || "",
    photoURL: GOOGLE_PHOTO.test(user.photoURL || "") && user.photoURL.length <= 500 ? user.photoURL : "",
    approved: true,
    admin: owner,
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
