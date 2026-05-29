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
  return {
    meta: meta || {},
    generated: runDateISO,
    thisWeek: curated.thisWeek || [],
    thisWeekend: isSunday ? [] : (curated.thisWeekend || []),
    nextWeek: curated.nextWeek || [],
    nextWeekend: curated.nextWeekend || [],
    discovered_sources: [],
  };
}

// Replace the template's /*__EVENTS_JSON__*/ ... /**/ marker with the data.
function injectData(template, data) {
  return template.replace(
    /\/\*__EVENTS_JSON__\*\/[\s\S]*?\/\*\*\//,
    '/*__EVENTS_JSON__*/' + JSON.stringify(data) + '/**/'
  );
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
  const out = injectData(template, data);

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
module.exports = { buildData, injectData };
