const crypto = require('crypto')
const { Buffer } = require('node:buffer')

const SESSION_COOKIE = process.env.PORTAL_SESSION_COOKIE_NAME || 'uctel_cost_session'
const SESSION_DURATION_SECONDS = 60 * 60 * 5 // 5 hours

function resolveCookieDomain(referenceHost) {
  const override = process.env.PORTAL_COOKIE_DOMAIN
  if (override) {
    return override
  }

  let hostname = null
  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL

  if (portalUrl) {
    try {
      hostname = new URL(portalUrl).hostname
    } catch (error) {
      console.warn('[portalAuth] Invalid portal URL for cookie domain', { portalUrl, error })
    }
  }

  if (!hostname && referenceHost) {
    hostname = referenceHost
  }

  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    return undefined
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return undefined
  }

  const segments = hostname.split('.')
  if (segments.length < 2) {
    return undefined
  }
  if (segments.length === 2) {
    return `.${hostname}`
  }
  return `.${segments.slice(1).join('.')}`
}

function getSecret() {
  const secret = process.env.PORTAL_SIGNING_SECRET
  if (!secret) {
    throw new Error('PORTAL_SIGNING_SECRET must be configured')
  }
  return secret
}

function verifyPortalToken(token) {
  if (!token || typeof token !== 'string') {
    return null
  }

  const [data, signature] = token.split('.')
  if (!data || !signature) {
    return null
  }

  const expectedSignature = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url')
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (providedBuffer.length !== expectedBuffer.length) {
    return null
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    if (payload.exp < Date.now()) {
      return null
    }
    return payload
  } catch (error) {
    return null
  }
}

function encodeSessionValue(value) {
  const payload = typeof value === 'string'
    ? { uid: value, email: null, displayName: null }
    : {
        uid: value.uid,
        email: value.email ?? null,
        displayName: value.displayName ?? null,
      }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function decodeSessionCookie(value) {
  if (!value) {
    return null
  }

  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded)
    if (!parsed || typeof parsed.uid !== 'string') {
      return null
    }
    return {
      uid: parsed.uid,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null,
    }
  } catch (error) {
    return {
      uid: value,
      email: null,
      displayName: null,
    }
  }
}

function createSessionCookie(value, { host } = {}) {
  const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL
  const secure = portalUrl ? portalUrl.startsWith('https://') : process.env.NODE_ENV === 'production'
  const domain = resolveCookieDomain(host)
  return {
    name: SESSION_COOKIE,
    value: encodeSessionValue(value),
    options: {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      domain: domain || undefined,
      maxAge: SESSION_DURATION_SECONDS,
    },
  }
}

function getSessionCookieName() {
  return SESSION_COOKIE
}

function getSessionCookieDomain(referenceHost) {
  return resolveCookieDomain(referenceHost)
}

function parseCookies(header = '') {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const separatorIndex = entry.indexOf('=')
      if (separatorIndex === -1) {
        return acc
      }
      const name = entry.slice(0, separatorIndex).trim()
      const value = entry.slice(separatorIndex + 1).trim()
      if (!name) {
        return acc
      }
      acc[name] = decodeURIComponent(value)
      return acc
    }, {})
}

function sanitizeRedirect(target, origin) {
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

function buildPortalLoginUrl(redirect) {
  const baseUrl = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL || 'http://localhost:3300'
  const loginUrl = new URL('/login', baseUrl)
  if (redirect) {
    loginUrl.searchParams.set('redirect', redirect)
  }
  return loginUrl.toString()
}

function buildPortalLaunchUrl(appId, redirect) {
  const baseUrl = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL || 'http://localhost:3300'
  const launchUrl = new URL(`/launch/${appId}`, baseUrl)
  if (redirect) {
    launchUrl.searchParams.set('redirect', redirect)
  }
  return launchUrl.toString()
}

module.exports = {
  verifyPortalToken,
  createSessionCookie,
  getSessionCookieName,
  parseCookies,
  sanitizeRedirect,
  buildPortalLoginUrl,
  buildPortalLaunchUrl,
  encodeSessionValue,
  decodeSessionCookie,
  getSessionCookieDomain,
}
