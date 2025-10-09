import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyFirebaseToken, resolveBearerToken, UnauthorizedDomainError } from "@/lib/auth";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BulkActionSchema = z.object({
  slugs: z.array(z.string().min(1).max(120)).min(1).max(200),
  action: z.enum(["delete", "archive", "unarchive", "set-expiry", "clear-expiry"]),
  expiresAt: z.union([z.string().min(1), z.null()]).optional(),
});

const parseExpiresAt = (value: unknown): Date | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date;
};

const ensureAuth = async (request: NextRequest, origin: string | null) => {
  const token = resolveBearerToken(request);
  if (!token) {
    return { error: withCors(NextResponse.json({ error: "Authentication required" }, { status: 401 }), origin) };
  }
  try {
    const context = await verifyFirebaseToken(token);
    return { context };
  } catch (error) {
    if (error instanceof UnauthorizedDomainError) {
      console.warn("Unauthorized domain attempted to access bulk proposal endpoint", error.email);
      return {
        error: withCors(
          NextResponse.json({ error: "Access restricted to uctel.co.uk accounts" }, { status: 403 }),
          origin,
        ),
      };
    }
    console.error("Failed to verify Firebase token", error);
    return { error: withCors(NextResponse.json({ error: "Invalid authentication token" }, { status: 401 }), origin) };
  }
};

export const POST = async (request: NextRequest) => {
  const requestOrigin = request.headers.get("origin");
  const { context, error } = await ensureAuth(request, requestOrigin);
  if (error || !context) {
    return error;
  }

  let body: z.infer<typeof BulkActionSchema>;
  try {
    const json = await request.json();
    body = BulkActionSchema.parse(json);
  } catch (parseError) {
    console.error("Invalid bulk action payload", parseError);
    return withCors(NextResponse.json({ error: "Invalid request body" }, { status: 400 }), requestOrigin);
  }

  const uniqueSlugs = Array.from(
    new Set(
      body.slugs
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0),
    ),
  );

  if (!uniqueSlugs.length) {
    return withCors(NextResponse.json({ error: "At least one slug is required" }, { status: 400 }), requestOrigin);
  }

  const parsedExpiresAt = parseExpiresAt(body.expiresAt);
  if (body.action === "set-expiry") {
    if (!(parsedExpiresAt instanceof Date)) {
      return withCors(NextResponse.json({ error: "expiresAt must be an ISO string when setting expiry" }, { status: 400 }), requestOrigin);
    }
  }
  if (body.action !== "set-expiry" && body.expiresAt !== undefined) {
    return withCors(NextResponse.json({ error: "expiresAt is only valid for set-expiry" }, { status: 400 }), requestOrigin);
  }

  const firestore = getAdminFirestore();
  const collection = firestore.collection("proposals");
  const docRefs = uniqueSlugs.map((slug) => collection.doc(slug));

  const snapshots = await firestore.getAll(...docRefs);
  const missingSlugs: string[] = [];
  const existingRefs: Array<{ slug: string; ref: DocumentReference }> = [];

  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) {
      missingSlugs.push(uniqueSlugs[index]);
      return;
    }
    existingRefs.push({ slug: uniqueSlugs[index], ref: docRefs[index] });
  });

  if (!existingRefs.length) {
    return withCors(NextResponse.json({
      action: body.action,
      updatedCount: 0,
      skipped: missingSlugs,
    }), requestOrigin);
  }

  const batch = firestore.batch();
  const timestamp = FieldValue.serverTimestamp();
  const userSnapshot = {
    uid: context.uid,
    email: context.email ?? null,
    displayName: context.displayName ?? null,
  };

  const processedSlugs: string[] = [];

  switch (body.action) {
    case "delete": {
      existingRefs.forEach(({ slug, ref }) => {
        batch.delete(ref);
        processedSlugs.push(slug);
      });
      break;
    }
    case "archive":
    case "unarchive": {
      const isArchived = body.action === "archive";
      existingRefs.forEach(({ slug, ref }) => {
        batch.update(ref, {
          isArchived,
          updatedAt: timestamp,
          updatedBy: userSnapshot,
        });
        processedSlugs.push(slug);
      });
      break;
    }
    case "set-expiry": {
      existingRefs.forEach(({ slug, ref }) => {
        batch.update(ref, {
          expiresAt: parsedExpiresAt,
          updatedAt: timestamp,
          updatedBy: userSnapshot,
        });
        processedSlugs.push(slug);
      });
      break;
    }
    case "clear-expiry": {
      existingRefs.forEach(({ slug, ref }) => {
        batch.update(ref, {
          expiresAt: null,
          updatedAt: timestamp,
          updatedBy: userSnapshot,
        });
        processedSlugs.push(slug);
      });
      break;
    }
    default: {
      return withCors(NextResponse.json({ error: "Unsupported action" }, { status: 400 }), requestOrigin);
    }
  }

  if (processedSlugs.length) {
    await batch.commit();
  }

  return withCors(NextResponse.json({
    action: body.action,
    updatedCount: processedSlugs.length,
    updated: processedSlugs,
    skipped: missingSlugs,
    expiresAt: body.action === "set-expiry"
      ? (parsedExpiresAt ? parsedExpiresAt.toISOString() : null)
      : undefined,
  }), requestOrigin);
};

export const OPTIONS = handleCorsPreflight;
