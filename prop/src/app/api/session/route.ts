import { NextRequest, NextResponse } from 'next/server'
import type { UpdateRequest, UserRecord } from 'firebase-admin/auth'
import { getAdminAuth } from '@/lib/firebaseAdmin'
import {
  buildPortalLaunchUrl,
  buildPortalLogoutUrl,
  decodeSessionCookie,
  sanitizeRedirect,
} from '@/lib/portalAuth'
import { getSessionCookieName } from '@/lib/sessionCookie'

type SessionRequestBody = {
  redirect?: string
}

const APP_ID = 'proposal'

function resolveRedirectTarget(bodyRedirect: string | undefined, request: NextRequest) {
  const origin = request.nextUrl.origin
  const fallback = request.headers.get('referer') ?? '/'
  const candidate = typeof bodyRedirect === 'string' && bodyRedirect.length ? bodyRedirect : fallback
  const sanitised = sanitizeRedirect(candidate, origin)
  const absolute = new URL(sanitised, origin).toString()
  return {
    sanitised,
    absolute,
  }
}

async function ensureFirebaseUser(uid: string, email: string | null, displayName: string | null) {
  const auth = getAdminAuth()

  const getErrorCode = (error: unknown): string | undefined => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const { code } = error as { code?: unknown }
      if (typeof code === 'string') {
        return code
      }
    }
    return undefined
  }

  const syncDisplayName = async (targetUid: string, currentDisplayName: string | undefined | null): Promise<void> => {
    if (!displayName || currentDisplayName === displayName) {
      return
    }

    try {
      await auth.updateUser(targetUid, { displayName })
    } catch (updateError: unknown) {
      console.warn('[proposal] session.syncDisplayName failed', { targetUid, displayName, updateError })
    }
  }

  const resolveEmailOwner = async (): Promise<UserRecord | null> => {
    if (!email) {
      return null
    }
    try {
      const existing = await auth.getUserByEmail(email)
      await syncDisplayName(existing.uid, existing.displayName)
      return existing
    } catch (lookupError: unknown) {
      if (getErrorCode(lookupError) !== 'auth/user-not-found') {
        console.warn('[proposal] session.resolveEmailOwner lookup failed', { email, lookupError })
      }
      return null
    }
  }

  try {
    const record = await auth.getUser(uid)
    const updates: Partial<UpdateRequest> = {}

    if (email) {
      if (!record.email) {
        updates.email = email
      } else if (record.email !== email) {
        const emailOwner = await resolveEmailOwner()
        if (emailOwner && emailOwner.uid !== uid) {
          return emailOwner
        }
        updates.email = email
      }
    }

    if (displayName && record.displayName !== displayName) {
      updates.displayName = displayName
    }

    if (Object.keys(updates).length > 0) {
      try {
        await auth.updateUser(uid, updates)
      } catch (updateError: unknown) {
        if (email && getErrorCode(updateError) === 'auth/email-already-exists') {
          const emailOwner = await resolveEmailOwner()
          if (emailOwner) {
            return emailOwner
          }
        }
        console.warn('[proposal] session.updateUser failed', { uid, updates, updateError })
      }
    }

    const refreshed = await auth.getUser(uid)
    await syncDisplayName(refreshed.uid, refreshed.displayName)
    return refreshed
  } catch (error: unknown) {
    if (getErrorCode(error) === 'auth/user-not-found') {
      try {
        const created = await auth.createUser({
          uid,
          email: email ?? undefined,
          displayName: displayName ?? undefined,
        })
        return created
      } catch (createError: unknown) {
        if (email && getErrorCode(createError) === 'auth/email-already-exists') {
          const emailOwner = await resolveEmailOwner()
          if (emailOwner) {
            return emailOwner
          }
        }
        console.error('[proposal] session.createUser failed', { uid, createError })
        throw createError
      }
    }

    console.error('[proposal] session.ensureFirebaseUser unexpected error', { uid, error })
    throw error
  }
}

export async function POST(request: NextRequest) {
  let body: SessionRequestBody = {}
  try {
    body = await request.json()
  } catch {
    // Ignore JSON parse errors and fall back to defaults
  }

  const sessionCookieName = getSessionCookieName()
  const encodedSession = request.cookies.get(sessionCookieName)?.value
  const { sanitised, absolute } = resolveRedirectTarget(body.redirect, request)

  if (!encodedSession) {
    const redirectUrl = buildPortalLaunchUrl(APP_ID, absolute)
    const response = NextResponse.json(
      { error: 'Portal session required', redirect: redirectUrl },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
    response.cookies.set({ name: sessionCookieName, value: '', path: '/', maxAge: 0 })
    return response
  }

  const payload = decodeSessionCookie(encodedSession)
  if (!payload) {
    const redirectUrl = buildPortalLaunchUrl(APP_ID, absolute)
    const response = NextResponse.json(
      { error: 'Portal session invalid', redirect: redirectUrl },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
    response.cookies.set({ name: sessionCookieName, value: '', path: '/', maxAge: 0 })
    return response
  }

  if (!payload.uid.startsWith(APP_ID)) {
    console.warn('[proposal] session cookie UID does not match app prefix', { uid: payload.uid, appId: APP_ID })
  }

  try {
    const firebaseUser = await ensureFirebaseUser(payload.uid, payload.email, payload.displayName)
    if (firebaseUser.uid !== payload.uid) {
      console.info('[proposal] session.ensureFirebaseUser resolved alternate uid', {
        requestedUid: payload.uid,
        resolvedUid: firebaseUser.uid,
      })
    }
    const auth = getAdminAuth()
    const tokenClaims: Record<string, string> = {
      source: 'portal',
      app: APP_ID,
    }
    if (firebaseUser.email) {
      tokenClaims.portalEmail = firebaseUser.email
    }
    if (firebaseUser.displayName) {
      tokenClaims.portalDisplayName = firebaseUser.displayName
    }

    const token = await auth.createCustomToken(firebaseUser.uid, tokenClaims)

    return NextResponse.json(
      {
        token,
        email: firebaseUser.email ?? payload.email,
        displayName: firebaseUser.displayName ?? payload.displayName,
        uid: firebaseUser.uid,
        redirect: sanitised,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[proposal] session.exchange failed', { error })
    const redirectUrl = buildPortalLogoutUrl(absolute)
    const response = NextResponse.json(
      { error: 'Failed to establish Firebase session', redirect: redirectUrl },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
    response.cookies.set({ name: sessionCookieName, value: '', path: '/', maxAge: 0 })
    return response
  }
}
