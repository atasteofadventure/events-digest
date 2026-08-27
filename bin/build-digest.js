#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { curate, BUCKETS } = require('../lib/curate');
const { buildEmailHtml } = require('../lib/email');

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
    later: mapBucket(curated.later),
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

// Feed events are fetched separately (bin/fetch-feeds.js) into feed-events.json;
// merge them with the newsletter-extracted events before curation. curate()
// dedupes name+date+venue across the merged set and unions `via`.
function mergeFeedEvents(events, feedFile) {
  const feedEvents = (feedFile && Array.isArray(feedFile.events)) ? feedFile.events : [];
  return [...(events || []), ...feedEvents];
}

// Normalize a source label for matching: the cloud run labels `via` with its
// own slugs ("garysguide-newsletter") that must still match the configured
// name ("Gary's Guide"). Lowercase alphanumeric, common suffixes stripped.
function sourceKey(s) {
  return String(s)
    .replace(/^feed:\s*/, '')
    .replace(/-(newsletter|email|feed)$/i, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Visibility: which sources actually contributed this run, and which configured
// sources produced nothing (dead subscription, broken feed, or a quiet week).
// A feed ("feed: X") and a newsletter ("X") from the same organization are
// tracked separately — the dashboard shows which channel delivered what.
// `configured` entries may be plain names (matched against either channel) or
// { name, type } objects from config.json (type "feed" matches only the feed).
function sourceReport(events, configured) {
  const tally = new Map(); // key -> { source: display label, count }
  const isFeed = (v) => /^feed:\s*/i.test(String(v));
  const keyFor = (v, feed) => (feed ? 'feed:' : '') + sourceKey(v);
  for (const e of events || []) {
    const vias = Array.isArray(e.via) && e.via.length ? e.via : [e.source || 'unknown'];
    for (const v of vias) {
      const feed = isFeed(v);
      const key = keyFor(v, feed);
      const cur = tally.get(key) || { source: (feed ? 'feed: ' : '') + String(v).replace(/^feed:\s*/i, ''), count: 0 };
      cur.count += 1;
      tally.set(key, cur);
    }
  }
  const entries = (configured || []).map((c) => (typeof c === 'string' ? { name: c } : c));
  const keysFor = (c) => c.type === 'feed' ? [keyFor(c.name, true)]
    : c.type ? [keyFor(c.name, false)] : [keyFor(c.name, false), keyFor(c.name, true)];
  // Prefer the configured display name where a key matches.
  for (const c of entries) {
    for (const k of keysFor(c)) {
      const hit = tally.get(k);
      if (hit) hit.source = (k.startsWith('feed:') ? 'feed: ' : '') + c.name;
    }
  }
  const counts = [...tally.values()].sort((a, b) => b.count - a.count);
  const empty = entries.filter((c) => !keysFor(c).some((k) => tally.has(k))).map((c) => c.name);
  return { counts, empty, contributing: counts.length };
}

function main() {
  const root = path.join(__dirname, '..');
  const runDateISO = process.env.RUN_DATE || new Date().toISOString();
  const rawEvents = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'));
  const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8');

  const feedPath = path.join(root, 'feed-events.json');
  let feedFile = null;
  if (fs.existsSync(feedPath)) {
    try { feedFile = JSON.parse(fs.readFileSync(feedPath, 'utf8')); }
    catch { console.error('warning: feed-events.json unreadable; building without feeds'); }
  }
  const events = mergeFeedEvents(rawEvents, feedFile);

  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const configuredNames = (config.sources || [])
    .filter((s) => s.enabled !== false).map((s) => ({ name: s.name, type: s.type }));
  const report = sourceReport(events, configuredNames);
  if (feedFile && Array.isArray(feedFile.errors) && feedFile.errors.length) {
    report.feedErrors = feedFile.errors;
  }

  const total = Array.isArray(events) ? events.length : 0;
  const curated = curate(events, runDateISO);
  const data = buildData(curated, runDateISO, {
    title: `Week of ${runDateISO.slice(0, 10)}`, type: 'week', total_collected: total,
    source_report: { contributing: report.contributing, empty: report.empty, counts: report.counts },
  });
  let out = injectData(template, data);
  out = injectTitle(out, data.meta.title || 'Events Digest');

  const day = runDateISO.slice(0, 10);
  fs.mkdirSync(path.join(root, 'digests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'digests', `${day}.html`), out);
  fs.writeFileSync(path.join(root, 'digests', 'index.html'), out);
  // Email-safe flat version (sent weekly by the GitHub Action; see bin/send-email.js).
  fs.writeFileSync(path.join(root, 'digests', 'email.html'), buildEmailHtml(data));

  // Per-source coverage report — makes lopsided sourcing visible instead of silent.
  fs.writeFileSync(path.join(root, 'digests', 'sources.json'), JSON.stringify(report, null, 2));

  // No cross-run suppression — every digest shows the full current set. Record
  // only the run time so state.json stays a useful breadcrumb.
  state.last_run = runDateISO;
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(state, null, 2));

  const counts = BUCKETS.map((b) => `${b}: ${(data[b] || []).length}`).join(', ');
  console.log(`Built digests/${day}.html — ${counts}`);
  console.log(`Sources: ${report.contributing} contributed; empty: ${report.empty.join(', ') || 'none'}`);
  const st = curated._stats || {};
  const ex = Object.entries(st.excluded || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
  console.log(`Excluded: ${ex}`);
  console.log(`No URL (kept, flagged as web search): ${st.noUrl || 0}`);
  console.log(`Collapsed series occurrences: ${st.collapsed || 0}`);
  if (report.feedErrors) {
    for (const fe of report.feedErrors) console.log(`feed error: ${fe.source} — ${fe.error}`);
  }
}

if (require.main === module) main();
module.exports = { buildData, injectData, injectTitle, escapeForScript, mergeFeedEvents, sourceReport };
