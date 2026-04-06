'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = 3847;
const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes
const FEEDBACK_FILE = path.join(__dirname, 'feedback', 'responses.json');
const DIGESTS_DIR = path.join(__dirname, 'digests');

let feedbackDirty = false;
let inactivityTimer = null;

function resetTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    console.log('Inactivity timeout — shutting down...');
    shutdown();
  }, INACTIVITY_MS);
}

function commitAndPush() {
  if (!feedbackDirty) {
    console.log('No new feedback to commit.');
    return;
  }
  try {
    execFileSync('git', ['add', 'feedback/responses.json'], { cwd: __dirname });
    try {
      execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: __dirname });
      // exit 0 means no staged changes
      console.log('No staged changes to commit.');
    } catch (e) {
      // exit non-zero means there are staged changes — commit
      execFileSync('git', ['commit', '-m', 'feedback: user responses'], { cwd: __dirname });
      execFileSync('git', ['push'], { cwd: __dirname });
      console.log('Feedback committed and pushed.');
    }
  } catch (err) {
    console.error('Git operation failed:', err.message);
  }
}

function shutdown() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  commitAndPush();
  process.exit(0);
}

process.on('SIGINT', () => {
  console.log('SIGINT received — shutting down...');
  shutdown();
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down...');
  shutdown();
});

function readFeedback() {
  try {
    const raw = fs.readFileSync(FEEDBACK_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeFeedback(entries) {
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(entries, null, 2), 'utf8');
}

function serveRoot(res) {
  let files = [];
  try {
    files = fs.readdirSync(DIGESTS_DIR)
      .filter(f => f.endsWith('.html'))
      .sort()
      .reverse();
  } catch (e) {
    // digests dir missing or unreadable
  }

  const links = files.map(f =>
    `    <li><a href="/digests/${encodeURIComponent(f)}">${f}</a></li>`
  ).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Event Digests</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    ul { list-style: none; padding: 0; }
    li { margin: 0.5rem 0; }
    a { color: #0070f3; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Event Digests</h1>
  <ul>
${links}
  </ul>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function serveDigest(filename, res) {
  const safe = path.basename(filename);
  const filePath = path.join(DIGESTS_DIR, safe);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

function handleFeedback(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      return;
    }

    const entries = readFeedback();
    entries.push(parsed);
    writeFeedback(entries);
    feedbackDirty = true;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

const server = http.createServer((req, res) => {
  resetTimer();

  const url = req.url || '/';
  const method = req.method || 'GET';

  if (method === 'GET' && url === '/') {
    serveRoot(res);
  } else if (method === 'GET' && url.startsWith('/digests/')) {
    const filename = decodeURIComponent(url.slice('/digests/'.length));
    serveDigest(filename, res);
  } else if (method === 'POST' && url === '/feedback') {
    handleFeedback(req, res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  resetTimer();
});
