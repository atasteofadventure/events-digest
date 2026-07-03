#!/usr/bin/env node
'use strict';
// Fetch every enabled type:"feed" source in config.json and write the parsed
// events to feed-events.json. A broken feed never fails the run — it is
// recorded under .errors and surfaced by the build summary / routine report.
// The build (bin/build-digest.js) merges feed-events.json with the
// newsletter-extracted events.json before curation.
const fs = require('fs');
const path = require('path');
const {
  icsToEvents, jsonLdToEvents, squarespaceJsonToEvents,
  nycParksRssToEvents, resistorRssToEvents, eventbriteOrganizerToEvents,
  eventbriteEventPageInfo,
} = require('../lib/feeds');

const TIMEOUT_MS = 20000;
const HORIZON_DAYS = 90; // keep today .. +90d (Makeville's gcal carries years of history)
const UA = 'Mozilla/5.0 (compatible; events-digest/1.0; +https://events-digest.vercel.app)';
const MAX_ENRICH_PER_SOURCE = 25; // per Eventbrite source (each is one extra fetch)

const REQ_OPTS = () => ({
  headers: { 'User-Agent': UA, Accept: 'text/calendar, application/json;q=0.9, text/html;q=0.8, */*;q=0.5' },
  signal: AbortSignal.timeout(TIMEOUT_MS),
});

// Decode a response body honoring its declared charset. NYC Parks' RSS is
// iso-8859-1 (accented bytes like 0xE9 for é); res.text() would assume UTF-8
// and produce U+FFFD. Sniff charset from Content-Type, else the XML/HTML
// declaration in the first ~200 bytes, else fall back to utf-8. TextDecoder
// throws on unknown labels, so guard the construction.
function decodeBody(buf, contentType) {
  const bytes = new Uint8Array(buf);
  let charset = '';
  const ctm = /charset=([^;]+)/i.exec(contentType || '');
  if (ctm) charset = ctm[1].trim().replace(/["']/g, '');
  if (!charset) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
    const xm = /encoding=["']([^"']+)["']/i.exec(head);
    if (xm) charset = xm[1].trim();
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes); // bogus label -> utf-8
  }
}

async function fetchOne(fetchImpl, url) {
  const res = await fetchImpl(url, REQ_OPTS());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') : '';
  return decodeBody(await res.arrayBuffer(), ct);
}

// Eventbrite organizer blobs carry no description and often no price. Fill the
// gaps from each event's own page (schema.org JSON-LD). Bounded, best-effort:
// at most MAX_ENRICH_PER_SOURCE fetches, any failure leaves the event as-is.
async function enrichEventbrite(events, fetchImpl) {
  let fetched = 0;
  for (const e of events) {
    if ((e.why && e.price) || !e.url) continue;
    if (fetched >= MAX_ENRICH_PER_SOURCE) break;
    fetched++;
    try {
      const info = eventbriteEventPageInfo(await fetchOne(fetchImpl, e.url));
      if (!e.why && info.why) e.why = info.why;
      if (!e.price && info.price) e.price = info.price;
    } catch (err) {
      console.log(`  enrich FAIL ${e.url}: ${String((err && err.message) || err)}`);
    }
  }
}

// Keep only events from today (NY date) through +HORIZON_DAYS. nowISO is a
// naive NY-local ISO string; comparison is by date component only.
function withinHorizon(dateISO, nowISO) {
  const day = String(dateISO).slice(0, 10);
  const today = String(nowISO).slice(0, 10);
  const max = new Date(new Date(today + 'T00:00:00Z').getTime() + HORIZON_DAYS * 86400000)
    .toISOString().slice(0, 10);
  return day >= today && day <= max;
}

function parseBody(src, body) {
  const opts = { sourceName: src.name, defaultCategory: src.default_category };
  switch (src.format) {
    case 'ics': return icsToEvents(body, opts);
    case 'jsonld': return jsonLdToEvents(body, opts);
    case 'squarespace-json':
      return squarespaceJsonToEvents(JSON.parse(body), { ...opts, origin: new URL(src.feed_url).origin });
    case 'nycparks-rss': return nycParksRssToEvents(body, {
      ...opts, boroughs: src.boroughs,
      excludeCategories: src.exclude_categories,
      boroughOnlyCategories: src.borough_only_categories,
    });
    case 'rss-title-date': return resistorRssToEvents(body, opts);
    case 'eventbrite-organizer': return eventbriteOrganizerToEvents(body, opts);
    default: throw new Error(`unknown feed format "${src.format}"`);
  }
}

async function fetchFeeds(sources, fetchImpl, nowISO) {
  const feeds = (sources || []).filter((s) => s.type === 'feed' && s.enabled !== false);
  const events = [];
  const errors = [];
  for (const src of feeds) {
    try {
      const parsed = parseBody(src, await fetchOne(fetchImpl, src.feed_url));
      // Eventbrite: backfill empty why/price from each event's own page.
      if (src.format === 'eventbrite-organizer') await enrichEventbrite(parsed, fetchImpl);
      const kept = parsed.filter((e) => withinHorizon(e.dateISO, nowISO));
      events.push(...kept);
      console.log(`feed ok   ${src.name}: ${kept.length} events (${parsed.length} parsed)`);
    } catch (e) {
      const msg = String((e && e.message) || e);
      errors.push({ source: src.name, error: msg });
      console.log(`feed FAIL ${src.name}: ${msg}`);
    }
  }
  return { events, errors };
}

// When EVERY feed fails (e.g. the cloud sandbox's egress proxy 403s all
// outbound fetches — observed 2026-07-02), an existing feed-events.json with
// real events (committed by the fetch-feeds GitHub Action) must be kept, not
// clobbered with an empty file.
function shouldKeepExisting(result, existing) {
  const totalFailure = result.events.length === 0 && result.errors.length > 0;
  const existingHasData = !!(existing && Array.isArray(existing.events) && existing.events.length > 0);
  return totalFailure && existingHasData;
}

async function main() {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const nowISO = process.env.RUN_DATE || new Date().toISOString();
  const result = await fetchFeeds(config.sources, fetch, nowISO);
  const outPath = path.join(root, 'feed-events.json');
  let existing = null;
  if (fs.existsSync(outPath)) {
    try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { /* unreadable -> overwrite */ }
  }
  if (shouldKeepExisting(result, existing)) {
    console.log(`ALL ${result.errors.length} feeds failed — keeping existing feed-events.json`
      + ` (${existing.events.length} events from ${existing.generated}). Likely a network-restricted environment.`);
    return;
  }
  fs.writeFileSync(outPath, JSON.stringify({ generated: nowISO, ...result }, null, 2));
  console.log(`Wrote feed-events.json — ${result.events.length} events, ${result.errors.length} feed errors`);
}

if (require.main === module) {
  main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}
module.exports = { fetchFeeds, withinHorizon, shouldKeepExisting };
