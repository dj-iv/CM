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
    } = options;

    if (typeof use_print === 'boolean') {
      payload.use_print = use_print;
    }

    if (typeof landscape === 'boolean') {
      payload.landscape = landscape;
    }

    const resolvedMargins = margin || margins;
    if (resolvedMargins && typeof resolvedMargins === 'object') {
      payload.margin = resolvedMargins;
    }

    if (header && typeof header === 'object') {
      payload.header = header;
    }

    if (footer && typeof footer === 'object') {
      payload.footer = footer;
    }

    if (typeof wait === 'number') {
      payload.wait = wait;
    }

    if (typeof page_size === 'string') {
      payload.page_size = page_size;
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

  const { html, css, options, filename } = req.body || {};

  if (!html || typeof html !== 'string' || !html.trim()) {
    return createErrorResponse(res, 400, 'Missing HTML content to convert.');
  }

  try {
    const payload = buildPayload({ html, css, options });

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
