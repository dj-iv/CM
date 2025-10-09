import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyFirebaseToken, resolveBearerToken, UnauthorizedDomainError } from "@/lib/auth";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import {
  buildMetadata,
  decodeState,
  ProposalPayload,
} from "@/lib/proposalUtils";
import { buildDefaultIntroduction, INTRODUCTION_MAX_LENGTH, normalizeIntroductionInput } from "@/lib/proposalCopy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TAG_LENGTH = 40;

const UpdateSchema = z.object({
  encodedState: z.string().min(1).optional(),
  proposal: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(20).optional(),
  expiresAt: z.union([z.string().min(1), z.null()]).optional(),
  isArchived: z.boolean().optional(),
  introduction: z.string().max(INTRODUCTION_MAX_LENGTH).optional(),
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

const extractFirstName = (displayName: string | null | undefined, email: string | null | undefined): string | null => {
  const fromDisplayName = displayName?.trim();
  if (fromDisplayName) {
    const [firstSegment] = fromDisplayName.split(/\s+/);
    if (firstSegment) {
      return firstSegment.trim() || null;
    }
  }
  const fromEmail = email?.trim();
  if (fromEmail) {
    const [prefix] = fromEmail.split("@");
    return prefix?.trim() || null;
  }
  return null;
};

const sanitizeUserInfo = (
  value: unknown,
): { displayName: string | null; email: string | null; firstName: string | null } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const maybeRecord = value as Record<string, unknown>;
  const displayName = typeof maybeRecord.displayName === "string" ? maybeRecord.displayName : null;
  const email = typeof maybeRecord.email === "string" ? maybeRecord.email : null;
  const firstNameCandidate = typeof maybeRecord.firstName === "string" ? maybeRecord.firstName : null;
  const derivedFirstName = (() => {
    if (firstNameCandidate) {
      return firstNameCandidate.trim() || null;
    }
    return extractFirstName(displayName, email);
  })();
  if (!displayName && !email && !derivedFirstName) {
    return null;
  }
  return { displayName, email, firstName: derivedFirstName };
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
      console.warn("Unauthorized domain attempted to access proposal endpoint", error.email);
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

export const GET = async (request: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  const requestOrigin = request.headers.get("origin");
  const { context: authContext, error } = await ensureAuth(request, requestOrigin);
  if (error || !authContext) {
    return error;
  }

  const { slug } = await ctx.params;

  const firestore = getAdminFirestore();
  const docRef = firestore.collection("proposals").doc(slug);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return withCors(NextResponse.json({ error: "Proposal not found" }, { status: 404 }), requestOrigin);
  }

  const data = snapshot.data()!;
  const createdAt = data.createdAt?.toDate?.() ?? null;
  const updatedAt = data.updatedAt?.toDate?.() ?? null;
  const notes = typeof data.notes === "string" ? data.notes : "";
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag: unknown): tag is string => typeof tag === "string")
    : [];
  const expiresAt = (() => {
    const expiresValue = data.expiresAt;
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
  const isArchived = Boolean(data.isArchived);
  const viewCount = typeof data.viewCount === "number" ? data.viewCount : 0;
  const downloadCount = typeof data.downloadCount === "number" ? data.downloadCount : 0;
  const proposalData = data.proposal && typeof data.proposal === "object" && !Array.isArray(data.proposal)
    ? (data.proposal as Record<string, unknown>)
    : null;
  const introduction = typeof data.introduction === "string"
    ? data.introduction
    : buildDefaultIntroduction(proposalData);
  const createdBy = sanitizeUserInfo(data.createdBy);

  return withCors(NextResponse.json({
    slug: snapshot.id,
    encodedState: data.encodedState ?? null,
    proposal: data.proposal ?? null,
    metadata: data.metadata ?? null,
    pdf: data.pdf ?? null,
    createdAt: createdAt ? createdAt.toISOString() : null,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
    notes,
    tags,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    isArchived,
    viewCount,
    downloadCount,
    introduction,
    createdBy,
  }), requestOrigin);
};

export const PUT = async (request: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  const requestOrigin = request.headers.get("origin");
  const { context: authContext, error } = await ensureAuth(request, requestOrigin);
  if (error || !authContext) {
    return error;
  }

  const { slug } = await ctx.params;

  let body: z.infer<typeof UpdateSchema>;
  try {
    const json = await request.json();
    body = UpdateSchema.parse(json);
  } catch (parseError) {
    console.error("Invalid update payload", parseError);
    return withCors(NextResponse.json({ error: "Invalid request body" }, { status: 400 }), requestOrigin);
  }

  const hasEncodedState = typeof body.encodedState === "string" && body.encodedState.length > 0;
  const hasProposal = typeof body.proposal === "object" && body.proposal !== null;
  const hasNotes = body.notes !== undefined;
  const hasTags = body.tags !== undefined;
  const hasExpiresAt = body.expiresAt !== undefined;
  const hasArchivedFlag = body.isArchived !== undefined;
  const hasIntroduction = body.introduction !== undefined;

  if (!hasEncodedState && !hasProposal && !hasNotes && !hasTags && !hasExpiresAt && !hasArchivedFlag && !hasIntroduction) {
    return withCors(NextResponse.json({ error: "No changes supplied" }, { status: 400 }), requestOrigin);
  }

  const parsedExpiresAt = parseExpiresAt(body.expiresAt);
  if (hasExpiresAt && parsedExpiresAt === undefined) {
    return withCors(NextResponse.json({ error: "Invalid expiresAt value" }, { status: 400 }), requestOrigin);
  }

  const normalizedNotes = hasNotes ? normalizeNotes(body.notes) : undefined;
  const normalizedTags = hasTags ? normalizeTags(body.tags) : undefined;

  const firestore = getAdminFirestore();
  const docRef = firestore.collection("proposals").doc(slug);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return withCors(NextResponse.json({ error: "Proposal not found" }, { status: 404 }), requestOrigin);
  }

  const currentData = snapshot.data()!;
  const timestamp = FieldValue.serverTimestamp();
  const userSnapshot = {
    uid: authContext.uid,
    email: authContext.email ?? null,
    displayName: authContext.displayName ?? null,
    firstName: extractFirstName(authContext.displayName ?? null, authContext.email ?? null),
  };
  const updates: Record<string, unknown> = {
    updatedAt: timestamp,
    updatedBy: userSnapshot,
  };

  let metadataResponse = currentData.metadata ?? null;
  const hasExistingIntroduction = typeof currentData.introduction === "string";
  const existingIntroduction = hasExistingIntroduction ? (currentData.introduction as string) : null;
  let introductionResponse = existingIntroduction;
  let nextProposalForDefault: ProposalPayload | null = null;

  if (hasEncodedState || hasProposal) {
    const nextEncodedState = (hasEncodedState ? body.encodedState : currentData.encodedState) ?? "";
    const nextProposal = (hasProposal ? (body.proposal as ProposalPayload) : (currentData.proposal as ProposalPayload | undefined)) ?? {};
    nextProposalForDefault = nextProposal;

    const decodedState = decodeState(nextEncodedState ?? "");
    const metadata = buildMetadata(nextProposal, decodedState);

    if (!metadata.customerName) {
      return withCors(NextResponse.json({ error: "Customer name is required" }, { status: 400 }), requestOrigin);
    }

    updates.encodedState = nextEncodedState;
    updates.proposal = nextProposal;
    updates.metadata = {
      customerName: metadata.customerName,
      customerNameLower: metadata.customerNameLower,
      solutionType: metadata.solutionType,
      numberOfNetworks: metadata.numberOfNetworks,
      quoteNumber: metadata.quoteNumber,
      totalPrice: metadata.totalPrice,
      supportTier: metadata.supportTier,
    };

    metadataResponse = metadata;
  }

  if (hasNotes) {
    updates.notes = normalizedNotes;
  }
  if (hasTags) {
    updates.tags = normalizedTags;
  }
  if (hasExpiresAt) {
    updates.expiresAt = parsedExpiresAt ?? null;
  }
  if (hasArchivedFlag) {
    updates.isArchived = body.isArchived ?? false;
  }
  if (hasIntroduction) {
    const normalizedIntroduction = normalizeIntroductionInput(body.introduction) ?? "";
    updates.introduction = normalizedIntroduction;
    introductionResponse = normalizedIntroduction;
  } else if (!hasExistingIntroduction) {
    const sourceProposal = nextProposalForDefault ?? ((currentData.proposal as ProposalPayload | undefined) ?? {});
    const defaultIntroduction = buildDefaultIntroduction(sourceProposal);
    updates.introduction = defaultIntroduction;
    introductionResponse = defaultIntroduction;
  }

  await docRef.update(updates);

  const existingNotes = typeof currentData.notes === "string" ? currentData.notes : "";
  const existingTags = Array.isArray(currentData.tags)
    ? currentData.tags.filter((tag: unknown): tag is string => typeof tag === "string")
    : [];
  const existingExpiresAt = (() => {
    const expiresValue = currentData.expiresAt;
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
  const existingArchived = Boolean(currentData.isArchived);
  const existingViewCount = typeof currentData.viewCount === "number" ? currentData.viewCount : 0;
  const existingDownloadCount = typeof currentData.downloadCount === "number" ? currentData.downloadCount : 0;
  const createdByResponse = sanitizeUserInfo(currentData.createdBy);

  return withCors(NextResponse.json({
    slug,
    metadata: metadataResponse,
    notes: hasNotes ? normalizedNotes ?? "" : existingNotes,
    tags: hasTags ? normalizedTags ?? [] : existingTags,
    expiresAt: hasExpiresAt
      ? (parsedExpiresAt ? parsedExpiresAt.toISOString() : null)
      : (existingExpiresAt ? existingExpiresAt.toISOString() : null),
    isArchived: hasArchivedFlag ? (body.isArchived ?? false) : existingArchived,
    viewCount: existingViewCount,
    downloadCount: existingDownloadCount,
    introduction: introductionResponse ?? null,
    createdBy: createdByResponse,
  }), requestOrigin);
};

export const OPTIONS = handleCorsPreflight;
