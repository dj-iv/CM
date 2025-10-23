const { getCostModelAuth, getProposalAuth } = require('./firebaseAdmin')
const {
  parseCookies,
  getSessionCookieName,
  decodeSessionCookie,
  sanitizeRedirect,
  buildPortalLaunchUrl,
} = require('./portalAuth')

function resolveOrigin(headers, fallbackProtocol = 'http') {
  if (!headers) {
    return null
  }

  const protoHeader = headers['x-forwarded-proto'] || headers['x-forwarded-protocol'] || fallbackProtocol
  const hostHeader = headers['x-forwarded-host'] || headers.host

  if (!hostHeader) {
    return null
  }

  const protoValue = Array.isArray(protoHeader) ? protoHeader[0] : String(protoHeader || fallbackProtocol)
  const hostValue = Array.isArray(hostHeader) ? hostHeader[0] : String(hostHeader)

  const proto = protoValue.split(',')[0] || fallbackProtocol
  return `${proto}://${hostValue}`
}

async function ensureFirebaseUser(auth, { uid, email, displayName }) {
  const syncDisplayName = async (targetUid, currentDisplayName) => {
    if (!displayName || currentDisplayName === displayName) {
      return
    }

    try {
      await auth.updateUser(targetUid, { displayName })
    } catch (updateError) {
      console.warn('[cost-model] syncDisplayName failed', { targetUid, displayName, updateError })
    }
  }

  const resolveEmailOwner = async () => {
    if (!email) {
      return null
    }

    try {
      const existing = await auth.getUserByEmail(email)
      await syncDisplayName(existing.uid, existing.displayName)
      return existing
    } catch (lookupError) {
      if (lookupError?.code !== 'auth/user-not-found') {
        console.warn('[cost-model] resolveEmailOwner lookup failed', { email, lookupError })
      }
      return null
    }
  }

  try {
    const record = await auth.getUser(uid)
    const updates = {}

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
      } catch (updateError) {
        if (email && updateError?.code === 'auth/email-already-exists') {
          const emailOwner = await resolveEmailOwner()
          if (emailOwner) {
            return emailOwner
          }
        }
        console.warn('[cost-model] Failed to update Firebase user', { uid, updates, updateError })
      }
    }

    const refreshed = await auth.getUser(uid)
    await syncDisplayName(refreshed.uid, refreshed.displayName)
    return refreshed
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      try {
        const created = await auth.createUser({
          uid,
          email: email ?? undefined,
          displayName: displayName ?? undefined,
        })
        return created
      } catch (createError) {
        if (email && createError?.code === 'auth/email-already-exists') {
          const emailOwner = await resolveEmailOwner()
          if (emailOwner) {
            return emailOwner
          }
        }
        console.error('[cost-model] createUser failed', { uid, createError })
        throw createError
      }
    }

    console.error('[cost-model] ensureFirebaseUser unexpected error', { uid, error })
    throw error
  }
}

function buildLaunchRedirect(appId, origin, redirectTarget) {
  const safeOrigin = origin || 'http://localhost:8080'
  const sanitized = sanitizeRedirect(redirectTarget || '/', safeOrigin)
  const absolute = new URL(sanitized, safeOrigin).toString()
  const launchUrl = buildPortalLaunchUrl(appId, absolute)
  return { status: 401, body: { error: 'NO_SESSION', launch: launchUrl } }
}

async function handlePortalSession({ appId, origin, cookiesHeader, body }) {
  const cookies = parseCookies(cookiesHeader || '')
  const sessionCookie = cookies[getSessionCookieName()]
  const session = decodeSessionCookie(sessionCookie)

  if (!session) {
    console.warn('[cost-model] handlePortalSession missing session cookie', {
      appId,
      origin,
      hasCookiesHeader: Boolean(cookiesHeader),
      cookieNames: Object.keys(cookies),
    })
    return buildLaunchRedirect(appId, origin, body?.redirect)
  }

  try {
    const costAuth = getCostModelAuth()
    const proposalAuth = getProposalAuth()

    const [costUser, proposalUser] = await Promise.all([
      ensureFirebaseUser(costAuth, session),
      ensureFirebaseUser(proposalAuth, session),
    ])

    const resolvedEmail = costUser.email || proposalUser.email || session.email || null
    const resolvedDisplayName = costUser.displayName || proposalUser.displayName || session.displayName || null

    if (costUser.uid !== session.uid || proposalUser.uid !== session.uid) {
      console.info('[cost-model] ensureFirebaseUser resolved alternate uid', {
        sessionUid: session.uid,
        costUid: costUser.uid,
        proposalUid: proposalUser.uid,
      })
    }

    const [costToken, proposalToken] = await Promise.all([
      costAuth.createCustomToken(costUser.uid, {
        portalApp: appId,
        email: resolvedEmail ?? undefined,
        displayName: resolvedDisplayName ?? undefined,
      }),
      proposalAuth.createCustomToken(proposalUser.uid, {
        portalApp: 'proposal',
        email: resolvedEmail ?? undefined,
        displayName: resolvedDisplayName ?? undefined,
      }),
    ])

    return {
      status: 200,
      body: {
        success: true,
        email: resolvedEmail,
        displayName: resolvedDisplayName,
        costToken,
        proposalToken,
      },
    }
  } catch (error) {
    console.error('[cost-model] Failed to mint custom tokens', error)
    return { status: 500, body: { error: 'TOKEN_CREATION_FAILED' } }
  }
}

module.exports = {
  resolveOrigin,
  handlePortalSession,
}
