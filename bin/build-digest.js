#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { curate, BUCKETS } = require('../lib/curate');
const { dedupeKey } = require('../lib/windowing');

const LABELS = {
  thisWeek: 'This Week',
  thisWeekend: 'This Weekend',
  nextWeek: 'Next Week',
  nextWeekend: 'Next Weekend',
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function buildSections(curated, runDateISO) {
  const isSunday = new Date(runDateISO).getDay() === 0;
  let html = '';
  for (const b of BUCKETS) {
    const items = curated[b] || [];
    if (items.length === 0) continue;
    if (b === 'thisWeekend' && isSunday) continue; // decision #3: hide on Sunday
    html += `<section class="bucket"><h2>${LABELS[b]}</h2>\n`;
    for (const e of items) {
      html += `  <article class="event" data-key="${esc(dedupeKey(e))}">
    <a class="name" href="${esc(e.url)}">${esc(e.name)}</a>
    <div class="meta">${esc(e.dateISO)} · ${esc(e.venue)} · ${esc(e.price || '')}</div>
    <p class="why">${esc(e.why || '')}</p>
  </article>\n`;
    }
    html += `</section>\n`;
  }
  return html;
}

function main() {
  const root = path.join(__dirname, '..');
  const runDateISO = process.env.RUN_DATE || new Date().toISOString();
  const events = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'));
  const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8');

  const volume = Number(process.env.VOLUME_PER_BUCKET) || 12;
  const curated = curate(events, state, runDateISO, volume);
  const sectionsHtml = buildSections(curated, runDateISO);
  const out = template.replace('<!--SECTIONS-->', sectionsHtml);

  const day = runDateISO.slice(0, 10);
  fs.mkdirSync(path.join(root, 'digests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'digests', `${day}.html`), out);
  fs.writeFileSync(path.join(root, 'digests', 'index.html'), out);

  const newlyFeatured = BUCKETS.flatMap((b) => (curated[b] || []).map(dedupeKey));
  state.seen_events = Array.from(new Set([...(state.seen_events || []), ...newlyFeatured]));
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(state, null, 2));

  const counts = BUCKETS.map((b) => `${LABELS[b]}: ${curated[b].length}`).join(', ');
  console.log(`Built digests/${day}.html — ${counts}`);
}

if (require.main === module) main();
module.exports = { buildSections };
