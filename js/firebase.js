// Firebase initialization. SDK is loaded as ES modules from the official CDN (no bundler).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
