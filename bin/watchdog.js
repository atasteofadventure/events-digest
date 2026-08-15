#!/usr/bin/env node
'use strict';
// Dead-man switch: if no `digest:` commit landed recently, email an alert.
// Runs from .github/workflows/watchdog.yml every Wednesday 15:00 UTC — ~17h after
// the Tuesday 22:00 UTC routine run. The routine failing silently (no digest,
// no email, no signal — see the 2026-06-25 incident) is what this guards against.
const { execFileSync } = require('child_process');
const { sendEmail } = require('./send-email');

// Healthy gap is ~17h (Tue 22:00 → Wed 15:00); 40h catches a missed run while
// tolerating a same-week manual re-run on Wednesday morning.
const MAX_AGE_HOURS = 40;

function isStale(lastEpochSec, nowEpochSec, maxAgeHours) {
  if (!lastEpochSec) return true;
  return (nowEpochSec - lastEpochSec) > maxAgeHours * 3600;
}

function alertHtml(hoursSince) {
  const since = hoursSince == null
    ? 'never (no digest commit found)'
    : `${Math.round(hoursSince)}h ago`;
  return '<div style="font-family:sans-serif">'
    + '<h2>NYC Events Digest did not run this week</h2>'
    + `<p>Last <code>digest:</code> commit: ${since}. No digest email was sent.</p>`
    + '<p>Check the routine transcript: '
    + '<a href="https://claude.ai/code/routines/trig_01Hef3r9byEvZAeMTo8rtgzD">routine dashboard</a>. '
    + 'Usual suspects: GitHub push credential (re-run /web-setup), Gmail connector auth.</p>'
    + '<p><a href="https://events-digest.vercel.app">Current (stale) dashboard</a></p>'
    + '</div>';
}

function lastDigestEpoch() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--grep=^digest:', '--'], { encoding: 'utf8' }).trim();
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

async function main() {
  const last = lastDigestEpoch();
  const now = Math.floor(Date.now() / 1000);
  if (!isStale(last, now, MAX_AGE_HOURS)) {
    console.log(`Digest is fresh (${Math.round((now - last) / 3600)}h old); no alert.`);
    return;
  }
  const hours = last ? (now - last) / 3600 : null;
  if (process.env.DRY_RUN) {
    console.log('[dry-run] digest is STALE; would send alert. Hours since last digest:', hours == null ? 'none found' : Math.round(hours));
    return;
  }
  await sendEmail({
    apiKey: process.env.RESEND_API_KEY,
    to: process.env.EMAIL_TO,
    from: process.env.EMAIL_FROM || 'NYC Events Digest <onboarding@resend.dev>',
    subject: '⚠️ NYC Events Digest did not run this week',
    html: alertHtml(hours),
  });
  console.log('Alert sent.');
}

if (require.main === module) {
  main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}
module.exports = { isStale, alertHtml, MAX_AGE_HOURS };
