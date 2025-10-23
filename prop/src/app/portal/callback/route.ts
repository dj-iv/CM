import { NextResponse } from 'next/server'
import { buildPortalLoginUrl, createSessionCookie, sanitizeRedirect, verifyPortalToken } from '@/lib/portalAuth'
const APP_ID = 'proposal'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('portalToken')
  const redirectTarget = sanitizeRedirect(url.searchParams.get('redirect'), url.origin)

  if (!token) {
    console.warn('[proposal] /portal/callback missing portalToken')
    const loginUrl = buildPortalLoginUrl(redirectTarget)
    return NextResponse.redirect(loginUrl)
  }

  const payload = verifyPortalToken(token)
  if (!payload || payload.appId !== APP_ID) {
    console.warn('[proposal] /portal/callback invalid token', {
      hasPayload: Boolean(payload),
      payloadAppId: payload?.appId,
      expectedAppId: APP_ID,
    })
    const loginUrl = buildPortalLoginUrl(redirectTarget)
    return NextResponse.redirect(loginUrl)
  }

  console.info('[proposal] /portal/callback accepted launch token', {
    uid: payload.uid,
    appId: payload.appId,
    redirectTarget,
  })

  const response = NextResponse.redirect(new URL(redirectTarget, url.origin), { status: 302 })
  const sessionCookie = createSessionCookie(payload)
  response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.options)
  return response
}
