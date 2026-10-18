// Test stand-in for firebase-auth.js.
// One fake user; signed-in state is the localStorage flag "mock:signed".

const user = { uid: "u1", email: "reader@example.com", displayName: "Test Reader", photoURL: "" };
let listener = null;

const signedIn = () => localStorage.getItem("mock:signed") === "1";

export const getAuth = () => ({});

export class GoogleAuthProvider {
  setCustomParameters() {}
}

export function onAuthStateChanged(_auth, callback) {
  listener = callback;
  setTimeout(() => callback(signedIn() ? user : null), 30);
  return () => {};
}

export async function signInWithPopup() {
  localStorage.setItem("mock:signed", "1");
  listener?.(user);
}

export const signInWithRedirect = signInWithPopup;
export const getRedirectResult = async () => null;

export async function signOut() {
  localStorage.removeItem("mock:signed");
  listener?.(null);
}
