'use strict';
const { bucketFor } = require('./windowing');
const { isDuplicate, exactKey, normName, normVenue } = require('./dedupe');
const { applyExclusions } = require('./filters');

const BUCKETS = ['thisWeek', 'thisWeekend', 'nextWeek', 'nextWeekend', 'later'];

// Duplicate detection lives in lib/dedupe.js (URL identity, name normalization,
// bigram/token similarity, venue compatibility, time proximity, event-type
// discriminators). curate() runs an exact-key pass and then a same-day fuzzy pass.
const normText = (s) => normName(s || '', '');

// First-seen record wins; the duplicate contributes its `via` and fills any
// fields the kept record is missing.
function mergeInto(kept, dup) {
  kept.via = Array.from(new Set([...(kept.via || []), ...(dup.via || [])]));
  for (const f of ['time', 'price', 'url', 'why', 'neighborhood', 'category']) {
    if (!kept[f] && dup[f]) kept[f] = dup[f];
  }
  if (kept.url) delete kept.urlMissing;             // the duplicate supplied a real link
}

const hasRealUrl = (e) => /^https?:\/\//i.test(String((e && e.url) || '').trim());
// A Google-search URL is not an event page; treat it as missing so a real link
// from another source can fill it in, and so the page can label it honestly.
const isSearchUrl = (e) => /^https?:\/\/(www\.)?google\.[a-z.]+\/search/i.test(String((e && e.url) || ''));

// A series that repeats on many dates (daily exhibition hours, a weekly class)
// is shown once, at its first upcoming date, with a "runs through" marker —
// the reader asked for the opening date, not one card per day. Threshold: 3+
// distinct dates for the same name at the same venue.
const SERIES_MIN_DATES = 3;
function collapseSeries(records) {
  const groups = new Map();
  for (const e of records) {
    const k = `${normName(e.name, e.venue)}|${normVenue(e.venue)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const drop = new Set();
  for (const g of groups.values()) {
    const days = new Set(g.map(e => (e.dateISO || '').slice(0, 10)));
    if (days.size < SERIES_MIN_DATES) continue;
    g.sort((x, y) => String(x.dateISO).localeCompare(String(y.dateISO)));
    const first = g[0];
    first.runsThrough = g[g.length - 1].dateISO.slice(0, 10);
    first.occurrences = days.size;
    for (const e of g.slice(1)) drop.add(e);
  }
  return { drop, collapsed: drop.size };
}

// Show everything gathered that survives the standing exclusions (kids, comedy,
// virtual, book talks, cancelled — lib/filters.js), de-duplicated and with
// repeating series collapsed to their first date. No taste ranking, no
// per-bucket cap, no cross-run suppression. Events with no real event URL are
// KEPT (the reader would rather see them) but flagged `urlMissing` so the page
// shows a clearly-labelled web search instead of pretending to have a link;
// the count is reported so a lazy extraction run is visible.
// Stats from the run are exposed on the returned object as `_stats`.
function curate(events, runDateISO) {
  const byKey = new Map();
  const byDay = new Map();
  const { kept: eligible, dropped } = applyExclusions(events || []);
  let noUrl = 0;
  for (const e of eligible) {
    if (!hasRealUrl(e) || isSearchUrl(e)) { e.url = ''; e.urlMissing = true; noUrl++; }
  }

  for (const e of eligible) {
    const bucket = bucketFor(e.dateISO, runDateISO);
    if (bucket === 'past') continue;            // drop past + unparseable dates
    const key = exactKey(e);
    const existing = byKey.get(key);
    if (existing) {
      mergeInto(existing, e);
      continue;
    }
    const day = (e.dateISO || '').slice(0, 10);
    const fuzzyHit = (byDay.get(day) || []).find(kept => isDuplicate(kept, e));
    if (fuzzyHit) {
      mergeInto(fuzzyHit, e);
      byKey.set(key, fuzzyHit);                 // future exact-key hits merge too
      continue;
    }
    const kept = { ...e, _bucket: bucket, via: [...(e.via || [])] };
    byKey.set(key, kept);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(kept);
  }

  const byDate = (x, y) =>
    String(x.dateISO || '').localeCompare(String(y.dateISO || '')) ||
    String(x.name || '').localeCompare(String(y.name || ''));

  const records = [];
  const seen = new Set();
  for (const e of byKey.values()) {
    if (seen.has(e)) continue;                  // fuzzy aliases map to one record
    seen.add(e);
    records.push(e);
  }
  const { drop, collapsed } = collapseSeries(records);

  const out = {};
  for (const b of BUCKETS) out[b] = [];
  for (const e of records) if (!drop.has(e)) out[e._bucket].push(e);
  for (const b of BUCKETS) out[b].sort(byDate);
  Object.defineProperty(out, '_stats', { value: { excluded: dropped, noUrl, collapsed }, enumerable: false });
  return out;
}

module.exports = { curate, BUCKETS, isLikelyDuplicate: isDuplicate };
