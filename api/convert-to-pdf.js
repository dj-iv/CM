import { gunzipSync } from 'node:zlib';

const INLINE_IMAGE_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

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
      // Ignore fetch failures and leave src unmodified
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

// Vercel serverless function to convert proposal HTML into a PDF via PDFShift

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '15mb',
    },
  },
};

const { PDFSHIFT_API_KEY } = process.env;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const PDFSHIFT_ENDPOINT = 'https://api.pdfshift.io/v3/convert/pdf';
const DEFAULT_FILENAME = 'UCtel_Proposal';

const sanitizeFilename = (name) => {
  if (!name || typeof name !== 'string') {
    return DEFAULT_FILENAME;
  }

  const sanitized = name.replace(/[^a-z0-9_-]+/gi, '_');
  return sanitized || DEFAULT_FILENAME;
};

const buildPayload = ({ html, css, options }) => {
  const payload = {
    source: html,
    sandbox: false,
  };

  if (css) {
    payload.stylesheets = Array.isArray(css) ? css : [css];
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

const createErrorResponse = (res, status, message, details) => {
  res.status(status).json({ error: message, details });
};

export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return createErrorResponse(res, 405, 'Method not allowed. Use POST.');
  }

  if (!PDFSHIFT_API_KEY) {
    return createErrorResponse(res, 500, 'PDFShift API key is not configured on the server.');
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

  if ((!htmlContent || typeof htmlContent !== 'string' || !htmlContent.trim())
      && typeof data === 'string'
      && encoding === 'gzip-base64') {
    try {
      const decompressed = gunzipSync(Buffer.from(data, 'base64')).toString('utf8');
      htmlContent = decompressed;
    } catch (decompressionError) {
      return createErrorResponse(
        res,
        400,
        'Failed to decode compressed HTML payload.',
        decompressionError instanceof Error ? decompressionError.message : undefined,
      );
    }
  }

  if (!htmlContent || typeof htmlContent !== 'string' || !htmlContent.trim()) {
    return createErrorResponse(res, 400, 'Missing HTML content to convert.');
  }

  try {
    const enrichedHtml = await inlineRemoteImages(htmlContent, origin);
    const payload = buildPayload({ html: enrichedHtml, css, options });

    const pdfResponse = await fetch(PDFSHIFT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': PDFSHIFT_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!pdfResponse.ok) {
      let errorMessage = 'Failed to generate PDF via PDFShift.';
      let errorDetails;

      try {
        const responseText = await pdfResponse.text();
        try {
          const parsed = JSON.parse(responseText);
          errorDetails = parsed;
          errorMessage = parsed?.error || parsed?.message || errorMessage;
        } catch (parseError) {
          errorDetails = responseText;
        }
      } catch (readError) {
        // Ignore secondary errors when reading response text
      }

      console.error('PDFShift API error', {
        status: pdfResponse.status,
        message: errorMessage,
        details: errorDetails,
      });

      return createErrorResponse(res, pdfResponse.status, errorMessage, errorDetails);
    }

    const arrayBuffer = await pdfResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const safeFilename = sanitizeFilename(filename);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.pdf"`);

    return res.status(200).send(buffer);
  } catch (error) {
    console.error('PDFShift conversion failed:', error);
    return createErrorResponse(
      res,
      500,
      'Failed to generate PDF via PDFShift.',
      error instanceof Error ? error.message : undefined,
    );
  }
}
