require('dotenv').config();

const express = require('express');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

if (typeof globalThis.btoa !== 'function') {
  globalThis.btoa = (input) => Buffer.from(input).toString('base64');
}

const app = express();
const PORT = process.env.PORT || 8080;

const PDFSHIFT_API_KEY = process.env.PDFSHIFT_API_KEY || process.env.REACT_APP_PDFSHIFT_KEY;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/convert-to-pdf', async (req, res) => {
  if (!PDFSHIFT_API_KEY) {
    return res.status(500).json({ error: 'PDFShift API key is not configured on the server.' });
  }

  const { html, css, options, filename } = req.body || {};

  if (!html) {
    return res.status(400).json({ error: 'Missing HTML content to convert.' });
  }

  try {
    const payload = {
      source: html,
      sandbox: false,
    };

    if (css) {
      payload.stylesheets = [css];
    }

    if (options) {
      const {
        use_print,
        landscape,
        margin,
        margins,
        header,
        footer,
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
    }

    const response = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'X-API-Key': PDFSHIFT_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
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

      const error = new Error(errorMessage);
      error.statusCode = response.status;
      error.details = errorDetails;
      throw error;
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    const safeFilename = (filename || 'UCtel_Proposal').replace(/[^a-z0-9_-]+/gi, '_');

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`,
    });

    return res.send(Buffer.from(pdfBuffer, 'binary'));
  } catch (error) {
    console.error('PDFShift conversion failed:', error);
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
