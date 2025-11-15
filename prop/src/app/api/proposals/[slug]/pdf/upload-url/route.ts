import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStorage } from "firebase-admin/storage";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { resolvePdfStorageBucket } from "@/lib/pdfStorage";

const MAX_UPLOAD_BYTES = 25_000_000;

const UploadSchema = z.object({
  contentLength: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  contentType: z.string().optional(),
});


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = handleCorsPreflight;

export const POST = async (
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) => {
  const requestOrigin = request.headers.get("origin");
  const { slug } = await ctx.params;

  let payload: z.infer<typeof UploadSchema>;
  try {
    const json = await request.json();
    payload = UploadSchema.parse(json);
  } catch (error) {
    console.error("Invalid upload request payload", error);
    return withCors(NextResponse.json({ error: "Invalid request body" }, { status: 400 }), requestOrigin);
  }

  const firestore = getAdminFirestore();
  const docRef = firestore.collection("proposals").doc(slug);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    return withCors(NextResponse.json({ error: "Proposal not found" }, { status: 404 }), requestOrigin);
  }

  const bucketName = resolvePdfStorageBucket();
  if (!bucketName) {
    return withCors(NextResponse.json({ error: "PDF storage bucket is not configured" }, { status: 500 }), requestOrigin);
  }

  const bucket = getStorage().bucket(bucketName);
  const objectPath = `pdf-html/${slug}/${Date.now()}-${randomUUID()}.html.gz`;
  const expiresAt = Date.now() + 5 * 60 * 1000;

  try {
    const [uploadUrl] = await bucket.file(objectPath).getSignedUrl({
      version: "v4",
      action: "write",
      expires: new Date(expiresAt),
      contentType: payload.contentType ?? "application/gzip",
    });

    return withCors(
      NextResponse.json({
        uploadUrl,
        storagePath: objectPath,
        expiresAt,
  maxBytes: MAX_UPLOAD_BYTES,
      }),
      requestOrigin,
    );
  } catch (error) {
    console.error("Failed to generate signed upload URL", error);
    return withCors(NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 }), requestOrigin);
  }
};
