import { type FirebaseApp, type FirebaseOptions, getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

let firebaseApp: FirebaseApp | null = null;

const getFirebaseConfig = (): FirebaseOptions => {
  const config: FirebaseOptions = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Missing Firebase configuration values: ${missing.join(", ")}`);
  }

  return config;
};

export const getFirebaseApp = (): FirebaseApp => {
  if (firebaseApp) {
    return firebaseApp;
  }
  if (typeof window === "undefined") {
    throw new Error("Firebase app is only available in the browser");
  }

  firebaseApp = getApps().length ? getApp() : initializeApp(getFirebaseConfig());
  return firebaseApp;
};

export const getFirebaseAuth = (): Auth => {
  if (typeof window === "undefined") {
    throw new Error("Firebase auth is only available in the browser");
  }
  return getAuth(getFirebaseApp());
};
