#!/usr/bin/env node
'use strict';
// Merge per-source event batches (events-inbox/*.json) into events.json.
//
// The cloud routine writes one small JSON file per newsletter/source as it
// reads, instead of emitting all of events.json in a single response at the
// end of the run — a heavy week made that single response exceed the API's
// 32k output-token cap and killed the run before build/push (Aug 6 + Aug 13
// 2026). Batches on disk also survive mid-run context compaction.
//
// Each batch file is either an array of event objects or {"events": [...]}.
// Malformed batches fail loudly with the filename so the routine can rewrite
// that one small file and re-run the merge.

const fs = require('node:fs');
const path = require('node:path');

function mergeInbox(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`inbox directory not found: ${dir}`);
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) {
    throw new Error(`no .json batch files in ${dir} — extraction wrote nothing`);
  }
  const events = [];
  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (err) {
      throw new Error(`${file}: invalid JSON (${err.message}) — rewrite this one batch file and re-run`);
    }
    const batch = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.events) ? parsed.events : null;
    if (batch === null) {
      throw new Error(`${file}: expected an array of events or {"events": [...]}`);
    }
    batch.forEach((e, i) => {
      if (!e || typeof e !== 'object' || !e.id || !e.name) {
        throw new Error(`${file}: entry [${i}] is missing required id/name`);
      }
      events.push(e);
    });
  }
  return { events, files };
}

function main() {
  const root = path.join(__dirname, '..');
  const inbox = path.join(root, 'events-inbox');
  const out = path.join(root, 'events.json');
  const { events, files } = mergeInbox(inbox);
  fs.writeFileSync(out, JSON.stringify(events, null, 2) + '\n');
  console.log(`merged ${events.length} events from ${files.length} batch files into events.json`);
  for (const f of files) console.log(`  ${f}`);
}

if (require.main === module) {
  try { main(); } catch (err) { console.error(`merge-events: ${err.message}`); process.exit(1); }
}

module.exports = { mergeInbox };
