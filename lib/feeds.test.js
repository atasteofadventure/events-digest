'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseICS, icsToEvents, jsonLdToEvents, squarespaceJsonToEvents,
  nycParksRssToEvents, resistorRssToEvents, eventbriteOrganizerToEvents,
} = require('./feeds');

// ---------- ICS ----------

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'SUMMARY:Yoga in the Park',
  'DTSTART;TZID=America/New_York:20260711T100000',
  'LOCATION:Fort Greene Park\\, Brooklyn',
  'URL:https://fortgreenepark.org/events/yoga',
  'DESCRIPTION:Free outdoor vinyasa. All levels',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:All-Day Festival',
  'DTSTART;VALUE=DATE:20260712',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:UTC Class',
  'DTSTART:20260705T230000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseICS extracts VEVENT fields and unescapes text', () => {
  const evts = parseICS(ICS);
  assert.equal(evts.length, 3);
  assert.equal(evts[0].summary, 'Yoga in the Park');
  assert.equal(evts[0].location, 'Fort Greene Park, Brooklyn');
});

test('parseICS unfolds continuation lines (RFC 5545)', () => {
  const folded = 'BEGIN:VEVENT\r\nSUMMARY:Long ti\r\n tle here\r\nDTSTART:20260801T190000\r\nEND:VEVENT';
  assert.equal(parseICS(folded)[0].summary, 'Long title here');
});

test('icsToEvents normalizes to the digest event shape', () => {
  const [e, allDay] = icsToEvents(ICS, { sourceName: 'Fort Greene Park Conservancy' });
  assert.equal(e.name, 'Yoga in the Park');
  assert.equal(e.dateISO, '2026-07-11T10:00:00');
  assert.equal(e.time, '10:00 AM');
  assert.equal(e.venue, 'Fort Greene Park, Brooklyn');
  assert.equal(e.url, 'https://fortgreenepark.org/events/yoga');
  assert.equal(e.category, 'miscellaneous');
  assert.deepEqual(e.via, ['feed: Fort Greene Park Conservancy']);
  assert.match(e.id, /^feed-fort-greene-park-conservancy-2026-07-11-/);
  assert.equal(allDay.dateISO, '2026-07-12T00:00:00');
  assert.equal(allDay.time, '');
});

test('icsToEvents converts UTC (Z) times to New York local', () => {
  const evts = icsToEvents(ICS, { sourceName: 'X' });
  const utc = evts.find((e) => e.name === 'UTC Class');
  // 2026-07-05 is EDT (UTC-4): 23:00Z -> 19:00 local
  assert.equal(utc.dateISO, '2026-07-05T19:00:00');
  assert.equal(utc.time, '7:00 PM');
});

// ---------- schema.org JSON-LD ----------

test('jsonLdToEvents pulls schema.org Events out of HTML', () => {
  const html = '<html><script type="application/ld+json">' + JSON.stringify([{
    '@type': 'Event', name: 'Rooftop Screening',
    startDate: '2026-07-15T20:30:00-04:00',
    location: { '@type': 'Place', name: 'Industry City' },
    offers: { price: '15', priceCurrency: 'USD' },
    url: 'https://example.com/rooftop', description: 'Outdoor movie night.',
  }]) + '</script></html>';
  const [e] = jsonLdToEvents(html, { sourceName: 'Rooftop Films' });
  assert.equal(e.name, 'Rooftop Screening');
  assert.equal(e.dateISO.slice(0, 10), '2026-07-15');
  assert.equal(e.time, '8:30 PM');
  assert.equal(e.venue, 'Industry City');
  assert.equal(e.price, '$15');
  assert.equal(e.url, 'https://example.com/rooftop');
});

test('jsonLdToEvents survives malformed blocks, @graph nesting, and subtype Events', () => {
  const html = '<script type="application/ld+json">{broken</script>'
    + '<script type="application/ld+json">' + JSON.stringify({
      '@graph': [{ '@type': 'MusicEvent', name: 'G', startDate: '2026-08-01' }],
    }) + '</script>';
  const evts = jsonLdToEvents(html, { sourceName: 'X' });
  assert.equal(evts.length, 1);
  assert.equal(evts[0].name, 'G');
  assert.equal(evts[0].time, ''); // date-only startDate
});

// ---------- Squarespace collection JSON ----------

test('squarespaceJsonToEvents maps upcoming items and absolutizes fullUrl', () => {
  const json = {
    upcoming: [
      { title: 'Storytime in the Park', startDate: 1752076800000, // 2025-07-09T16:00:00Z
        fullUrl: '/calendar/storytime', excerpt: '<p>Stories &amp; songs.</p>',
        location: { addressTitle: 'Visitor Center' } },
      { title: 'No location', startDate: 1752076800000, fullUrl: '/calendar/x' },
    ],
  };
  const evts = squarespaceJsonToEvents(json, { sourceName: 'Fort Greene Park Conservancy', origin: 'https://www.fortgreenepark.org' });
  assert.equal(evts.length, 2);
  assert.equal(evts[0].name, 'Storytime in the Park');
  assert.equal(evts[0].url, 'https://www.fortgreenepark.org/calendar/storytime');
  assert.equal(evts[0].venue, 'Visitor Center');
  assert.equal(evts[0].why, 'Stories & songs.');
  assert.match(evts[0].dateISO, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(evts[1].venue, 'Fort Greene Park Conservancy'); // falls back to source name
});

test('squarespaceJsonToEvents tolerates empty/missing collections', () => {
  assert.deepEqual(squarespaceJsonToEvents({}, { sourceName: 'X', origin: 'https://x.org' }), []);
  assert.deepEqual(squarespaceJsonToEvents({ items: [] }, { sourceName: 'X', origin: 'https://x.org' }), []);
});

// ---------- NYC Parks RSS ----------

const PARKS_XML = `<?xml version="1.0" encoding="iso-8859-1"?>
<rss version="2.0" xmlns:event="http://www.nycgovparks.org/eventsrss_ns/">
<channel>
<item>
<title><![CDATA[Total Body Fitness]]></title>
<link>http://www.nycgovparks.org/events/2026/07/02/total-body-fitness1</link>
<description><![CDATA[Low-impact full-body workout.]]></description>
<registration_url><![CDATA[https://nycparks.perfectmind.com/reg]]></registration_url>
<event:parkids>B073</event:parkids>
<event:parknames>Fort Greene Park</event:parknames>
<event:startdate>2026-07-02</event:startdate>
<event:starttime>10:00 am</event:starttime>
<event:location><![CDATA[Fort Greene Park (Brooklyn)]]></event:location>
<event:categories><![CDATA[Fitness]]></event:categories>
</item>
<item>
<title><![CDATA[Staten Island Pickleball]]></title>
<link>http://www.nycgovparks.org/events/2026/07/02/pickleball</link>
<description><![CDATA[Pickleball clinics.]]></description>
<registration_url><![CDATA[]]></registration_url>
<event:parkids>R129</event:parkids>
<event:parknames>Blood Root Valley</event:parknames>
<event:startdate>2026-07-02</event:startdate>
<event:starttime>7:00 am</event:starttime>
<event:location><![CDATA[Greenbelt Recreation Center]]></event:location>
<event:categories><![CDATA[Sports]]></event:categories>
</item>
<item>
<title><![CDATA[Manhattan Kayaking]]></title>
<link>http://www.nycgovparks.org/events/2026/07/03/kayaking</link>
<description><![CDATA[Free kayaking.]]></description>
<registration_url><![CDATA[]]></registration_url>
<event:parkids>M071</event:parkids>
<event:parknames>Hudson River Park</event:parknames>
<event:startdate>2026-07-03</event:startdate>
<event:starttime></event:starttime>
<event:location><![CDATA[Pier 26]]></event:location>
<event:categories><![CDATA[Waterfront]]></event:categories>
</item>
</channel></rss>`;

test('nycParksRssToEvents parses the event: namespace and filters by borough', () => {
  const evts = nycParksRssToEvents(PARKS_XML, { sourceName: 'NYC Parks', boroughs: ['B', 'M'] });
  assert.equal(evts.length, 2); // Staten Island (R129) filtered out
  const [bk, mn] = evts;
  assert.equal(bk.name, 'Total Body Fitness');
  assert.equal(bk.dateISO, '2026-07-02T10:00:00');
  assert.equal(bk.time, '10:00 AM');
  assert.equal(bk.venue, 'Fort Greene Park (Brooklyn)');
  assert.equal(bk.url, 'https://nycparks.perfectmind.com/reg'); // registration_url preferred
  assert.equal(mn.url, 'http://www.nycgovparks.org/events/2026/07/03/kayaking'); // falls back to link
  assert.equal(mn.time, ''); // empty starttime
});

test('nycParksRssToEvents without borough filter keeps everything', () => {
  const evts = nycParksRssToEvents(PARKS_XML, { sourceName: 'NYC Parks' });
  assert.equal(evts.length, 3);
});

// ---------- NYC Resistor RSS (dates in item titles) ----------

const RESISTOR_XML = `<rss><channel>
<item><title>Jul 05 2026 : Intro to Soldering Workshop: Make an LED Tile</title>
<link>https://www.nycresistor.com/2026/06/28/soldering/</link>
<description><![CDATA[Learn to solder.]]></description></item>
<item><title>Key Piece of My Heart: Machine Yearning June 2026</title>
<link>https://www.nycresistor.com/blog</link>
<description><![CDATA[A blog post, not an event.]]></description></item>
</channel></rss>`;

test('resistorRssToEvents keeps only date-titled items and parses the date', () => {
  const evts = resistorRssToEvents(RESISTOR_XML, { sourceName: 'NYC Resistor' });
  assert.equal(evts.length, 1);
  assert.equal(evts[0].name, 'Intro to Soldering Workshop: Make an LED Tile');
  assert.equal(evts[0].dateISO, '2026-07-05T00:00:00');
  assert.equal(evts[0].venue, 'NYC Resistor');
  assert.equal(evts[0].url, 'https://www.nycresistor.com/2026/06/28/soldering/');
});

test('jsonLdToEvents converts true-UTC (Z) startDates to New York local', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'LiteraryEvent', name: 'Author Talk', startDate: '2026-07-02T22:30:00Z',
  }) + '</script>';
  const [e] = jsonLdToEvents(html, { sourceName: 'Club Free Time' });
  assert.equal(e.dateISO, '2026-07-02T18:30:00'); // EDT = UTC-4
  assert.equal(e.time, '6:30 PM');
});

test('event names have HTML entities decoded', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@type': 'Event', name: 'Book,&nbsp;Burn &amp; Learn', startDate: '2026-07-02T22:30:00Z',
  }) + '</script>';
  const [e] = jsonLdToEvents(html, { sourceName: 'X' });
  assert.equal(e.name, 'Book, Burn & Learn');
});

// ---------- Eventbrite organizer pages (embedded upcomingEvents blob) ----------

function ebEvent(overrides) {
  return Object.assign({
    id: '111', name: 'Intro to Soldering',
    url: 'https://www.eventbrite.com/e/intro-to-soldering-tickets-111',
    start_date: '2026-07-05', start_time: '12:00:00',
    timezone: 'America/New_York',
    is_online_event: false, is_cancelled: false,
    summary: 'Learn to solder an LED tile.',
    primary_venue: { name: 'NYC Resistor', address: { city: 'Brooklyn' } },
    ticket_availability: {
      is_sold_out: false, is_free: false,
      minimum_ticket_price: { major_value: '35.00', value: 3500 },
      maximum_ticket_price: { major_value: '35.00', value: 3500 },
    },
  }, overrides);
}

function ebPage(events) {
  return '<html><script>window.__SERVER_DATA__ = ' + JSON.stringify({
    view_data: { organizer: { upcomingEvents: events } },
  }).replace('"upcomingEvents"', '"upcomingEvents"') + ';</script></html>'
    .replace('{"view_data":{"organizer":{"upcomingEvents"', '{"view_data":{"organizer":{"upcomingEvents"');
}

test('eventbriteOrganizerToEvents extracts events from the embedded blob', () => {
  const html = ebPage([ebEvent({})]);
  const [e] = eventbriteOrganizerToEvents(html, { sourceName: 'NYC Resistor (Eventbrite)' });
  assert.equal(e.name, 'Intro to Soldering');
  assert.equal(e.dateISO, '2026-07-05T12:00:00');
  assert.equal(e.time, '12:00 PM');
  assert.equal(e.venue, 'NYC Resistor');
  assert.equal(e.url, 'https://www.eventbrite.com/e/intro-to-soldering-tickets-111');
  assert.equal(e.price, '$35');
  assert.equal(e.why, 'Learn to solder an LED tile.');
});

test('eventbriteOrganizerToEvents skips cancelled, online, and sold-out events', () => {
  const html = ebPage([
    ebEvent({ id: '1' }),
    ebEvent({ id: '2', is_cancelled: true }),
    ebEvent({ id: '3', is_online_event: true }),
    ebEvent({ id: '4', ticket_availability: { is_sold_out: true } }),
  ]);
  const evts = eventbriteOrganizerToEvents(html, { sourceName: 'X' });
  assert.equal(evts.length, 1);
});

test('eventbriteOrganizerToEvents price handling: free, range, unknown', () => {
  const free = ebEvent({ id: 'f1', ticket_availability: { is_free: true } });
  const range = ebEvent({ id: 'r1', ticket_availability: {
    minimum_ticket_price: { major_value: '10.00', value: 1000 },
    maximum_ticket_price: { major_value: '25.00', value: 2500 } } });
  const unknown = ebEvent({ id: 'u1', ticket_availability: {
    minimum_ticket_price: { major_value: '0.00', value: 0 },
    maximum_ticket_price: { major_value: '0.00', value: 0 } } });
  const html = ebPage([free, range, unknown]);
  const [f, r, u] = eventbriteOrganizerToEvents(html, { sourceName: 'X' });
  assert.equal(f.price, 'Free');
  assert.equal(r.price, '$10-25');
  assert.equal(u.price, '');
});

test('eventbriteOrganizerToEvents dedupes repeated blobs and tolerates missing blob', () => {
  const one = ebPage([ebEvent({})]);
  const doubled = one + one; // same blob appears twice in the page
  assert.equal(eventbriteOrganizerToEvents(doubled, { sourceName: 'X' }).length, 1);
  assert.deepEqual(eventbriteOrganizerToEvents('<html>no blob</html>', { sourceName: 'X' }), []);
});

// ---------- NYC Parks category filtering ----------

test('nycParksRssToEvents drops events carrying an excluded category', () => {
  const evts = nycParksRssToEvents(PARKS_XML, { sourceName: 'NYC Parks', boroughs: ['B', 'M'],
    excludeCategories: ['Fitness'] });
  assert.deepEqual(evts.map(e => e.name), ['Manhattan Kayaking']); // Total Body Fitness dropped
});

test('nycParksRssToEvents borough-only categories: kept in allowed borough, dropped elsewhere', () => {
  // Fitness allowed only in Brooklyn: BK fitness stays…
  const bk = nycParksRssToEvents(PARKS_XML, { sourceName: 'NYC Parks', boroughs: ['B', 'M'],
    boroughOnlyCategories: { Fitness: ['B'] } });
  assert.ok(bk.some(e => e.name === 'Total Body Fitness'));
  // …but the same category in Manhattan is dropped.
  const mnFitness = PARKS_XML.replace('B073', 'M073');
  const mn = nycParksRssToEvents(mnFitness, { sourceName: 'NYC Parks', boroughs: ['B', 'M'],
    boroughOnlyCategories: { Fitness: ['B'] } });
  assert.ok(!mn.some(e => e.name === 'Total Body Fitness'));
  assert.ok(mn.some(e => e.name === 'Manhattan Kayaking')); // unrelated events unaffected
});
