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
} = require('../lib/feeds');

const TIMEOUT_MS = 20000;
const HORIZON_DAYS = 90; // keep today .. +90d (Makeville's gcal carries years of history)
const UA = 'Mozilla/5.0 (compatible; events-digest/1.0; +https://events-digest.vercel.app)';

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
  const opts = { sourceName: src.name };
  switch (src.format) {
    case 'ics': return icsToEvents(body, opts);
    case 'jsonld': return jsonLdToEvents(body, opts);
    case 'squarespace-json':
      return squarespaceJsonToEvents(JSON.parse(body), { ...opts, origin: new URL(src.feed_url).origin });
    case 'nycparks-rss': return nycParksRssToEvents(body, { ...opts, boroughs: src.boroughs });
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
      const res = await fetchImpl(src.feed_url, {
        headers: { 'User-Agent': UA, Accept: 'text/calendar, application/json;q=0.9, text/html;q=0.8, */*;q=0.5' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseBody(src, await res.text());
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

async function main() {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const nowISO = process.env.RUN_DATE || new Date().toISOString();
  const { events, errors } = await fetchFeeds(config.sources, fetch, nowISO);
  const out = { generated: nowISO, events, errors };
  fs.writeFileSync(path.join(root, 'feed-events.json'), JSON.stringify(out, null, 2));
  console.log(`Wrote feed-events.json — ${events.length} events, ${errors.length} feed errors`);
}

if (require.main === module) {
  main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}
module.exports = { fetchFeeds, withinHorizon };
