import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveBearerToken, verifyFirebaseToken, UnauthorizedDomainError } from "@/lib/auth";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { buildAntennaPlacementSnapshot } from "@/lib/antennaProjects";
import { getAdminFirestore } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  floorIds: z.array(z.string().min(1)).optional(),
  notes: z.string().max(3000).optional(),
});

const ensureAuthenticated = async (request: NextRequest, origin: string | null) => {
  const token = resolveBearerToken(request);
  if (!token) {
    return { error: withCors(NextResponse.json({ error: "Authentication required" }, { status: 401 }), origin) };
  }
  try {
    const context = await verifyFirebaseToken(token);
    return { context };
  } catch (error) {
    if (error instanceof UnauthorizedDomainError) {
      console.warn("antenna-placement: unauthorized domain", error.email);
      return {
        error: withCors(NextResponse.json({ error: "Access restricted to uctel.co.uk accounts" }, { status: 403 }), origin),
      };
    }
    console.error("antenna-placement: token verification failed", error);
    return { error: withCors(NextResponse.json({ error: "Invalid authentication token" }, { status: 401 }), origin) };
  }
};

export const POST = async (request: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  const origin = request.headers.get("origin");
  const { context, error } = await ensureAuthenticated(request, origin);
  if (error || !context) {
    return error;
  }

  const { slug } = await ctx.params;
  if (!slug) {
    return withCors(NextResponse.json({ error: "Proposal slug is required" }, { status: 400 }), origin);
  }

  let body: z.infer<typeof UpdateSchema>;
  try {
    const json = await request.json();
    body = UpdateSchema.parse(json);
  } catch (parseError) {
    console.error("antenna-placement: invalid payload", parseError);
    return withCors(NextResponse.json({ error: "Invalid request body" }, { status: 400 }), origin);
  }

  const firestore = getAdminFirestore();
  const docRef = firestore.collection("proposals").doc(slug);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return withCors(NextResponse.json({ error: "Proposal not found" }, { status: 404 }), origin);
  }

  const userSnapshot = {
    uid: context.uid,
    email: context.email ?? null,
    displayName: context.displayName ?? null,
  };

  try {
    const placement = await buildAntennaPlacementSnapshot(body.projectId, body.floorIds ?? [], {
      uid: userSnapshot.uid,
      email: userSnapshot.email,
      displayName: userSnapshot.displayName,
    });

    if (body.notes && body.notes.trim()) {
      placement.notes = body.notes.trim();
    }

    await docRef.update({
      antennaPlacement: placement,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: userSnapshot,
    });

    return withCors(NextResponse.json({ antennaPlacement: placement }), origin);
  } catch (err) {
    console.error("antenna-placement: failed to build snapshot", err);
    return withCors(NextResponse.json({ error: err instanceof Error ? err.message : "Failed to build placement" }, { status: 400 }), origin);
  }
};

export const DELETE = async (request: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  const origin = request.headers.get("origin");
  const { context, error } = await ensureAuthenticated(request, origin);
  if (error || !context) {
    return error;
  }

  const { slug } = await ctx.params;
  if (!slug) {
    return withCors(NextResponse.json({ error: "Proposal slug is required" }, { status: 400 }), origin);
  }

  const firestore = getAdminFirestore();
  const docRef = firestore.collection("proposals").doc(slug);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return withCors(NextResponse.json({ error: "Proposal not found" }, { status: 404 }), origin);
  }

  await docRef.update({
    antennaPlacement: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: {
      uid: context.uid,
      email: context.email ?? null,
      displayName: context.displayName ?? null,
    },
  });

  return withCors(NextResponse.json({ antennaPlacement: null }), origin);
};

export const OPTIONS = handleCorsPreflight;
