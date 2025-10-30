import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionCookieName } from '@/lib/sessionCookie'

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL || 'http://localhost:3300'
const PUBLIC_PATHS = ['/healthz', '/portal/callback']
const PUBLIC_SLUG_REGEX = /^\/[a-z0-9-]+$/i
const APP_ID = 'proposal'

function sanitizeRedirect(target: string, origin: string): string {
  if (!target) {
    return '/'
  }

  try {
    const candidate = new URL(target, origin)
    if (candidate.origin !== origin) {
      return '/'
    }
    return candidate.pathname + candidate.search + candidate.hash
  } catch (error) {
    if (typeof target === 'string' && target.startsWith('/')) {
      return target
    }
    return '/'
  }
}

function buildPortalLaunchUrl(appId: string, redirect: string) {
  const launchUrl = new URL(`/launch/${appId}`, PORTAL_URL)
  if (redirect) {
    launchUrl.searchParams.set('redirect', redirect)
  }
  return launchUrl.toString()
}

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.some((publicPath) => pathname.startsWith(publicPath))) {
    return true
  }

  if (PUBLIC_SLUG_REGEX.test(pathname)) {
    return true
  }

  return false
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname === '/favicon.ico' ||
    isPublicPath(pathname)
  ) {
    return NextResponse.next()
  }

  const sessionCookieName = getSessionCookieName()
  if (request.cookies.has(sessionCookieName)) {
    return NextResponse.next()
  }

  const origin = request.nextUrl.origin
  const sanitisedRedirect = sanitizeRedirect(request.nextUrl.href, origin)
  const absoluteRedirect = new URL(sanitisedRedirect, origin).toString()
  const launchUrl = buildPortalLaunchUrl(APP_ID, absoluteRedirect)
  return NextResponse.redirect(launchUrl)
}

export const config = {
  matcher: ['/((?!api|_next|static|.*\.(?:ico|png|jpg|jpeg|svg|css|js|html?)).*)'],
}
