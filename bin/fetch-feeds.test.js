'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fetchFeeds, withinHorizon } = require('./fetch-feeds');

const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:A\r\nDTSTART:20260711T100000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Ancient\r\nDTSTART:20200101T100000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:Far Future\r\nDTSTART:20301231T100000\r\nEND:VEVENT\r\nEND:VCALENDAR';

const fakeFetch = (behavior) => async (url) => {
  const b = behavior[url];
  if (!b) throw new Error('unexpected url ' + url);
  if (b instanceof Error) throw b;
  const status = b.status || 200;
  return { ok: status === 200, status, text: async () => b.body || '' };
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
