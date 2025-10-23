const { initializeApp, cert, getApps } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const fs = require('fs')
const path = require('path')

function normaliseKey(input) {
  return input.replace(/\\n/g, '\n')
}

function parseServiceAccountFile(filePath) {
  try {
    const resolved = path.resolve(filePath)
    const raw = fs.readFileSync(resolved, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      return null
    }
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    }
  } catch (error) {
    console.warn('[cost-model] Failed to read service account file', { filePath, error: error?.message })
    return null
  }
}

function resolveServiceAccount(prefix, fallbacks = []) {
  const projectId = process.env[`${prefix}_FIREBASE_PROJECT_ID`] || process.env.FIREBASE_ADMIN_PROJECT_ID || null
  const clientEmail = process.env[`${prefix}_FIREBASE_CLIENT_EMAIL`] || process.env.FIREBASE_ADMIN_CLIENT_EMAIL || null
  const privateKey = process.env[`${prefix}_FIREBASE_PRIVATE_KEY`] || process.env.FIREBASE_ADMIN_PRIVATE_KEY || null

  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey: normaliseKey(privateKey),
    }
  }

  const pathCandidates = [
    process.env[`${prefix}_FIREBASE_SERVICE_ACCOUNT`],
    process.env[`${prefix}_FIREBASE_CREDENTIALS_PATH`],
    process.env[`${prefix}_GOOGLE_APPLICATION_CREDENTIALS`],
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    ...fallbacks,
  ].filter(Boolean)

  for (const candidate of pathCandidates) {
    const parsed = parseServiceAccountFile(candidate)
    if (parsed) {
      return {
        projectId: parsed.projectId,
        clientEmail: parsed.clientEmail,
        privateKey: normaliseKey(parsed.privateKey),
      }
    }
  }

  return null
}

function initApp(appName, prefix, extraFallbacks = []) {
  const existing = getApps().find((app) => app.name === appName)
  if (existing) {
    return existing
  }

  const serviceAccount = resolveServiceAccount(prefix, extraFallbacks)
  if (!serviceAccount) {
    throw new Error(`Firebase admin credentials are not configured for ${appName}`)
  }

  return initializeApp(
    {
      credential: cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
      }),
    },
    appName,
  )
}

function getCostModelAuth() {
  const app = initApp('cost-model-admin', 'COSTMODEL', [path.join(__dirname, 'cost-model-service-account.json')])
  return getAuth(app)
}

function getProposalAuth() {
  const app = initApp('proposal-admin', 'PROPOSAL', [path.join(__dirname, 'proposal-service-account.json')])
  return getAuth(app)
}

module.exports = {
  getCostModelAuth,
  getProposalAuth,
}
