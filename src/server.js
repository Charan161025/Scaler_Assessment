'use strict';

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { FakeMap } = require('./fakeMap');
const { redactDocx } = require('./docxProcessor');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: os.tmpdir() });

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>PII Redaction Tool</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; }
      h1 { font-size: 1.4rem; }
      form { border: 1px solid #ddd; border-radius: 8px; padding: 24px; margin-top: 24px; }
      button { background: #111; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; }
      button:hover { background: #333; }
      .note { color: #666; font-size: 0.9rem; margin-top: 16px; }
    </style>
  </head>
  <body>
    <h1>PII Redaction Tool</h1>
    <p>Upload a .docx file. Detected PII (names, emails, phone numbers, companies, addresses, SSNs, credit cards, IPs, dates of birth) will be replaced with consistent fake values, and you'll get back a redacted .docx with the original formatting preserved.</p>
    <form action="/redact" method="post" enctype="multipart/form-data">
      <input type="file" name="file" accept=".docx" required />
      <br /><br />
      <button type="submit">Redact document</button>
    </form>
    <p class="note">Source: see the GitHub repo linked with this submission for the detection/redaction approach and evaluation report.</p>
  </body>
</html>`);
});

app.post('/redact', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Send a .docx under the "file" field.' });
  }

  const inputPath = req.file.path;
  const originalName = req.file.originalname || 'document.docx';
  const outputPath = path.join(os.tmpdir(), `redacted-${Date.now()}-${originalName}`);

  const cleanup = () => {
    fs.unlink(inputPath, () => {});
    fs.unlink(outputPath, () => {});
  };

  try {
    const fakeMap = new FakeMap();
    const result = redactDocx(inputPath, outputPath, fakeMap);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="redacted-${originalName}"`
    );
    res.setHeader('X-Redaction-Count', String(result.matchCount));
    res.setHeader('X-Skipped-Cross-Run-Matches', String(result.skippedCrossRunMatches));

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on('close', cleanup);
    stream.on('error', () => {
      cleanup();
      if (!res.headersSent) res.status(500).json({ error: 'Failed to stream redacted file.' });
    });
  } catch (err) {
    cleanup();
    console.error('Redaction error:', err);
    res.status(500).json({ error: `Redaction failed: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`PII redaction service listening on port ${PORT}`);
});