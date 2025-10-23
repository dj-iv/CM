const {
  verifyPortalToken,
  createSessionCookie,
  sanitizeRedirect,
  buildPortalLoginUrl,
} = require('../portalAuth')
const { resolveOrigin } = require('../sessionHandler')

const APP_ID = process.env.PORTAL_APP_ID || 'cost'

function formatCookie({ name, value, options }) {
  const parts = [`${name}=${value}`]
  if (options.maxAge) {
    parts.push(`Max-Age=${Math.floor(options.maxAge)}`)
  }
  if (options.path) {
    parts.push(`Path=${options.path}`)
  }
  if (options.sameSite) {
    const sameSiteValue =
      typeof options.sameSite === 'string'
        ? options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)
        : options.sameSite
    parts.push(`SameSite=${sameSiteValue}`)
  }
  if (options.secure) {
    parts.push('Secure')
  }
  if (options.httpOnly) {
    parts.push('HttpOnly')
  }
  return parts.join('; ')
}

function normaliseQueryParam(param) {
  if (Array.isArray(param)) {
    return param[0]
  }
  return param ?? null
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const origin =
    resolveOrigin(req.headers, process.env.VERCEL ? 'https' : req.headers['x-forwarded-proto'] || 'http') ||
    `https://${req.headers.host}`

  const token = normaliseQueryParam(req.query?.portalToken)
  const redirectParam = normaliseQueryParam(req.query?.redirect)
  const redirectTarget = sanitizeRedirect(redirectParam, origin)

  if (!token) {
    const loginUrl = buildPortalLoginUrl(redirectTarget)
    res.statusCode = 302
    res.setHeader('Location', loginUrl)
    return res.end()
  }

  const payload = verifyPortalToken(token)
  if (!payload || payload.appId !== APP_ID) {
    const loginUrl = buildPortalLoginUrl(redirectTarget)
    res.statusCode = 302
    res.setHeader('Location', loginUrl)
    return res.end()
  }

  const sessionCookie = createSessionCookie(payload)
  res.setHeader('Set-Cookie', formatCookie(sessionCookie))

  const destination = new URL(redirectTarget, origin).toString()
  res.statusCode = 302
  res.setHeader('Location', destination)
  return res.end()
}
