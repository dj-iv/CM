const SESSION_COOKIE = 'uctel_proposal_session'
const SESSION_DURATION_SECONDS = 60 * 60 * 5 // 5 hours

export interface SessionCookiePayload {
  uid: string
  email: string | null
  displayName: string | null
}

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null
const nodeBuffer: typeof Buffer | null =
  typeof globalThis !== 'undefined' && typeof (globalThis as { Buffer?: typeof Buffer }).Buffer !== 'undefined'
    ? (globalThis as { Buffer?: typeof Buffer }).Buffer ?? null
    : null

function toBase64Url(input: string): string {
  try {
    if (typeof btoa === 'function' && textEncoder) {
      const bytes = textEncoder.encode(input)
      let binary = ''
      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index])
      }
      const base64 = btoa(binary)
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
    }
  } catch (error) {
    console.warn('[proposal] toBase64Url fell back to Buffer', error)
  }

  if (nodeBuffer) {
    return nodeBuffer.from(input, 'utf8').toString('base64url')
  }

  throw new Error('Base64 encoding unsupported in this environment')
}

function fromBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')

  try {
    if (typeof atob === 'function' && textDecoder) {
      const binary = atob(padded)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      return textDecoder.decode(bytes)
    }
  } catch (error) {
    console.warn('[proposal] fromBase64Url fell back to Buffer', error)
  }

  if (nodeBuffer) {
    return nodeBuffer.from(input, 'base64url').toString('utf8')
  }

  throw new Error('Base64 decoding unsupported in this environment')
}

function serialise(value: string | { uid: string; email?: string | null; displayName?: string | null }): string {
  const payload: SessionCookiePayload = typeof value === 'string'
    ? { uid: value, email: null, displayName: null }
    : {
        uid: value.uid,
        email: value.email ?? null,
        displayName: value.displayName ?? null,
      }
  return toBase64Url(JSON.stringify(payload))
}

export { SESSION_COOKIE, SESSION_DURATION_SECONDS }

export function getSessionCookieName() {
  return SESSION_COOKIE
}

export function encodeSessionValue(value: string | { uid: string; email?: string | null; displayName?: string | null }) {
  return serialise(value)
}

export function decodeSessionValue(value: string | undefined | null): SessionCookiePayload | null {
  if (!value) {
    return null
  }

  try {
    const decoded = fromBase64Url(value)
    const parsed = JSON.parse(decoded) as Partial<SessionCookiePayload> | null
    if (!parsed || typeof parsed.uid !== 'string' || !parsed.uid.trim()) {
      return null
    }
    return {
      uid: parsed.uid,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : null,
    }
  } catch (error) {
    console.warn('[proposal] decodeSessionValue failed; falling back to opaque UID', error)
    return {
      uid: value,
      email: null,
      displayName: null,
    }
  }
}
