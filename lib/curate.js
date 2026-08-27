'use strict';
const { bucketFor, dedupeKey } = require('./windowing');
const { applyExclusions } = require('./filters');

const BUCKETS = ['thisWeek', 'thisWeekend', 'nextWeek', 'nextWeekend', 'later'];

// Cross-source listings word the same event differently ("Radiolab: Grass Fed"
// at "Little Island (The Glade)" vs "Radiolab: Grass Fed at Little Island" at
// "Little Island"), so exact name|day|venue keys miss them. A fuzzy same-day
// pass catches those while leaving distinct events alone (e.g. two different
// "Free Outdoor Movie: X" screenings share a prefix but are different films).
const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'at', 'of', 'in', 'on', 'to', 'with', 'for']);

const normText = (s) => (s || '').toLowerCase()
  .replace(/[\u2019']s\b/g, '')                 // "Spike Lee's" -> "spike lee"
  .replace(/[^a-z0-9]+/g, ' ').trim();
const meaningfulTokens = (s) => new Set(normText(s).split(' ').filter(t => t.length > 1 && !STOPWORDS.has(t)));
// "BK Loves MJ at Fort Greene Park" vs "BK Loves MJ": a trailing "at <place>"
// that overlaps the venue is location, not name.
function nameSansVenue(name, venue) {
  const n = normText(name);
  const m = / at (.+)$/.exec(n);
  if (!m) return n;
  const tail = meaningfulTokens(m[1]), vt = meaningfulTokens(venue);
  let overlap = 0;
  for (const t of tail) if (vt.has(t)) overlap++;
  return overlap >= 1 && overlap >= tail.size / 2 ? n.slice(0, m.index).trim() : n;
}
// Word-boundary containment: "n1" must not match inside "n19".
const containsPhrase = (outer, inner) => ` ${outer} `.includes(` ${inner} `);

function isSubset(a, b) {
  for (const t of a) if (!b.has(t)) return false;
  return a.size > 0;
}

function venuesCompatible(a, b) {
  const va = normText(a), vb = normText(b);
  if (!va || !vb) return false;
  if (va === vb || containsPhrase(va, vb) || containsPhrase(vb, va)) return true;
  const ta = meaningfulTokens(a), tb = meaningfulTokens(b);
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap >= 2;
}

function isLikelyDuplicate(a, b) {
  if ((a.dateISO || '').slice(0, 10) !== (b.dateISO || '').slice(0, 10)) return false;
  const na = nameSansVenue(a.name, a.venue), nb = nameSansVenue(b.name, b.venue);
  if (!na || !nb) return false;
  const compatible = venuesCompatible(a.venue, b.venue);

  // Same (normalized) name needs venue agreement — "Trivia Night" happens at
  // many venues on the same night.
  if (na === nb) return compatible;
  if (!compatible) return false;

  // One name contains the other ("Radiolab: Grass Fed" ⊂ "... at Little Island").
  if (containsPhrase(na, nb) || containsPhrase(nb, na)) return true;

  const ta = meaningfulTokens(na), tb = meaningfulTokens(nb);
  // Token-subset after stopwords ("House Crawl and Parade" ⊆ "Art House Crawl
  // + Illuminated Creatures Parade").
  if (isSubset(ta, tb) || isSubset(tb, ta)) return true;

  // Reordered wordings at the IDENTICAL venue ("Gridlock ... VW Car Show" vs
  // "Volkswagen Gridlock Car Show ..."): near-total token overlap. 0.8 keeps
  // same-series-different-film names (overlap 0.75) apart.
  if (normText(a.venue) === normText(b.venue)) {
    let overlap = 0;
    for (const t of ta) if (tb.has(t)) overlap++;
    if (overlap / Math.max(1, Math.min(ta.size, tb.size)) >= 0.8) return true;
  }
  return false;
}

// First-seen record wins; the duplicate contributes its `via` and fills any
// fields the kept record is missing.
function mergeInto(kept, dup) {
  kept.via = Array.from(new Set([...(kept.via || []), ...(dup.via || [])]));
  for (const f of ['time', 'price', 'url', 'why', 'neighborhood', 'category']) {
    if (!kept[f] && dup[f]) kept[f] = dup[f];
  }
}

const hasRealUrl = (e) => /^https?:\/\//i.test(String((e && e.url) || '').trim());

// A series that repeats on many dates (daily exhibition hours, a weekly class)
// is shown once, at its first upcoming date, with a "runs through" marker —
// the reader asked for the opening date, not one card per day. Threshold: 3+
// distinct dates for the same name at the same venue.
const SERIES_MIN_DATES = 3;
function collapseSeries(records) {
  const groups = new Map();
  for (const e of records) {
    const k = `${normText(e.name)}|${normText(e.venue)}`;
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
// virtual, book talks — lib/filters.js), de-duplicated and with repeating series
// collapsed to their first date. No taste ranking, no per-bucket cap, no
// cross-run suppression. Events without a real event URL are dropped: a card
// that can only link to a web search is worse than no card.
// Stats from the run are exposed on the returned object as `_stats`.
function curate(events, runDateISO) {
  const byKey = new Map();
  const byDay = new Map();
  const { kept: eligible, dropped } = applyExclusions(events || []);
  const withUrl = eligible.filter(hasRealUrl);
  const noUrl = eligible.length - withUrl.length;

  for (const e of withUrl) {
    const bucket = bucketFor(e.dateISO, runDateISO);
    if (bucket === 'past') continue;            // drop past + unparseable dates
    const key = dedupeKey(e);
    const existing = byKey.get(key);
    if (existing) {
      mergeInto(existing, e);
      continue;
    }
    const day = (e.dateISO || '').slice(0, 10);
    const fuzzyHit = (byDay.get(day) || []).find(kept => isLikelyDuplicate(kept, e));
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

module.exports = { curate, BUCKETS, isLikelyDuplicate };
