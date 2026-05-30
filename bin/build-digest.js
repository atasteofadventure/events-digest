#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { curate, BUCKETS } = require('../lib/curate');
const { dedupeKey } = require('../lib/windowing');

// Shape the curated buckets into the JSON the client-side template renders.
// Decision #3: hide "This Weekend" on Sunday runs (build-time, so it is not
// marked as seen and can resurface in a later run).
function buildData(curated, runDateISO, meta) {
  const isSunday = new Date(runDateISO).getDay() === 0;
  // The template renderer expects evt.date as YYYY-MM-DD (and evt.time
  // separately); our events carry dateISO. Bridge it here, and drop the
  // internal _bucket marker.
  const forTemplate = (e) => {
    const { _bucket, ...rest } = e;
    return { ...rest, date: (e.dateISO || '').slice(0, 10) };
  };
  const mapBucket = (arr) => (arr || []).map(forTemplate);
  return {
    meta: meta || {},
    generated: runDateISO,
    thisWeek: mapBucket(curated.thisWeek),
    thisWeekend: isSunday ? [] : mapBucket(curated.thisWeekend),
    nextWeek: mapBucket(curated.nextWeek),
    nextWeekend: mapBucket(curated.nextWeekend),
    discovered_sources: [],
  };
}

// Escape a JSON string for safe embedding inside a <script> context. Event data
// comes from untrusted newsletter content, so a field containing "</script>"
// (or the line/paragraph separators U+2028/U+2029) could otherwise break out of
// the script and execute. Each unsafe character becomes its \uXXXX form, which
// the JS parser restores to the original character, so data fidelity is kept.
// (Match chars are built via fromCharCode so the source carries no literal
// separators; replacements are ordinary backslash-u text.)
function escapeForScript(json) {
  return json
    .split('<').join('\\u003c')
    .split('>').join('\\u003e')
    .split('&').join('\\u0026')
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');
}

// Replace the template's /*__EVENTS_JSON__*/ ... /**/ marker with the data.
function injectData(template, data) {
  return template.replace(
    /\/\*__EVENTS_JSON__\*\/[\s\S]*?\/\*\*\//,
    '/*__EVENTS_JSON__*/' + escapeForScript(JSON.stringify(data)) + '/**/'
  );
}

// Replace the <title> placeholder with the HTML-escaped digest title.
function injectTitle(template, title) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return template.replace(/__DIGEST_TITLE__/g, esc(title));
}

function main() {
  const root = path.join(__dirname, '..');
  const runDateISO = process.env.RUN_DATE || new Date().toISOString();
  const events = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'));
  const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8');

  const volume = Number(process.env.VOLUME_PER_BUCKET) || 12;
  const curated = curate(events, state, runDateISO, volume);
  const data = buildData(curated, runDateISO, { title: `Week of ${runDateISO.slice(0, 10)}`, type: 'week' });
  let out = injectData(template, data);
  out = injectTitle(out, data.meta.title || 'Events Digest');

  const day = runDateISO.slice(0, 10);
  fs.mkdirSync(path.join(root, 'digests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'digests', `${day}.html`), out);
  fs.writeFileSync(path.join(root, 'digests', 'index.html'), out);

  // Mark only what was actually shown (post Sunday-hide) as seen.
  const shown = ['thisWeek', 'thisWeekend', 'nextWeek', 'nextWeekend']
    .flatMap((b) => (data[b] || []).map(dedupeKey));
  state.seen_events = Array.from(new Set([...(state.seen_events || []), ...shown]));
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(state, null, 2));

  const counts = BUCKETS.map((b) => `${b}: ${(data[b] || []).length}`).join(', ');
  console.log(`Built digests/${day}.html — ${counts}`);
}

if (require.main === module) main();
module.exports = { buildData, injectData, injectTitle, escapeForScript };
