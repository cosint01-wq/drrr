// Shared Firebase config for the website — same project as the mobile app,
// so a code created in the app can be tracked here, and vice versa.
// Replace these placeholder values with your real Firebase project config
// (Firebase Console > Project Settings > General > Your apps > Web app).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyCjNXsdIv4aG2gsmM0RisO-HUgfECdGtA4",
  authDomain: "dspp-41a43.firebaseapp.com",
  projectId: "dspp-41a43",
  storageBucket: "dspp-41a43.firebasestorage.app",
  messagingSenderId: "835097041899",
  appId: "1:835097041899:web:0b851c9a5cd964223117ae",
  measurementId: "G-8MRF9YKZPW"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// Web SDK persists the signed-in seller across page loads automatically
// (browser localStorage), no extra config needed like the mobile app.
export const auth = getAuth(app);

// Firebase Analytics — the only analytics used on this site (no separate GA
// tag, no third-party trackers). Page views land in the same Firebase
// project/console as the mobile app's analytics. isSupported() guards
// against environments where Analytics can't run (SSR, some private
// browsing modes, ad blockers) so it fails quietly instead of throwing.
export let analytics = null;
isSupported()
  .then((supported) => {
    if (supported) analytics = getAnalytics(app);
  })
  .catch(() => {
    // Analytics unsupported/blocked in this environment — safe to ignore.
  });
