import { FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { convertWithPdfShift, PdfShiftError } from "@/lib/pdfShift";
import {
  buildMetadata,
  buildProposalFilename,
  decodeState,
  ProposalPayload,
} from "@/lib/proposalUtils";
import { resolvePdfStorageBucket } from "@/lib/pdfStorage";

const PdfRequestSchema = z.object({
  html: z.string().optional(),
  css: z.union([z.string(), z.array(z.string())]).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  filename: z.string().optional(),
  encoding: z.string().optional(),
  data: z.string().optional(),
  origin: z.string().optional(),
  debug: z.boolean().optional(),
  storagePath: z.string().optional(),
  payloadBytes: z.number().optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async (request: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  const requestOrigin = request.headers.get("origin");
  const { slug } = await ctx.params;

  let body: z.infer<typeof PdfRequestSchema>;
  try {
    const json = await request.json();
    body = PdfRequestSchema.parse(json);
  } catch (error) {
    console.error("Invalid PDF request payload", error);
  return withCors(NextResponse.json({ error: "Invalid request body" }, { status: 400 }), requestOrigin);
  }

  const firestore = getAdminFirestore();
  const docRef = firestore.collection("proposals").doc(slug);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
  return withCors(NextResponse.json({ error: "Proposal not found" }, { status: 404 }), requestOrigin);
  }

  const data = snapshot.data();
  if (!data) {
  return withCors(NextResponse.json({ error: "Proposal payload missing" }, { status: 404 }), requestOrigin);
  }

  const storedMetadata = data.metadata ?? null;
  const proposal = (data.proposal as ProposalPayload | undefined) ?? {};
  const state = typeof data.encodedState === "string" ? decodeState(data.encodedState) : null;
  const metadata = storedMetadata ?? buildMetadata(proposal, state);
  const filename = body.filename ?? buildProposalFilename(metadata);

  let offloadedFile: { delete: () => Promise<void> } | null = null;
  let convertPayload = { ...body, filename };

  if (body.storagePath) {
  const bucketName = resolvePdfStorageBucket();
    if (!bucketName) {
      return withCors(NextResponse.json({ error: "PDF storage bucket is not configured" }, { status: 500 }), requestOrigin);
    }

    const bucket = getStorage().bucket(bucketName);
    const file = bucket.file(body.storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return withCors(NextResponse.json({ error: "Uploaded HTML payload expired" }, { status: 410 }), requestOrigin);
    }

    try {
      const [contents] = await file.download();
      const html = gunzipSync(contents).toString("utf8");
      convertPayload = {
        ...body,
        html,
        data: undefined,
        encoding: undefined,
        storagePath: undefined,
        filename,
      };
    } catch (storageError) {
      console.error("Failed to download or decompress uploaded PDF payload", storageError);
      return withCors(NextResponse.json({ error: "Failed to read uploaded HTML payload" }, { status: 500 }), requestOrigin);
    }

    offloadedFile = {
      delete: async () => {
        try {
          await file.delete({ ignoreNotFound: true });
        } catch (cleanupError) {
          console.warn("Failed to delete temporary PDF payload", cleanupError, { storagePath: body.storagePath });
        }
      },
    };
  }

  try {
    const { buffer, filename: safeFilename } = await convertWithPdfShift(convertPayload);

    await docRef.update({
      pdf: {
        status: "ready",
        url: null,
        lastGeneratedAt: FieldValue.serverTimestamp(),
        error: null,
      },
      downloadCount: FieldValue.increment(1),
    });

    return withCors(new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename}.pdf"`,
      },
    }), requestOrigin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate PDF";
    const status = error instanceof PdfShiftError ? error.status : 500;

    await docRef.update({
      pdf: {
        status: "error",
        url: null,
        lastGeneratedAt: FieldValue.serverTimestamp(),
        error: message,
      },
    });

    if (error instanceof PdfShiftError) {
      return withCors(NextResponse.json({ error: error.message, details: error.details }, { status: status }), requestOrigin);
    }

    console.error("PDF generation failed", error);
    return withCors(NextResponse.json({ error: message }, { status }), requestOrigin);
  } finally {
    if (offloadedFile) {
      await offloadedFile.delete();
    }
  }
};

export const OPTIONS = handleCorsPreflight;
