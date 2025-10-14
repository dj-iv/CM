import { NextRequest, NextResponse } from "next/server";
import { resolveBearerToken, verifyFirebaseToken, UnauthorizedDomainError } from "@/lib/auth";
import { handleCorsPreflight, withCors } from "@/lib/cors";
import { listAntennaProjects } from "@/lib/antennaProjects";

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
      console.warn("antenna-projects: unauthorized domain", error.email);
      return {
        error: withCors(NextResponse.json({ error: "Access restricted to uctel.co.uk accounts" }, { status: 403 }), origin),
      };
    }
    console.error("antenna-projects: token verification failed", error);
    return { error: withCors(NextResponse.json({ error: "Invalid authentication token" }, { status: 401 }), origin) };
  }
};

export const GET = async (request: NextRequest) => {
  const origin = request.headers.get("origin");
  const { context, error } = await ensureAuthenticated(request, origin);
  if (error || !context) {
    return error;
  }

  try {
    const items = await listAntennaProjects();
    const search = request.nextUrl.searchParams.get("search")?.trim().toLowerCase();
    const filtered = search
      ? items.filter((project) => project.name.toLowerCase().includes(search) || project.id.toLowerCase().includes(search))
      : items;

    console.info("api/antenna-projects:get", {
      total: items.length,
      filtered: filtered.length,
      search,
    });

    return withCors(NextResponse.json({ items: filtered }), origin);
  } catch (err) {
    console.error("antenna-projects: failed to list projects", err);
    return withCors(NextResponse.json({ error: "Failed to load antenna projects" }, { status: 500 }), origin);
  }
};

export const OPTIONS = handleCorsPreflight;
