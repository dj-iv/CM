import { NextRequest, NextResponse } from 'next/server'
import { buildPortalLogoutUrl, sanitizeRedirect } from '@/lib/portalAuth'
import { getSessionCookieName } from '@/lib/sessionCookie'

type LogoutRequestBody = {
  redirect?: string
}

function resolveRedirect(request: NextRequest, body: LogoutRequestBody) {
  const origin = request.nextUrl.origin
  const fallback = request.headers.get('referer') ?? '/'
  const candidate = typeof body.redirect === 'string' && body.redirect.length ? body.redirect : fallback
  const sanitised = sanitizeRedirect(candidate, origin)
  const absolute = new URL(sanitised, origin).toString()
  return { sanitised, absolute }
}

function buildLogoutResponse(status: number, payload: Record<string, unknown>, sessionCookieName: string) {
  const response = NextResponse.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
  response.cookies.set({ name: sessionCookieName, value: '', path: '/', maxAge: 0 })
  return response
}

async function handleLogout(request: NextRequest) {
  let body: LogoutRequestBody = {}
  try {
    body = await request.json()
  } catch (error) {
    // Ignore non-JSON bodies and fall back to defaults
  }

  const sessionCookieName = getSessionCookieName()
  const { sanitised, absolute } = resolveRedirect(request, body)
  const redirectUrl = buildPortalLogoutUrl(absolute)

  return buildLogoutResponse(200, { success: true, redirect: redirectUrl, redirectPath: sanitised }, sessionCookieName)
}

export async function POST(request: NextRequest) {
  return handleLogout(request)
}

export async function GET(request: NextRequest) {
  return handleLogout(request)
}
