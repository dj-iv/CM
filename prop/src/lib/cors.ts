import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set<string>([
  "http://localhost:8080",
  "http://localhost:3000",
  "https://prop.uctel.co.uk",
]);

const ALLOWED_METHODS = ["GET", "POST", "PUT", "OPTIONS", "HEAD"];
const DEFAULT_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Accept",
  "Origin",
];

const normalizeOrigin = (origin: string | null): string | null => {
  if (!origin) {
    return null;
  }
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return origin;
  }
};

const resolveAllowedOrigin = (origin: string | null): string | null => {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return null;
  }

  if (ALLOWED_ORIGINS.has(normalizedOrigin) || normalizedOrigin.endsWith("uctel.co.uk")) {
    return normalizedOrigin;
  }

  return null;
};

const mergeAllowedHeaders = (requested: string | null | undefined) => {
  const seen = new Map<string, string>();

  if (requested) {
    requested.split(",").forEach((header) => {
      const trimmed = header.trim();
      if (trimmed) {
        seen.set(trimmed.toLowerCase(), trimmed);
      }
    });
  }

  DEFAULT_ALLOWED_HEADERS.forEach((header) => {
    const lower = header.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, header);
    }
  });

  return Array.from(seen.values()).join(", ");
};

export const withCors = <T>(
  response: NextResponse<T>,
  origin: string | null,
  requestHeaders?: string | null,
  allowPrivateNetwork = false,
) => {
  const allowOrigin = resolveAllowedOrigin(origin);
  if (!allowOrigin) {
    return response;
  }

  response.headers.set("Access-Control-Allow-Origin", allowOrigin);
  response.headers.set("Vary", "Origin");
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS.join(", "));
  response.headers.set("Access-Control-Allow-Headers", mergeAllowedHeaders(requestHeaders));
  response.headers.set("Access-Control-Expose-Headers", "Content-Disposition");
  response.headers.set("Access-Control-Max-Age", "86400");
  if (allowPrivateNetwork) {
    response.headers.set("Access-Control-Allow-Private-Network", "true");
  }
  return response;
};

export const handleCorsPreflight = (request: NextRequest) => {
  const origin = request.headers.get("Origin");
  const allowOrigin = resolveAllowedOrigin(origin);
  if (!allowOrigin) {
    return new NextResponse(null, { status: 403 });
  }

  const response = new NextResponse(null, { status: 204 });
  const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
  const allowPrivateNetwork = request.headers.get("Access-Control-Request-Private-Network") === "true";
  return withCors(response, allowOrigin, requestedHeaders, allowPrivateNetwork);
};
