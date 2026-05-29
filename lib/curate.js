'use strict';
const { bucketFor, dedupeKey } = require('./windowing');

const BUCKETS = ['thisWeek', 'thisWeekend', 'nextWeek', 'nextWeekend'];

function curate(events, state, runDateISO, volumePerBucket) {
  const seen = new Set((state && state.seen_events) || []);
  const byKey = new Map();

  for (const e of events) {
    const bucket = bucketFor(e.dateISO, runDateISO);
    if (bucket === 'out') continue;
    const key = dedupeKey(e);
    if (seen.has(key)) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...e, _bucket: bucket, via: [...(e.via || [])] });
    } else {
      existing.via = Array.from(new Set([...(existing.via || []), ...(e.via || [])]));
      if ((e.relevance || 0) > (existing.relevance || 0)) {
        existing.relevance = e.relevance;
        existing.name = e.name; existing.url = e.url; existing.why = e.why;
      }
    }
  }

  const out = {};
  for (const b of BUCKETS) out[b] = [];
  for (const e of byKey.values()) out[e._bucket].push(e);
  for (const b of BUCKETS) {
    out[b].sort((x, y) => (y.relevance || 0) - (x.relevance || 0));
    out[b] = out[b].slice(0, volumePerBucket);
  }
  return out;
}

module.exports = { curate, BUCKETS };
