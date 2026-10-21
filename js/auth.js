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

// Right after setup, the security rules can take several minutes to reach the
// new database, which refuses everything until then. A signed-in user may
// always read their own profile, so "permission-denied" on it means the site
// isn't ready yet: wait and try again rather than fail.
const READY_TIMEOUT = 10 * 60 * 1000;
const notReady = (error) => error?.code === "permission-denied";
const nextDelay = (delay) => Math.min(delay * 1.5, 15000);

/** Runs `fn`, retrying while the rules aren't ready. Calls `onWaiting` each time. */
export async function whenRulesReady(fn, onWaiting) {
  const started = Date.now();
  for (let delay = 3000; ; delay = nextDelay(delay)) {
    try {
      return await fn();
    } catch (error) {
      if (!notReady(error) || Date.now() - started > READY_TIMEOUT) throw error;
      onWaiting?.();
      await new Promise((r) => setTimeout(r, delay));
    }
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
 *   { state: "starting", user }   the site is still getting ready after setup
 *   { state: "pending", user, profile }
 *   { state: "approved", user, profile }
 *   { state: "error", user, error }
 */
export function watchAccess(callback) {
  let unsubProfile = null;
  let retryTimer = null;

  getRedirectResult(auth).catch((error) => callback({ state: "error", user: null, error }));

  return onAuthStateChanged(auth, (user) => {
    unsubProfile?.();
    unsubProfile = null;
    clearTimeout(retryTimer);

    if (!user) {
      callback({ state: "signed-out" });
      return;
    }

    const ref = doc(db, "users", user.uid);
    const started = Date.now();
    let delay = 3000;
    let creating = false;
    let reported = null; // the profile last passed to callback, as JSON

    const subscribe = () => {
      reported = null; // a new listener reports its first profile, even if unchanged
      unsubProfile = onSnapshot(
        ref,
        { includeMetadataChanges: true },
        (snap) => {
          // A profile this tab just created shows up first as a local write.
          // The security rules can't see it until the server confirms it, so
          // reading the book now would be refused: wait for that confirmation.
          if (snap.metadata.hasPendingWrites) return;
          if (!snap.exists()) {
            // First login: create the profile. The snapshot fires again once
            // the document exists.
            if (creating) return;
            creating = true;
            whenRulesReady(() => ensureProfile(user), () => callback({ state: "starting", user }))
              .catch((error) => callback({ state: "error", user, error }));
            return;
          }
          const profile = snap.data();
          // Metadata changes (going offline and back) repeat the same profile.
          const json = JSON.stringify(profile);
          if (json === reported) return;
          reported = json;
          callback({ state: profile.approved === true ? "approved" : "pending", user, profile });
        },
        (error) => {
          // A refused listener stops, so listen again once the rules are ready.
          if (notReady(error) && Date.now() - started < READY_TIMEOUT) {
            callback({ state: "starting", user });
            retryTimer = setTimeout(subscribe, delay);
            delay = nextDelay(delay);
            return;
          }
          callback({ state: "error", user, error });
        }
      );
    };
    subscribe();
  });
}
