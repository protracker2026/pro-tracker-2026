import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Your web app's Firebase configuration
// TODO: Replace with your actual Firebase project config
const firebaseConfig = {
    apiKey: "AIzaSyAUdLNti2c23tOGH1v7wV0BieVr5u5e4iE",
    authDomain: "pro-tracker-2026.firebaseapp.com",
    projectId: "pro-tracker-2026",
    storageBucket: "pro-tracker-2026.firebasestorage.app",
    messagingSenderId: "700994085401",
    appId: "1:700994085401:web:e214a5a09e972889358088",
    measurementId: "G-YSGXK4M8WZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

export { db, storage };
