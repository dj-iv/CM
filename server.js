require('dotenv').config();

const express = require('express');
const path = require('path');
const { gunzipSync } = require('zlib');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const {
  verifyPortalToken,
  createSessionCookie,
  getSessionCookieName,
  parseCookies,
  sanitizeRedirect,
  buildPortalLoginUrl,
  buildPortalLaunchUrl,
  decodeSessionCookie,
} = require('./portalAuth');
const { getCostModelAuth, getProposalAuth } = require('./firebaseAdmin');

if (typeof globalThis.btoa !== 'function') {
  globalThis.btoa = (input) => Buffer.from(input).toString('base64');
}

const INLINE_IMAGE_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

const APP_ID = 'cost';
const SESSION_COOKIE_NAME = getSessionCookieName();
const PUBLIC_PATHS = new Set(['/healthz', '/portal/callback']);
const STATIC_PATH_REGEX = /\.(?:css|js|map|png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf)$/i;
const PORTAL_BASE_URL = process.env.NEXT_PUBLIC_PORTAL_URL || process.env.PORTAL_URL || 'http://localhost:3000';
const COOKIE_CLEAR_OPTIONS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: PORTAL_BASE_URL.startsWith('https://') || process.env.NODE_ENV === 'production',
};

function buildPortalLogoutUrl(redirect) {
  try {
    const url = new URL('/login', PORTAL_BASE_URL);
    if (redirect) {
      url.searchParams.set('redirect', redirect);
    }
    url.searchParams.set('logout', '1');
    return url.toString();
  } catch (error) {
    console.warn('[cost-model] Failed to build portal logout URL', { error });
    return buildPortalLoginUrl(redirect);
  }
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, COOKIE_CLEAR_OPTIONS);
}

async function ensureFirebaseUser(auth, { uid, email, displayName }) {
  const syncDisplayName = async (targetUid, currentDisplayName) => {
    if (!displayName || currentDisplayName === displayName) {
      return;
    }

    try {
      await auth.updateUser(targetUid, { displayName });
    } catch (updateError) {
      console.warn('[cost-model] syncDisplayName failed', { targetUid, displayName, updateError });
    }
  };

  const resolveEmailOwner = async () => {
    if (!email) {
      return null;
    }

    try {
      const existing = await auth.getUserByEmail(email);
      await syncDisplayName(existing.uid, existing.displayName);
      return existing;
    } catch (lookupError) {
      if (lookupError?.code !== 'auth/user-not-found') {
        console.warn('[cost-model] resolveEmailOwner lookup failed', { email, lookupError });
      }
      return null;
    }
  };

  try {
    const record = await auth.getUser(uid);
    const updates = {};

    if (email) {
      if (!record.email) {
        updates.email = email;
      } else if (record.email !== email) {
        const emailOwner = await resolveEmailOwner();
        if (emailOwner && emailOwner.uid !== uid) {
          return emailOwner;
        }
        updates.email = email;
      }
    }

    if (displayName && record.displayName !== displayName) {
      updates.displayName = displayName;
    }

    if (Object.keys(updates).length > 0) {
      try {
        await auth.updateUser(uid, updates);
      } catch (updateError) {
        if (email && updateError?.code === 'auth/email-already-exists') {
          const emailOwner = await resolveEmailOwner();
          if (emailOwner) {
            return emailOwner;
          }
        }
        console.warn('[cost-model] Failed to update Firebase user', { uid, updates, updateError });
      }
    }

    const refreshed = await auth.getUser(uid);
    await syncDisplayName(refreshed.uid, refreshed.displayName);
    return refreshed;
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      try {
        const created = await auth.createUser({
          uid,
          email: email ?? undefined,
          displayName: displayName ?? undefined,
        });
        return created;
      } catch (createError) {
        if (email && createError?.code === 'auth/email-already-exists') {
          const emailOwner = await resolveEmailOwner();
          if (emailOwner) {
            return emailOwner;
          }
        }
        console.error('[cost-model] createUser failed', { uid, createError });
        throw createError;
      }
    }

    console.error('[cost-model] ensureFirebaseUser unexpected error', { uid, error });
    throw error;
  }
}

const getOrigin = (req) => {
  const protoHeader = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader.split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
};

const guessMimeType = (urlPath, fallback = 'application/octet-stream') => {
  if (!urlPath || typeof urlPath !== 'string') {
    return fallback;
  }

  const cleanPath = urlPath.split('?')[0].split('#')[0];
  const extension = cleanPath.substring(cleanPath.lastIndexOf('.') + 1).toLowerCase();

  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return fallback;
  }
};

const inlineRemoteImages = async (html, origin) => {
  if (!origin || typeof origin !== 'string') {
    return html;
  }

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch (invalidOriginError) {
    return html;
  }

  const matches = [...html.matchAll(INLINE_IMAGE_REGEX)];
  if (matches.length === 0) {
    return html;
  }

  const replacements = new Map();
  const uniqueSources = [...new Set(matches.map(([, src]) => src).filter(Boolean))];

  for (const src of uniqueSources) {
    if (!src || src.startsWith('data:')) {
      continue;
    }

    let absoluteUrl;
    try {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        const candidate = new URL(src);
        if (candidate.host !== originUrl.host) {
          continue;
        }
        absoluteUrl = candidate.href;
      } else {
        absoluteUrl = new URL(src, originUrl).href;
      }
    } catch (urlError) {
      continue;
    }

    try {
      const response = await fetch(absoluteUrl);
      if (!response.ok) {
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('content-type') || guessMimeType(absoluteUrl);
      const dataUri = `data:${contentType};base64,${buffer.toString('base64')}`;
      replacements.set(src, dataUri);
    } catch (fetchError) {
      // Ignore fetch errors for individual assets
    }
  }

  if (replacements.size === 0) {
    return html;
  }

  return html.replace(INLINE_IMAGE_REGEX, (match, src) => {
    const replacement = replacements.get(src);
    if (!replacement) {
      return match;
    }
    return match.replace(src, replacement);
  });
};

const buildPayload = ({ html, css, options }) => {
  const payload = {
    source: html,
    sandbox: false,
  };

  // Merge provided CSS into a single css string; support URLs via @import
  if (css) {
    if (Array.isArray(css)) {
      const merged = css.map((item) => {
        const isUrl = typeof item === 'string' && /^(https?:)?\/\//i.test(item);
        return isUrl ? `@import url("${item}");` : String(item);
      }).join('\n');
      payload.css = merged;
    } else if (typeof css === 'string') {
      const isUrl = /^(https?:)?\/\//i.test(css);
      payload.css = isUrl ? `@import url("${css}");` : css;
    }
  }

  if (options && typeof options === 'object') {
    const {
      use_print,
      landscape,
      margin,
      margins,
      header,
      footer,
      wait,
      page_size,
      format,
    } = options;

    if (typeof use_print === 'boolean') {
      payload.use_print = use_print;
    }

    if (typeof landscape === 'boolean') {
      payload.landscape = landscape;
    }

    const resolvedFormat = typeof format === 'string' ? format : page_size;
    if (typeof resolvedFormat === 'string' && resolvedFormat.trim()) {
      payload.format = resolvedFormat.trim().toUpperCase();
    }

    const resolvedMargins = margin || margins;
    if (typeof resolvedMargins === 'string') {
      payload.margin = resolvedMargins;
    } else if (resolvedMargins && typeof resolvedMargins === 'object') {
      const { top, right, bottom, left } = resolvedMargins;
      const fallback = '0mm';
      const marginParts = [top, right, bottom, left].map((value) =>
        typeof value === 'string' && value.trim() ? value.trim() : fallback,
      );
      payload.margin = marginParts.join(' ');
    }

    if (header && typeof header === 'object') {
      payload.header = header;
    }

    if (footer && typeof footer === 'object') {
      payload.footer = footer;
    }

    if (typeof wait === 'number' && Number.isFinite(wait) && wait > 0) {
      payload.delay = Math.round(wait * 1000);
    }
  }

  return payload;
};

const app = express();
const PORT = process.env.PORT || 8080;

const PDFSHIFT_API_KEY = process.env.PDFSHIFT_API_KEY || process.env.REACT_APP_PDFSHIFT_KEY;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) {
    return next();
  }

  if (STATIC_PATH_REGEX.test(req.path) || req.path.startsWith('/templates/')) {
    return next();
  }

  const hasSession = Boolean(parseCookies(req.headers.cookie || '')[SESSION_COOKIE_NAME]);
  if (hasSession) {
    return next();
  }

  const origin = getOrigin(req);
  const sanitizedTarget = sanitizeRedirect(req.originalUrl, origin);
  const absoluteRedirect = new URL(sanitizedTarget, origin).toString();
  const launchUrl = buildPortalLaunchUrl(APP_ID, absoluteRedirect);

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Portal session required', launch: launchUrl });
  }

  return res.redirect(launchUrl);
});

app.post('/api/session', async (req, res) => {
  const origin = getOrigin(req);
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  const session = decodeSessionCookie(sessionCookie);

  if (!session) {
    const redirectTarget = sanitizeRedirect(req.body?.redirect || '/', origin);
    const absoluteRedirect = new URL(redirectTarget, origin).toString();
    const launchUrl = buildPortalLaunchUrl(APP_ID, absoluteRedirect);
    return res.status(401).json({ error: 'NO_SESSION', launch: launchUrl });
  }

  try {
    const costAuth = getCostModelAuth();
    const proposalAuth = getProposalAuth();

    const [costUser, proposalUser] = await Promise.all([
      ensureFirebaseUser(costAuth, session),
      ensureFirebaseUser(proposalAuth, session),
    ]);

    const resolvedEmail = costUser.email || proposalUser.email || session.email || null;
    const resolvedDisplayName = costUser.displayName || proposalUser.displayName || session.displayName || null;

    if (costUser.uid !== session.uid || proposalUser.uid !== session.uid) {
      console.info('[cost-model] ensureFirebaseUser resolved alternate uid', {
        sessionUid: session.uid,
        costUid: costUser.uid,
        proposalUid: proposalUser.uid,
      });
    }

    const [costToken, proposalToken] = await Promise.all([
      costAuth.createCustomToken(costUser.uid, {
        portalApp: APP_ID,
        email: resolvedEmail ?? undefined,
        displayName: resolvedDisplayName ?? undefined,
      }),
      proposalAuth.createCustomToken(proposalUser.uid, {
        portalApp: 'proposal',
        email: resolvedEmail ?? undefined,
        displayName: resolvedDisplayName ?? undefined,
      }),
    ]);

    return res.json({
      success: true,
      email: resolvedEmail,
      displayName: resolvedDisplayName,
      costToken,
      proposalToken,
    });
  } catch (error) {
    console.error('[cost-model] Failed to mint custom tokens', error);
    return res.status(500).json({ error: 'TOKEN_CREATION_FAILED' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/portal/callback', (req, res) => {
  const origin = getOrigin(req);
  const token = req.query.portalToken;
  const redirectParam = Array.isArray(req.query.redirect) ? req.query.redirect[0] : req.query.redirect;
  const redirectTarget = sanitizeRedirect(redirectParam, origin);

  if (!token) {
    return res.redirect(buildPortalLoginUrl(redirectTarget));
  }

  const payload = verifyPortalToken(token);
  if (!payload || payload.appId !== APP_ID) {
    return res.redirect(buildPortalLoginUrl(redirectTarget));
  }

  const sessionCookie = createSessionCookie(payload);
  res.cookie(sessionCookie.name, sessionCookie.value, {
    httpOnly: sessionCookie.options.httpOnly,
    secure: sessionCookie.options.secure,
    sameSite: sessionCookie.options.sameSite,
    path: sessionCookie.options.path,
    maxAge: sessionCookie.options.maxAge * 1000,
  });

  const destination = new URL(redirectTarget, origin).toString();
  return res.redirect(destination);
});

app.get('/logout', (req, res) => {
  const origin = getOrigin(req);
  const redirectTarget = sanitizeRedirect(req.query.redirect || '/', origin);
  clearSessionCookie(res);
  const logoutUrl = buildPortalLogoutUrl(redirectTarget);
  return res.redirect(logoutUrl);
});

app.post('/logout', (req, res) => {
  const origin = getOrigin(req);
  const redirectTarget = sanitizeRedirect(req.body?.redirect || '/', origin);
  clearSessionCookie(res);
  const logoutUrl = buildPortalLogoutUrl(redirectTarget);
  return res.json({ success: true, redirect: logoutUrl });
});

app.post('/api/convert-to-pdf', async (req, res) => {
  if (!PDFSHIFT_API_KEY) {
    return res.status(500).json({ error: 'PDFShift API key is not configured on the server.' });
  }

  const {
    html,
    css,
    options,
    filename,
    encoding,
    data,
    origin,
  } = req.body || {};

  let htmlContent = html;

  console.info('[convert-to-pdf] incoming payload', {
    hasHtml: typeof html === 'string' && html.length,
    encoding,
    dataLength: typeof data === 'string' ? data.length : null,
    origin,
  });

  // If no raw HTML provided, try to decompress gzip-base64 data
  if ((!htmlContent || typeof htmlContent !== 'string' || !htmlContent.trim())
      && typeof data === 'string'
      && encoding === 'gzip-base64') {
    try {
      htmlContent = gunzipSync(Buffer.from(data, 'base64')).toString('utf8');
      console.info('[convert-to-pdf] decompressed html length', htmlContent.length);
    } catch (decompressionError) {
      return res.status(400).json({ error: 'Failed to decode compressed HTML payload.' });
    }
  }

  if (!htmlContent || typeof htmlContent !== 'string' || !htmlContent.trim()) {
    console.warn('[convert-to-pdf] missing html after processing');
    return res.status(400).json({ error: 'Missing HTML content to convert.' });
  }

  try {
    // 1) Sanitize: strip all <script> tags and inline event handlers to avoid client-side reflows in the PDF engine
    const stripScripts = (input) => {
      if (typeof input !== 'string') return input;
      let out = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      return out;
    };

    const sanitizedHtml = stripScripts(htmlContent);

    // Debug mode: return sanitized HTML for quick inspection (no image inlining)
    if (req.body && req.body.debug) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(sanitizedHtml);
    }

    // 2) Inline same-origin images so the PDF is self-contained
    const enrichedHtml = await inlineRemoteImages(sanitizedHtml, origin || `http://localhost:${PORT}`);

    // 3) Build PDFShift payload and apply safe defaults
    const payload = buildPayload({ html: enrichedHtml, css, options });
    if (options && options.footer && typeof options.footer === 'object' && !options.footer.height) {
      options.footer.height = '12mm';
    }

    console.log('[convert-to-pdf] sending request to PDFShift', {
      payloadSize: JSON.stringify(payload).length,
      hasHtml: !!payload.source,
      format: payload.format,
      margin: payload.margin,
    });

    // 4) Send to PDFShift with a timeout guard
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'X-API-Key': PDFSHIFT_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log('[convert-to-pdf] PDFShift response', {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
    });

    if (!response.ok) {
      let errorMessage = 'Failed to generate PDF via PDFShift.';
      let errorDetails = null;
      try {
        const text = await response.text();
        try {
          const errorBody = JSON.parse(text);
          errorDetails = errorBody;
          if (errorBody) {
            if (errorBody.error) {
              errorMessage = errorBody.error;
            } else if (errorBody.message) {
              errorMessage = errorBody.message;
            }
          }
        } catch (jsonErr) {
          errorDetails = text;
        }
      } catch (err) {
        // ignore error while reading response
      }

      console.error('[convert-to-pdf] PDFShift error', {
        status: response.status,
        message: errorMessage,
        details: errorDetails,
      });

      const error = new Error(errorMessage);
      error.statusCode = response.status;
      error.details = errorDetails;
      throw error;
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    console.log('[convert-to-pdf] PDF generated successfully', {
      size: pdfBuffer.length,
      filename: filename || 'UCtel_Proposal',
    });

    const safeFilename = (filename || 'UCtel_Proposal').replace(/[^a-z0-9_-]+/gi, '_');

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`,
    });

    return res.send(Buffer.from(pdfBuffer, 'binary'));
  } catch (error) {
    console.error('PDFShift conversion failed:', error);

    if (error.name === 'AbortError') {
      console.error('[convert-to-pdf] Request timed out after 60 seconds');
      return res.status(408).json({
        error: 'PDF generation timed out. Please try again with a smaller document.',
        details: 'Request exceeded 60 second limit',
      });
    }

    if (error && error.details) {
      console.error('PDFShift error details:', typeof error.details === 'string' ? error.details : JSON.stringify(error.details, null, 2));
    }
    const status = (error && error.statusCode) || 500;
    const message = error && error.message ? error.message : 'Failed to generate PDF via PDFShift.';
    return res.status(status).json({ error: message, details: error && error.details ? error.details : undefined });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
