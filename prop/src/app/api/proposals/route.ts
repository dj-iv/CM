import { FieldValue, type Query, type CollectionReference } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyFirebaseToken, resolveBearerToken } from "@/lib/auth";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  buildMetadata,
  decodeState,
  ensureSlug,
  ProposalPayload,
  sanitizeSlug,
  randomSlug,
} from "@/lib/proposalUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TAG_LENGTH = 40;

const CreateProposalSchema = z.object({
  slug: z.string().min(1).max(120).optional(),
  encodedState: z.string().min(1, "encodedState is required"),
  proposal: z.record(z.string(), z.unknown()),
  overwrite: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(20).optional(),
  expiresAt: z.union([z.string().min(1), z.null()]).optional(),
  isArchived: z.boolean().optional(),
});

const normalizeNotes = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
};

const normalizeTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  tags.forEach((tag) => {
    if (typeof tag !== "string") {
      return;
    }
    const trimmed = tag.trim();
    if (!trimmed || trimmed.length > MAX_TAG_LENGTH) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(trimmed);
  });

  return normalized;
};

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

const ensureAuthenticated = async (request: NextRequest, origin: string | null) => {
  const token = resolveBearerToken(request);
  if (!token) {
    return { error: withCors(NextResponse.json({ error: "Authentication required" }, { status: 401 }), origin) };
  }
  try {
    const context = await verifyFirebaseToken(token);
    return { context };
  } catch (error) {
    console.error("Failed to verify Firebase token", error);
    return { error: withCors(NextResponse.json({ error: "Invalid authentication token" }, { status: 401 }), origin) };
  }
};

const normalizeSolutionType = (value: unknown): string => {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
};

const findUniqueSlug = async (collection: CollectionReference, base: string): Promise<string> => {
  let sanitizedBase = sanitizeSlug(base);
  if (!sanitizedBase) {
    sanitizedBase = sanitizeSlug(randomSlug());
  }

  let candidate = sanitizedBase || randomSlug();
  let counter = 2;

  while ((await collection.doc(candidate).get()).exists) {
    candidate = sanitizedBase ? `${sanitizedBase}-${counter}` : `${randomSlug()}-${counter}`;
    counter += 1;
  }

  return candidate;
};

export const POST = async (request: NextRequest) => {
  const requestOrigin = request.headers.get("origin");
  const { context, error } = await ensureAuthenticated(request, requestOrigin);
  if (error || !context) {
    return error;
  }

  let body: z.infer<typeof CreateProposalSchema>;
  try {
    const json = await request.json();
    body = CreateProposalSchema.parse(json);
  } catch (parseError) {
    console.error("Invalid proposal payload", parseError);
    return withCors(NextResponse.json({ error: "Invalid request body" }, { status: 400 }), requestOrigin);
  }

  const state = decodeState(body.encodedState);
  const metadata = buildMetadata(body.proposal as ProposalPayload, state);

  if (!metadata.customerName) {
    return withCors(NextResponse.json({ error: "Customer name is required" }, { status: 400 }), requestOrigin);
  }

  const parsedExpiresAt = parseExpiresAt(body.expiresAt);
  if (body.expiresAt !== undefined && parsedExpiresAt === undefined) {
    return withCors(NextResponse.json({ error: "Invalid expiresAt value" }, { status: 400 }), requestOrigin);
  }

  const hasNotes = body.notes !== undefined;
  const normalizedNotes = hasNotes ? normalizeNotes(body.notes) : "";

  const hasTags = body.tags !== undefined;
  const normalizedTags = hasTags ? normalizeTags(body.tags) : [];

  const hasExpiresAt = body.expiresAt !== undefined;
  const hasArchivedFlag = body.isArchived !== undefined;
  const defaultExpiryDate = hasExpiresAt ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let slug = ensureSlug({
    requestedSlug: body.slug,
    quoteNumber: metadata.quoteNumber ?? undefined,
    customerName: metadata.customerName,
  });

  const firestore = getAdminFirestore();
  const collection = firestore.collection("proposals");
  let docRef = collection.doc(slug);
  let snapshot = await docRef.get();

  if (snapshot.exists) {
    const existingData = snapshot.data();
    const previousSolution = normalizeSolutionType(existingData?.metadata?.solutionType);
    const incomingSolution = normalizeSolutionType(metadata.solutionType);

    if (previousSolution && incomingSolution && previousSolution !== incomingSolution) {
      const solutionSegment = sanitizeSlug(metadata.solutionType || "");
      const customerSegment = sanitizeSlug(metadata.customerName || "");
      const candidateBases = [
        solutionSegment ? `${slug}-${solutionSegment}` : null,
        solutionSegment && customerSegment ? `${customerSegment}-${solutionSegment}` : null,
      ].filter((value): value is string => Boolean(value));

      let nextSlug: string | null = null;
      for (const base of candidateBases) {
        nextSlug = await findUniqueSlug(collection, base);
        if (nextSlug) {
          break;
        }
      }

      if (!nextSlug) {
        nextSlug = await findUniqueSlug(collection, randomSlug());
      }

      slug = nextSlug;
      docRef = collection.doc(slug);
      snapshot = await docRef.get();
    }
  }

  const overwrite = body.overwrite !== false;

  if (snapshot.exists && !overwrite) {
    return withCors(NextResponse.json({
      error: "Proposal already exists for the chosen slug",
      slug,
    }, { status: 409 }), requestOrigin);
  }

  const timestamp = FieldValue.serverTimestamp();
  const userSnapshot = {
    uid: context.uid,
    email: context.email ?? null,
    displayName: context.displayName ?? null,
  };

  const payload = {
    slug,
    encodedState: body.encodedState,
    proposal: body.proposal,
    metadata: {
      customerName: metadata.customerName,
      customerNameLower: metadata.customerNameLower,
      solutionType: metadata.solutionType,
      numberOfNetworks: metadata.numberOfNetworks,
      quoteNumber: metadata.quoteNumber,
      totalPrice: metadata.totalPrice,
      supportTier: metadata.supportTier,
    },
    updatedAt: timestamp,
    updatedBy: userSnapshot,
  };

  const existingData = snapshot.exists ? snapshot.data() : null;
  const existingViewCount = typeof existingData?.viewCount === "number" ? existingData.viewCount : 0;
  const existingDownloadCount = typeof existingData?.downloadCount === "number" ? existingData.downloadCount : 0;
  const existingExpiresAt = (() => {
    const expiresValue = existingData?.expiresAt;
    if (!expiresValue) {
      return null;
    }
    if (typeof expiresValue.toDate === "function") {
      const date = expiresValue.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    if (expiresValue instanceof Date && !Number.isNaN(expiresValue.getTime())) {
      return expiresValue;
    }
    return null;
  })();

  if (snapshot.exists) {
    const updates: Record<string, unknown> = { ...payload };
    if (hasNotes) {
      updates.notes = normalizedNotes;
    }
    if (hasTags) {
      updates.tags = normalizedTags;
    }
    if (hasExpiresAt) {
      updates.expiresAt = parsedExpiresAt ?? null;
    } else if (!existingExpiresAt && defaultExpiryDate) {
      updates.expiresAt = defaultExpiryDate;
    }
    if (hasArchivedFlag) {
      updates.isArchived = body.isArchived ?? false;
    }

    await docRef.update(updates);
  } else {
    await docRef.set({
      ...payload,
      createdAt: timestamp,
      createdBy: userSnapshot,
      notes: normalizedNotes,
      tags: normalizedTags,
      expiresAt: hasExpiresAt ? parsedExpiresAt ?? null : defaultExpiryDate,
      isArchived: hasArchivedFlag ? body.isArchived ?? false : false,
      viewCount: existingViewCount,
      downloadCount: existingDownloadCount,
      pdf: {
        status: "idle",
        url: null,
        lastGeneratedAt: null,
        error: null,
      },
    });
  }

  const siteOrigin = request.nextUrl.origin;

  const responseNotes = hasNotes
    ? normalizedNotes
    : (typeof existingData?.notes === "string" ? existingData.notes : "");
  const responseTags = hasTags
    ? normalizedTags
    : (Array.isArray(existingData?.tags)
      ? existingData.tags.filter((tag: unknown): tag is string => typeof tag === "string")
      : []);
  const responseExpiresAt = hasExpiresAt
    ? (parsedExpiresAt ? parsedExpiresAt.toISOString() : null)
    : ((existingExpiresAt ?? defaultExpiryDate)?.toISOString() ?? null);
  const responseIsArchived = hasArchivedFlag
    ? (body.isArchived ?? false)
    : Boolean(existingData?.isArchived);

  return withCors(NextResponse.json({
    slug,
    url: `${siteOrigin}/${slug}`,
    metadata,
    notes: responseNotes,
    tags: responseTags,
    expiresAt: responseExpiresAt,
    isArchived: responseIsArchived,
    viewCount: snapshot.exists ? existingViewCount : 0,
    downloadCount: snapshot.exists ? existingDownloadCount : 0,
  }), requestOrigin);
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET = async (request: NextRequest) => {
  const requestOrigin = request.headers.get("origin");
  const { context, error } = await ensureAuthenticated(request, requestOrigin);
  if (error || !context) {
    return error;
  }

  const search = request.nextUrl.searchParams.get("search")?.trim().toLowerCase() ?? "";
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(Number.parseInt(limitParam ?? "", 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const firestore = getAdminFirestore();
  const collection = firestore.collection("proposals");
  let query: Query = collection;

  if (search) {
    const end = `${search}\uf8ff`;
    query = collection
      .orderBy("metadata.customerNameLower")
      .orderBy("updatedAt", "desc")
      .startAt(search)
      .endAt(end);
  } else {
    query = collection.orderBy("updatedAt", "desc");
  }

  query = query.limit(limit);

  const snapshot = await query.get();

  const items = snapshot.docs.map((doc) => {
    const data = doc.data();
    const createdAt = data.createdAt?.toDate?.() ?? null;
    const updatedAt = data.updatedAt?.toDate?.() ?? null;
    const expiresAt = data.expiresAt?.toDate?.() ?? null;
    const notes = typeof data.notes === "string" ? data.notes : "";
    const tags = Array.isArray(data.tags) ? data.tags.filter((tag: unknown): tag is string => typeof tag === "string") : [];
    const viewCount = typeof data.viewCount === "number" ? data.viewCount : 0;
    const downloadCount = typeof data.downloadCount === "number" ? data.downloadCount : 0;
    return {
      slug: doc.id,
      metadata: data.metadata ?? null,
      createdAt: createdAt ? createdAt.toISOString() : null,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      pdf: data.pdf ?? null,
      notes,
      tags,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      isArchived: Boolean(data.isArchived),
      viewCount,
      downloadCount,
    };
  });

  return withCors(NextResponse.json({ items }), requestOrigin);
};

export const OPTIONS = handleCorsPreflight;
