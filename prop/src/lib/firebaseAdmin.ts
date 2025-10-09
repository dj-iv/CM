import { App, cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let cachedApp: App | null = null;

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const buildCredential = () => {
  const projectId = getEnv("FIREBASE_PROJECT_ID");
  const clientEmail = getEnv("FIREBASE_CLIENT_EMAIL");
  const privateKey = getEnv("FIREBASE_PRIVATE_KEY");

  return cert({
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  });
};

export const getFirebaseAdminApp = (): App => {
  if (cachedApp) {
    return cachedApp;
  }

  if (getApps().length) {
    cachedApp = getApp();
    return cachedApp;
  }

  cachedApp = initializeApp({
    credential: buildCredential(),
  });

  return cachedApp;
};

export const getAdminAuth = () => getAuth(getFirebaseAdminApp());
export const getAdminFirestore = () => getFirestore(getFirebaseAdminApp());
