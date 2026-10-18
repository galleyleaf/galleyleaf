// Firebase initialization. SDK is loaded as ES modules from the official CDN (no bundler).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// On Firebase Hosting the project's web config is served at a reserved URL, so a
// deployed site needs no config file. firebase-config.js is the fallback for
// local previews (python3 -m http.server).
async function loadConfig() {
  try {
    const res = await fetch("/__/firebase/init.json");
    if (res.ok) return await res.json();
  } catch {
    /* not on Firebase Hosting */
  }
  return firebaseConfig;
}

export const app = initializeApp(await loadConfig());
export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
