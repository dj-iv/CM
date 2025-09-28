const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { gzipSync } = require('zlib');
const fetch = require('node-fetch');

const PORT = 9191;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: {
    ...process.env,
    PORT: String(PORT),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let ready = false;

const shutdown = (code = 0) => {
  server.kill();
  setTimeout(() => {
    process.exit(code);
  }, 250);
};

const runTest = async () => {
  const DEBUG_HTML = process.env.DEBUG_HTML === '1' || process.argv.includes('--debug');
  const htmlPath = path.join(__dirname, '..', 'public', 'interactive-proposal.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const payload = {
    encoding: 'gzip-base64',
    data: gzipSync(html).toString('base64'),
    filename: 'footer-spacing-check',
    options: {
      page_size: 'a4',
      margin: '0mm',
    },
    origin: ORIGIN,
    debug: DEBUG_HTML,
  };

  const response = await fetch(`${ORIGIN}/api/convert-to-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  console.log('status', response.status);
  const buffer = Buffer.from(await response.arrayBuffer());
  console.log('bytes', buffer.length);

  if (DEBUG_HTML) {
    const htmlOut = path.join(__dirname, '..', 'transformed.html');
    fs.writeFileSync(htmlOut, buffer);
    console.log('Transformed HTML written to', htmlOut);
  } else {
    const outputPath = path.join(__dirname, 'footer-check.pdf');
    fs.writeFileSync(outputPath, buffer);
    console.log('PDF written to', outputPath);
  }

  shutdown(response.ok ? 0 : 1);
};

server.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (!ready && chunk.toString().includes('Server listening')) {
    ready = true;
    runTest().catch((err) => {
      console.error(err);
      shutdown(1);
    });
  }
});

server.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
