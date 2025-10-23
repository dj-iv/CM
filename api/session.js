const { handlePortalSession, resolveOrigin } = require('../sessionHandler')

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

    return res.status(result.status).json(result.body)
  } catch (error) {
    console.error('[api/session] unexpected error', error)
    return res.status(500).json({ error: 'SESSION_HANDLER_FAILURE' })
  }
}
