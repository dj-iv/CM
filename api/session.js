const { handlePortalSession, resolveOrigin } = require('../sessionHandler')
const { getSessionCookieDomain } = require('../portalAuth')

const APP_ID = process.env.PORTAL_APP_ID || 'cost'

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let payload = req.body
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON payload' })
    }
  }

  const origin =
    resolveOrigin(req.headers, process.env.VERCEL ? 'https' : req.headers['x-forwarded-proto'] || 'http') ||
    `https://${req.headers.host}`

  try {
    const result = await handlePortalSession({
      appId: APP_ID,
      origin,
      cookiesHeader: req.headers.cookie || '',
      body: payload,
    })

    if (result.clearSessionCookie) {
      const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL
      const secure = portalUrl ? portalUrl.startsWith('https://') : process.env.NODE_ENV === 'production'
      const cookieName = process.env.PORTAL_SESSION_COOKIE_NAME || 'uctel_cost_session'
      const cookieParts = [`${cookieName}=`, 'Path=/', 'Max-Age=0', 'HttpOnly', 'SameSite=Lax']
      const cookieDomain = getSessionCookieDomain()
      if (cookieDomain) {
        cookieParts.push(`Domain=${cookieDomain}`)
      }
      if (secure) {
        cookieParts.push('Secure')
      }
      res.setHeader('Set-Cookie', cookieParts.join('; '))
    }

    return res.status(result.status).json(result.body)
  } catch (error) {
    console.error('[api/session] unexpected error', error)
    return res.status(500).json({ error: 'SESSION_HANDLER_FAILURE' })
  }
}
