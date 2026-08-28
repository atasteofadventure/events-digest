#!/usr/bin/env node
'use strict';
// LLM tie-breaker for duplicate detection.
//
// lib/dedupe.js merges clear duplicates and keeps clear non-duplicates apart on
// its own. The ambiguous middle band (same day, venue compatible, names related
// but below the auto-merge thresholds, or blocked only by a word like
// "opening"/"tour") is printed here for the routine model to judge. It answers
// by writing events-inbox/_merges.json:
//
//   [{ "a": "<id>", "b": "<id>", "same": true }, ...]
//
// which bin/build-digest.js applies. Only the candidate pairs printed here are
// considered; the file is small, on disk, and auditable. Without the file the
// build behaves exactly as before.

const fs = require('node:fs');
const path = require('node:path');
const { candidatePairs } = require('../lib/dedupe');
const { applyExclusions } = require('../lib/filters');

function loadEvents(root) {
  const events = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'));
  const feedPath = path.join(root, 'feed-events.json');
  let feed = [];
  if (fs.existsSync(feedPath)) {
    try { feed = JSON.parse(fs.readFileSync(feedPath, 'utf8')).events || []; } catch { feed = []; }
  }
  return [...events, ...feed];
}

function brief(e) {
  return {
    id: e.id, name: e.name, venue: e.venue || '', time: (e.dateISO || '').slice(11, 16), url: e.url || '',
    via: e.via || [], why: String(e.why || '').slice(0, 140),
  };
}

function main() {
  const root = path.join(__dirname, '..');
  const runDate = process.env.RUN_DATE || new Date().toISOString();
  const today = runDate.slice(0, 10);
  const all = applyExclusions(loadEvents(root)).kept
    .filter((e) => String(e.dateISO || '').slice(0, 10) >= today);   // past events are dropped anyway
  const pairs = candidatePairs(all, { limit: 60 });
  const out = pairs.map((p, i) => ({ n: i + 1, day: (p.a.dateISO || '').slice(0, 10), score: +p.score.toFixed(2), blocked_by: p.reason, a: brief(p.a), b: brief(p.b) }));
  fs.mkdirSync(path.join(root, 'events-inbox'), { recursive: true });
  fs.writeFileSync(path.join(root, 'events-inbox', '_candidates.json'), JSON.stringify(out, null, 2));
  console.log(`${out.length} ambiguous pair(s) need a verdict (written to events-inbox/_candidates.json).`);
  if (!out.length) { console.log('Nothing to review — skip writing events-inbox/_merges.json.'); return; }
  for (const p of out) {
    console.log(`\n#${p.n}  ${p.day}  score ${p.score}  (${p.blocked_by})`);
    console.log(`  A [${p.a.id}] ${p.a.name} | ${p.a.venue} | ${p.a.time} | ${p.a.via.join(', ')}`);
    if (p.a.why) console.log(`      ${p.a.why}`);
    console.log(`  B [${p.b.id}] ${p.b.name} | ${p.b.venue} | ${p.b.time} | ${p.b.via.join(', ')}`);
    if (p.b.why) console.log(`      ${p.b.why}`);
  }
  console.log('\nWrite events-inbox/_merges.json as [{"a":"<id>","b":"<id>","same":true|false}, ...] for the pairs above, then run the build.');
}

if (require.main === module) main();
module.exports = { brief };
