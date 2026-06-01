'use strict';
const { bucketFor, dedupeKey } = require('./windowing');

const BUCKETS = ['thisWeek', 'thisWeekend', 'nextWeek', 'nextWeekend', 'later'];

// Show *everything* gathered, just de-duplicated — the reader decides what is
// interesting. No taste ranking, no per-bucket cap, no cross-run suppression.
// Events are placed in a bucket by their date; only strictly-past (and undated)
// events are dropped. Each bucket is sorted chronologically.
function curate(events, runDateISO) {
  const byKey = new Map();

  for (const e of events || []) {
    const bucket = bucketFor(e.dateISO, runDateISO);
    if (bucket === 'past') continue;            // drop past + unparseable dates
    const key = dedupeKey(e);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...e, _bucket: bucket, via: [...(e.via || [])] });
    } else {
      // Same event from another source: merge where it was seen, keep the rest.
      existing.via = Array.from(new Set([...(existing.via || []), ...(e.via || [])]));
    }
  }

  const byDate = (x, y) =>
    String(x.dateISO || '').localeCompare(String(y.dateISO || '')) ||
    String(x.name || '').localeCompare(String(y.name || ''));

  const out = {};
  for (const b of BUCKETS) out[b] = [];
  for (const e of byKey.values()) out[e._bucket].push(e);
  for (const b of BUCKETS) out[b].sort(byDate);
  return out;
}

module.exports = { curate, BUCKETS };
