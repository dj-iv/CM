import { getFirebaseAdminApp } from "@/lib/firebaseAdmin";

export const resolvePdfStorageBucket = (): string | null => {
  const explicitBucket =
    process.env.PDF_STORAGE_BUCKET ||
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

  if (explicitBucket) {
    return explicitBucket;
  }

  try {
    const app = getFirebaseAdminApp();
    const derivedBucket = app?.options?.storageBucket;
    return typeof derivedBucket === "string" && derivedBucket.length > 0 ? derivedBucket : null;
  } catch (error) {
    console.warn("resolvePdfStorageBucket: unable to determine storage bucket from Firebase app", error);
    return null;
  }
};
