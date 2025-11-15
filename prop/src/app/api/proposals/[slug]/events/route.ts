import { NextRequest, NextResponse } from "next/server";
import { FieldValue, type CollectionReference, type Firestore } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { UnauthorizedDomainError, resolveBearerToken, verifyFirebaseToken } from "@/lib/auth";

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

type ProposalEventType = "open" | "download";

interface CreateEventBody {
  type?: ProposalEventType;
  email?: string;
}

type RouteParams = { slug: string };

const ensureAdminRequest = async (request: NextRequest) => {
  const token = resolveBearerToken(request);
  if (!token) {
    return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  }

  try {
    await verifyFirebaseToken(token);
    return {};
  } catch (error) {
    if (error instanceof UnauthorizedDomainError) {
      return { error: NextResponse.json({ error: "Access restricted to UCtel staff" }, { status: 403 }) };
    }
    console.warn("Failed to verify admin token for event reset", error);
    return { error: NextResponse.json({ error: "Invalid authentication token" }, { status: 401 }) };
  }
};

const deleteEventsInBatches = async (
  db: Firestore,
  eventsRef: CollectionReference,
  batchSize = 250,
) => {
  let deleted = 0;
  while (true) {
    const snapshot = await eventsRef.limit(batchSize).get();
    if (snapshot.empty) {
      break;
    }
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < batchSize) {
      break;
    }
  }
  return deleted;
};

export async function POST(
  request: NextRequest,
  context: { params: RouteParams | Promise<RouteParams> },
) {
  const resolvedParams = context.params instanceof Promise ? await context.params : context.params;
  const slug = resolvedParams?.slug;

  if (!isNonEmptyString(slug)) {
    return NextResponse.json({ error: "Missing proposal slug" }, { status: 400 });
  }

  let body: CreateEventBody | null = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const type = body?.type;
  const rawEmail = body?.email;

  if (type !== "open" && type !== "download") {
    return NextResponse.json({ error: "Invalid or missing event type" }, { status: 400 });
  }

  if (!isNonEmptyString(rawEmail)) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const email = rawEmail.trim().toLowerCase();

  try {
    const db = getAdminFirestore();
    const proposalRef = db.collection("proposals").doc(slug);
    const eventsRef = proposalRef.collection("events");

    await db.runTransaction(async (tx) => {
      const proposalSnap = await tx.get(proposalRef);
      if (!proposalSnap.exists) {
        throw new Error("Proposal not found");
      }

      const eventDoc = eventsRef.doc();
      tx.set(eventDoc, {
        type,
        email,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (type === "open") {
        tx.update(proposalRef, { viewCount: FieldValue.increment(1) });
      } else if (type === "download") {
        tx.update(proposalRef, { downloadCount: FieldValue.increment(1) });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to record proposal event", { slug, type, email, error });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  context: { params: RouteParams | Promise<RouteParams> },
) {
  const resolvedParams = context.params instanceof Promise ? await context.params : context.params;
  const slug = resolvedParams?.slug;

  if (!isNonEmptyString(slug)) {
    return NextResponse.json({ error: "Missing proposal slug" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get("type");
  const limitParam = searchParams.get("limit");

  const limit = (() => {
    const parsed = limitParam ? Number.parseInt(limitParam, 10) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 20;
    }
    return Math.min(parsed, 100);
  })();

  try {
    const db = getAdminFirestore();
    const proposalRef = db.collection("proposals").doc(slug);
    const eventsRef = proposalRef.collection("events");

    // Firestore requires a composite index when combining orderBy + where on different fields.
    // To avoid forcing an index, we order by createdAt and apply the type filter in memory.
    const snapshot = await eventsRef.orderBy("createdAt", "desc").limit(100).get();
    const allItems = snapshot.docs.map((doc) => {
      const data = doc.data() as { type?: unknown; email?: unknown; createdAt?: unknown };
      const createdAtValue = (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
      return {
        id: doc.id,
        type: data.type === "open" || data.type === "download" ? data.type : "open",
        email: typeof data.email === "string" ? data.email : null,
        createdAt: createdAtValue ? createdAtValue.toISOString() : null,
      };
    });

    const items = (typeFilter === "open" || typeFilter === "download")
      ? allItems.filter((item) => item.type === typeFilter).slice(0, limit)
      : allItems.slice(0, limit);

    return NextResponse.json({ items });
  } catch (error) {
    console.error("Failed to fetch proposal events", { slug, error });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: RouteParams | Promise<RouteParams> },
) {
  const resolvedParams = context.params instanceof Promise ? await context.params : context.params;
  const slug = resolvedParams?.slug;

  if (!isNonEmptyString(slug)) {
    return NextResponse.json({ error: "Missing proposal slug" }, { status: 400 });
  }

  const { error } = await ensureAdminRequest(request);
  if (error) {
    return error;
  }

  try {
    const db = getAdminFirestore();
    const proposalRef = db.collection("proposals").doc(slug);
    const eventsRef = proposalRef.collection("events");

    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(proposalRef);
      if (!snapshot.exists) {
        throw new Error("Proposal not found");
      }
      tx.update(proposalRef, { viewCount: 0, downloadCount: 0 });
    });

    const deletedEvents = await deleteEventsInBatches(db, eventsRef);

    return NextResponse.json({ ok: true, deletedEvents });
  } catch (error) {
    console.error("Failed to reset proposal events", { slug, error });
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Proposal not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
