require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

(async () => {
  try {
    const key = process.env.REACT_APP_PDFSHIFT_KEY || process.env.PDFSHIFT_API_KEY;
    if (!key) {
      console.error('No PDFShift API key found');
      process.exit(1);
    }

    const html = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello from PDFShift test</h1></body></html>';

    const res = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'X-API-Key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: html,
        sandbox: false,
      }),
    });

    console.log('Status:', res.status);
    const contentType = res.headers.get('content-type');
    console.log('Content-Type:', contentType);

    if (!res.ok) {
      const text = await res.text();
      console.error('Error response:', text);
      process.exit(1);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    require('fs').writeFileSync('pdfshift-test.pdf', buffer);
    console.log('Wrote pdfshift-test.pdf');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
})();
