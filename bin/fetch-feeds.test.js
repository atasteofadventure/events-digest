'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fetchFeeds, withinHorizon } = require('./fetch-feeds');

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:A\r\nDTSTART:20260711T100000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Ancient\r\nDTSTART:20200101T100000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Far Future\r\nDTSTART:20301231T100000\r\nEND:VEVENT\r\nEND:VCALENDAR';

// Responses expose arrayBuffer + headers (fetchOne reads bytes so it can honor
// the declared charset). `bytes` (a Uint8Array) overrides `body` for testing
// non-UTF-8 payloads; `contentType` sets the Content-Type header.
const fakeFetch = (behavior) => async (url) => {
  const b = behavior[url];
  if (!b) throw new Error('unexpected url ' + url);
  if (b instanceof Error) throw b;
  const status = b.status || 200;
  const body = b.body || '';
  const bytes = b.bytes || new TextEncoder().encode(body);
  return {
    ok: status === 200,
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? (b.contentType || '') : null) },
    text: async () => body,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
};

const NOW = '2026-07-02T12:00:00';

test('fetchFeeds parses each enabled feed by format and drops past/far-future events', async () => {
  const sources = [
    { type: 'feed', name: 'Park', feed_url: 'https://p/cal.ics', format: 'ics', enabled: true },
    { type: 'feed', name: 'Off', feed_url: 'https://off', format: 'ics', enabled: false },
    { type: 'newsletter', name: 'Skint' },
  ];
  const { events, errors } = await fetchFeeds(sources, fakeFetch({ 'https://p/cal.ics': { body: ICS } }), NOW);
  assert.equal(events.length, 1); // Ancient (past) and Far Future (>90d) dropped
  assert.equal(events[0].name, 'A');
  assert.equal(events[0].source, 'Park');
  assert.equal(errors.length, 0);
});

test('a failing feed is recorded as an error, not thrown; others still parse', async () => {
  const sources = [
    { type: 'feed', name: 'Bad', feed_url: 'https://bad', format: 'ics', enabled: true },
    { type: 'feed', name: 'Good', feed_url: 'https://good', format: 'ics', enabled: true },
  ];
  const { events, errors } = await fetchFeeds(sources, fakeFetch({
    'https://bad': new Error('ECONNRESET'),
    'https://good': { body: ICS },
  }), NOW);
  assert.equal(events.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source, 'Bad');
});

test('non-200 responses are errors too', async () => {
  const { errors } = await fetchFeeds(
    [{ type: 'feed', name: 'Blocked', feed_url: 'https://x403', format: 'jsonld', enabled: true }],
    fakeFetch({ 'https://x403': { status: 403 } }), NOW
  );
  assert.match(errors[0].error, /403/);
});

test('nycparks-rss format passes the boroughs filter through', async () => {
  const XML = `<rss xmlns:event="x"><channel>
<item><title><![CDATA[BK]]></title><link>l</link><description><![CDATA[d]]></description>
<registration_url><![CDATA[]]></registration_url>
<event:parkids>B073</event:parkids><event:startdate>2026-07-05</event:startdate>
<event:starttime>10:00 am</event:starttime><event:location><![CDATA[Fort Greene]]></event:location></item>
<item><title><![CDATA[SI]]></title><link>l</link><description><![CDATA[d]]></description>
<registration_url><![CDATA[]]></registration_url>
<event:parkids>R129</event:parkids><event:startdate>2026-07-05</event:startdate>
<event:starttime>7:00 am</event:starttime><event:location><![CDATA[Greenbelt]]></event:location></item>
</channel></rss>`;
  const sources = [{ type: 'feed', name: 'NYC Parks', feed_url: 'https://parks/rss.xml', format: 'nycparks-rss', boroughs: ['B', 'M'], enabled: true }];
  const { events } = await fetchFeeds(sources, fakeFetch({ 'https://parks/rss.xml': { body: XML } }), NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'BK');
});

test('squarespace-json derives the origin from feed_url for relative fullUrl', async () => {
  const body = JSON.stringify({ upcoming: [{ title: 'T', startDate: Date.parse('2026-07-10T14:00:00Z'), fullUrl: '/calendar/t' }] });
  const sources = [{ type: 'feed', name: 'FGP', feed_url: 'https://www.fortgreenepark.org/calendar/?format=json', format: 'squarespace-json', enabled: true }];
  const { events } = await fetchFeeds(sources, fakeFetch({ 'https://www.fortgreenepark.org/calendar/?format=json': { body } }), NOW);
  assert.equal(events[0].url, 'https://www.fortgreenepark.org/calendar/t');
});

test('withinHorizon keeps today through +90 days, drops yesterday', () => {
  assert.equal(withinHorizon('2026-07-02T00:00:00', NOW), true);
  assert.equal(withinHorizon('2026-07-01T23:00:00', NOW), false);
  assert.equal(withinHorizon('2026-09-25T00:00:00', NOW), true);
  assert.equal(withinHorizon('2026-10-15T00:00:00', NOW), false);
});

test('eventbrite-organizer format parses the embedded blob', async () => {
  const ev = { id: '9', name: 'Workshop', url: 'https://www.eventbrite.com/e/w-9',
    start_date: '2026-07-20', start_time: '18:00:00',
    primary_venue: { name: 'Studio' }, ticket_availability: { is_free: true } };
  const body = '<script>{"organizer":{"upcomingEvents":' + JSON.stringify([ev]) + '}}</script>';
  const sources = [{ type: 'feed', name: 'Studio (Eventbrite)', feed_url: 'https://eb/o/studio', format: 'eventbrite-organizer', enabled: true }];
  const { events } = await fetchFeeds(sources, fakeFetch({ 'https://eb/o/studio': { body } }), NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'Workshop');
  assert.equal(events[0].price, 'Free');
});

test('charset: iso-8859-1 bytes (0xE9 = é) decode correctly, not as U+FFFD', async () => {
  // Parks RSS declares iso-8859-1; the accented byte must round-trip to "é".
  const xml = '<?xml version="1.0" encoding="iso-8859-1"?>'
    + '<rss xmlns:event="x"><channel><item>'
    + '<title><![CDATA[Café Concert]]></title><link>l</link>'
    + '<description><![CDATA[Une soirée en plein air.]]></description>'
    + '<registration_url><![CDATA[]]></registration_url>'
    + '<event:parkids>B073</event:parkids><event:startdate>2026-07-05</event:startdate>'
    + '<event:starttime>7:00 pm</event:starttime>'
    + '<event:location><![CDATA[Café Plaza]]></event:location>'
    + '<event:categories><![CDATA[Music]]></event:categories></item></channel></rss>';
  const bytes = new Uint8Array(Buffer.from(xml, 'latin1')); // é -> single byte 0xE9
  assert.ok(bytes.includes(0xE9)); // sanity: the accented byte is really there
  const sources = [{ type: 'feed', name: 'NYC Parks', feed_url: 'https://parks/rss.xml', format: 'nycparks-rss', enabled: true }];
  const { events } = await fetchFeeds(sources, fakeFetch({
    'https://parks/rss.xml': { bytes, contentType: 'application/xml' }, // no charset in header -> sniff the XML decl
  }), NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'Café Concert');
  assert.equal(events[0].venue, 'Café Plaza');
  assert.equal(events[0].why, 'Une soirée en plein air.');
  assert.ok(!(events[0].name + events[0].why + events[0].venue).includes('�'));
});

test('eventbrite enrichment fills empty why + price from each event page', async () => {
  const ev = { id: 'e1', name: 'Book Launch', url: 'https://www.eventbrite.com/e/book-launch-e1',
    start_date: '2026-07-20', start_time: '19:00:00', primary_venue: { name: 'Greenlight' },
    ticket_availability: {} }; // no summary, no price -> both empty
  const organizer = '<script>{"organizer":{"upcomingEvents":' + JSON.stringify([ev]) + '}}</script>';
  const eventPage = '<html><script type="application/ld+json">' + JSON.stringify({
    '@type': 'Event', name: 'Book Launch', startDate: '2026-07-20T19:00:00-04:00',
    description: 'An evening with the author, reading and Q&A.',
    offers: { '@type': 'Offer', price: '12', priceCurrency: 'USD' },
  }) + '</script></html>';
  const sources = [{ type: 'feed', name: 'Greenlight (Eventbrite)', feed_url: 'https://eb/o/gl', format: 'eventbrite-organizer', enabled: true }];
  const { events } = await fetchFeeds(sources, fakeFetch({
    'https://eb/o/gl': { body: organizer },
    'https://www.eventbrite.com/e/book-launch-e1': { body: eventPage },
  }), NOW);
  assert.equal(events.length, 1);
  assert.equal(events[0].why, 'An evening with the author, reading and Q&A.');
  assert.equal(events[0].price, '$12');
});

test('eventbrite enrichment failure leaves the event intact', async () => {
  const ev = { id: 'e2', name: 'Talk', url: 'https://www.eventbrite.com/e/talk-e2',
    start_date: '2026-07-20', start_time: '18:00:00', primary_venue: { name: 'V' },
    ticket_availability: { is_free: true } }; // price Free (kept), why empty
  const organizer = '<script>{"organizer":{"upcomingEvents":' + JSON.stringify([ev]) + '}}</script>';
  const sources = [{ type: 'feed', name: 'X (Eventbrite)', feed_url: 'https://eb/o/x', format: 'eventbrite-organizer', enabled: true }];
  const { events } = await fetchFeeds(sources, fakeFetch({
    'https://eb/o/x': { body: organizer },
    'https://www.eventbrite.com/e/talk-e2': new Error('ECONNRESET'), // enrichment fetch fails
  }), NOW);
  assert.equal(events.length, 1); // source did not fail
  assert.equal(events[0].name, 'Talk');
  assert.equal(events[0].price, 'Free'); // unchanged
  assert.equal(events[0].why, ''); // still empty, no crash
});

test('shouldKeepExisting: total fetch failure must not clobber a good feed file', () => {
  const { shouldKeepExisting } = require('./fetch-feeds');
  const allFailed = { events: [], errors: [{ source: 'A', error: 'HTTP 403' }, { source: 'B', error: 'HTTP 403' }] };
  const good = { events: [{ id: 'x' }] };
  assert.equal(shouldKeepExisting(allFailed, good), true);          // keep CI-committed data
  assert.equal(shouldKeepExisting(allFailed, { events: [] }), false); // nothing worth keeping
  assert.equal(shouldKeepExisting(allFailed, null), false);
  const partial = { events: [{ id: 'y' }], errors: [{ source: 'A', error: 'HTTP 403' }] };
  assert.equal(shouldKeepExisting(partial, good), false);           // partial success wins
});
