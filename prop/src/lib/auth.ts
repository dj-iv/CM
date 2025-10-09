import type { NextRequest } from "next/server";
import { getAdminAuth } from "./firebaseAdmin";

export interface AuthContext {
  uid: string;
  email?: string;
  displayName?: string;
}

const BEARER_PREFIX = "bearer ";

export const extractTokenFromHeader = (authorizationHeader: string | null | undefined): string | null => {
  if (!authorizationHeader) {
    return null;
  }
  const trimmed = authorizationHeader.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toLowerCase().startsWith(BEARER_PREFIX)) {
    return trimmed.slice(BEARER_PREFIX.length).trim();
  }
  return null;
};

export const resolveBearerToken = (request: NextRequest): string | null => {
  const headerToken = extractTokenFromHeader(request.headers.get("authorization"));
  if (headerToken) {
    return headerToken;
  }
  return request.cookies.get("__session")?.value ?? null;
};

export const verifyFirebaseToken = async (token: string): Promise<AuthContext> => {
  const auth = getAdminAuth();
  const decoded = await auth.verifyIdToken(token, true);
  return {
    uid: decoded.uid,
    email: decoded.email ?? undefined,
    displayName: decoded.name ?? undefined,
  };
};
