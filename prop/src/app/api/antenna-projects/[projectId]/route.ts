import { NextRequest, NextResponse } from "next/server";
import { resolveBearerToken, verifyFirebaseToken, UnauthorizedDomainError } from "@/lib/auth";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { getAntennaProject } from "@/lib/antennaProjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      console.warn("antenna-project: unauthorized domain", error.email);
      return {
        error: withCors(NextResponse.json({ error: "Access restricted to uctel.co.uk accounts" }, { status: 403 }), origin),
      };
    }
    console.error("antenna-project: token verification failed", error);
    return { error: withCors(NextResponse.json({ error: "Invalid authentication token" }, { status: 401 }), origin) };
  }
};

export const GET = async (request: NextRequest, ctx: { params: Promise<{ projectId: string }> }) => {
  const origin = request.headers.get("origin");
  const { context, error } = await ensureAuthenticated(request, origin);
  if (error || !context) {
    return error;
  }

  const { projectId } = await ctx.params;
  if (!projectId) {
    return withCors(NextResponse.json({ error: "Project ID is required" }, { status: 400 }), origin);
  }

  try {
    const data = await getAntennaProject(projectId);
    return withCors(NextResponse.json(data), origin);
  } catch (err) {
    console.error("antenna-project: failed to load project", projectId, err);
    return withCors(NextResponse.json({ error: "Project not found" }, { status: 404 }), origin);
  }
};

export const OPTIONS = handleCorsPreflight;
