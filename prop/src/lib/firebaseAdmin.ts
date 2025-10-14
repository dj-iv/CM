import { readFileSync } from "node:fs";
import path from "node:path";
import { App, cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let cachedApp: App | null = null;
let cachedFloorplanApp: App | null = null;

type ServiceAccountBasis = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

const applyNewlineFix = (value: string): string => value.replace(/\\n/g, "\n");

const loadCredentialFromEnv = (prefix: string): ServiceAccountBasis | null => {
  const projectId = process.env[`${prefix}_PROJECT_ID`];
  const clientEmail = process.env[`${prefix}_CLIENT_EMAIL`];
  const rawPrivateKey = process.env[`${prefix}_PRIVATE_KEY`];

  if (!projectId || !clientEmail || !rawPrivateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey: applyNewlineFix(rawPrivateKey),
  };
};

const readCredentialFile = (credentialPath: string, contextLabel: string): ServiceAccountBasis | null => {
  const resolvedPath = path.isAbsolute(credentialPath) ? credentialPath : path.resolve(process.cwd(), credentialPath);
  try {
    const fileContents = readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(fileContents) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };

    if (!parsed?.project_id || !parsed?.client_email || !parsed?.private_key) {
      console.warn("firebaseAdmin: service account file missing required fields", resolvedPath);
      return null;
    }

    const basis = {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: applyNewlineFix(parsed.private_key),
    };
    console.info(`firebaseAdmin: loaded ${contextLabel} credentials from`, resolvedPath);
    return basis;
  } catch (error) {
    console.warn(`firebaseAdmin: failed to read service account file for ${contextLabel}`, credentialPath, error);
    return null;
  }
};

interface ResolveOptions {
  prefix: string;
  description: string;
  fallbackFiles?: string[];
  optional?: boolean;
}

const resolveServiceAccount = ({ prefix, description, fallbackFiles = [], optional = false }: ResolveOptions): ServiceAccountBasis | null => {
  const fromEnv = loadCredentialFromEnv(prefix);
  if (fromEnv) {
    return fromEnv;
  }

  const environmentFileKeys = [`${prefix}_GOOGLE_APPLICATION_CREDENTIALS`];
  if (prefix === "FIREBASE") {
    environmentFileKeys.push("GOOGLE_APPLICATION_CREDENTIALS");
  }
  const aliasPrefix = prefix.replace(/_?FIREBASE$/, "");
  if (aliasPrefix && aliasPrefix !== prefix) {
    environmentFileKeys.push(`${aliasPrefix}_GOOGLE_APPLICATION_CREDENTIALS`);
  }

  for (const key of environmentFileKeys) {
    const candidatePath = process.env[key];
    if (candidatePath) {
      const basis = readCredentialFile(candidatePath, `${description} (env path)`);
      if (basis) {
        return basis;
      }
    }
  }

  for (const fallback of fallbackFiles) {
    const basis = readCredentialFile(fallback, `${description} (fallback)`);
    if (basis) {
      return basis;
    }
  }

  if (optional) {
    console.warn(`firebaseAdmin: no ${description} credentials configured; falling back to default app`);
    return null;
  }

  throw new Error(
    `Firebase Admin credentials are not configured for ${description}. Set ${prefix}_PROJECT_ID, ${prefix}_CLIENT_EMAIL, and ${prefix}_PRIVATE_KEY or provide a ${prefix}_GOOGLE_APPLICATION_CREDENTIALS JSON file.`,
  );
};

let defaultCredentialCache: ServiceAccountBasis | null = null;
let floorplanCredentialCache: ServiceAccountBasis | null | undefined;

const getDefaultCredential = (): ServiceAccountBasis => {
  if (!defaultCredentialCache) {
    const resolved = resolveServiceAccount({
      prefix: "FIREBASE",
      description: "default Firebase Admin",
      fallbackFiles: [path.join(process.cwd(), "proposal-5823c-firebase-adminsdk-fbsvc-056fa946bd.json")],
    });
    if (!resolved) {
      throw new Error("Failed to resolve default Firebase Admin credentials");
    }
    defaultCredentialCache = resolved;
  }
  return defaultCredentialCache;
};

const getFloorplanCredential = (): ServiceAccountBasis | null => {
  if (floorplanCredentialCache !== undefined) {
    return floorplanCredentialCache;
  }

  floorplanCredentialCache = resolveServiceAccount({
    prefix: "FLOORPLAN_FIREBASE",
    description: "floorplan Firebase Admin",
    fallbackFiles: [
      path.join(process.cwd(), "..", "plan", "floorplan-service-account.json"),
      path.join(process.cwd(), "..", "plan", "plan-service-account.json"),
      path.join(process.cwd(), "..", "plan", "plan-firebase-adminsdk.json"),
    ],
    optional: true,
  });

  if (floorplanCredentialCache) {
    console.info("firebaseAdmin: resolved floorplan credentials for project", floorplanCredentialCache.projectId);
  }

  return floorplanCredentialCache;
};

const buildCredential = (basis: ServiceAccountBasis) =>
  cert({
    projectId: basis.projectId,
    clientEmail: basis.clientEmail,
    privateKey: basis.privateKey,
  });

export const getFirebaseAdminApp = (): App => {
  if (cachedApp) {
    return cachedApp;
  }

  const apps = getApps();
  if (apps.length) {
    cachedApp = apps[0];
    return cachedApp;
  }

  cachedApp = initializeApp({
    credential: buildCredential(getDefaultCredential()),
  });

  return cachedApp;
};

const getFloorplanFirebaseAdminApp = (): App => {
  if (cachedFloorplanApp) {
    return cachedFloorplanApp;
  }

  const credential = getFloorplanCredential();
  if (!credential) {
    console.info("firebaseAdmin: using default Firebase app for floorplan Firestore");
    cachedFloorplanApp = getFirebaseAdminApp();
    return cachedFloorplanApp;
  }

  try {
    cachedFloorplanApp = getApp("floorplan");
    console.info("firebaseAdmin: reusing existing floorplan Firebase app", credential.projectId);
    return cachedFloorplanApp;
  } catch {
    cachedFloorplanApp = initializeApp({
      credential: buildCredential(credential),
    }, "floorplan");
    console.info("firebaseAdmin: initialised floorplan Firebase app", credential.projectId);
    return cachedFloorplanApp;
  }
};

export const getAdminAuth = () => getAuth(getFirebaseAdminApp());
export const getAdminFirestore = () => getFirestore(getFirebaseAdminApp());
export const getFloorplanFirestore = () => getFirestore(getFloorplanFirebaseAdminApp());
