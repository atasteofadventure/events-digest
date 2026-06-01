#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// The build embeds the subject as a leading <!--SUBJECT:...--> comment in email.html.
function extractSubject(html, fallback) {
  const m = String(html || '').match(/^<!--SUBJECT:([\s\S]*?)-->/);
  return (m ? m[1].trim() : '') || fallback || 'NYC Events Digest';
}

// POST the HTML to Resend. fetchImpl is injectable for tests; defaults to global fetch.
async function sendEmail({ apiKey, to, from, subject, html, fetchImpl }) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) throw new Error('no fetch available (Node 18+ required)');
  const res = await f(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + text);
  return text;
}

async function main() {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'digests', 'email.html'), 'utf8');
  const subject = extractSubject(html);
  const to = process.env.EMAIL_TO;
  const from = process.env.EMAIL_FROM || 'NYC Events Digest <onboarding@resend.dev>';
  const apiKey = process.env.RESEND_API_KEY;

  if (process.env.DRY_RUN) {
    console.log('[dry-run] would send this email:');
    console.log('  to:     ' + (to || '(EMAIL_TO unset)'));
    console.log('  from:   ' + from);
    console.log('  subject:' + subject);
    console.log('  bytes:  ' + html.length);
    return;
  }
  if (!apiKey) throw new Error('RESEND_API_KEY is not set');
  if (!to) throw new Error('EMAIL_TO is not set');
  await sendEmail({ apiKey, to, from, subject, html });
  console.log('Sent "' + subject + '" -> ' + to);
}

if (require.main === module) {
  main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
}
module.exports = { extractSubject, sendEmail };
