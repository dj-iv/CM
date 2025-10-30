import crypto from 'crypto'
import { SESSION_COOKIE, SESSION_DURATION_SECONDS, encodeSessionValue, decodeSessionValue, type SessionCookiePayload } from './sessionCookie'

const PORTAL_BASE_URL = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL || 'http://localhost:3300'

function getSecret(): string {
  const secret = process.env.PORTAL_SIGNING_SECRET
  if (!secret) {
    throw new Error('PORTAL_SIGNING_SECRET must be configured')
  }
  return secret
}

export interface PortalLaunchPayload {
  uid: string
  appId: string
  exp: number
  email?: string | null
  displayName?: string | null
}

export function verifyPortalToken(token: string): PortalLaunchPayload | null {
  const [data, signature] = token.split('.')
  if (!data || !signature) {
    console.warn('[proposal] verifyPortalToken: malformed token')
    return null
  }

  const secret = getSecret()
  const expectedSignature = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (providedBuffer.length !== expectedBuffer.length) {
    console.warn('[proposal] verifyPortalToken: signature length mismatch', {
      providedLength: providedBuffer.length,
      expectedLength: expectedBuffer.length,
    })
    return null
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    console.warn('[proposal] verifyPortalToken: signature mismatch', {
      provided: signature.slice(0, 12),
      expected: expectedSignature.slice(0, 12),
      secretPreview: secret.slice(0, 6),
      secretLength: secret.length,
    })
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as PortalLaunchPayload
    if (payload.exp < Date.now()) {
      console.warn('[proposal] verifyPortalToken: token expired', {
        tokenExp: payload.exp,
        now: Date.now(),
      })
      return null
    }
    return payload
  } catch (error) {
    console.warn('[proposal] verifyPortalToken: failed to parse payload', error)
    return null
  }
}

export function createSessionCookie(value: string | PortalLaunchPayload) {
  const secure = PORTAL_BASE_URL ? PORTAL_BASE_URL.startsWith('https://') : process.env.NODE_ENV === 'production'
  return {
    name: SESSION_COOKIE,
    value: encodeSessionValue(value),
    options: {
      httpOnly: true,
      secure,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: SESSION_DURATION_SECONDS,
    },
  }
}

export function decodeSessionCookie(encoded: string | undefined | null): SessionCookiePayload | null {
  return decodeSessionValue(encoded)
}

export function sanitizeRedirect(target: string | null | undefined, origin: string): string {
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
    console.warn('[proposal] sanitizeRedirect falling back to root', { target, origin, error })
    return '/'
  }
}

function buildPortalUrl(pathname: string, redirect: string | null | undefined, extraParams?: Record<string, string>) {
  const url = new URL(pathname, PORTAL_BASE_URL)
  if (redirect) {
    url.searchParams.set('redirect', redirect)
  }
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    url.searchParams.set(key, value)
  }
  return url.toString()
}

export function buildPortalLoginUrl(redirect: string | null | undefined) {
  return buildPortalUrl('/login', redirect ?? null)
}

export function buildPortalLogoutUrl(redirect: string | null | undefined) {
  return buildPortalUrl('/login', redirect ?? null, { logout: '1' })
}

export function buildPortalLaunchUrl(appId: string, redirect: string | null | undefined) {
  return buildPortalUrl(`/launch/${appId}`, redirect ?? null)
}
