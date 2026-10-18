// Fallback web app config, used only for local previews. A deployed site reads
// its config from Firebase Hosting (/__/firebase/init.json) and ignores this file.
// To preview locally against your project, fill it in from:
//   npx -y firebase-tools@latest apps:sdkconfig WEB --project <PROJECT_ID>
// These values aren't secret: Firebase web config is public by design, and the
// security rules protect the data.
export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};
