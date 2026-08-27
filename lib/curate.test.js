'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { curate, BUCKETS } = require('./curate');

const RUN = '2026-06-04T10:00:00';  // Thursday
const ev = (o) => Object.assign({ name: 'E', venue: 'V', via: ['x'], url: 'https://example.org/' + encodeURIComponent((o && o.name) || 'e') + '-' + encodeURIComponent((o && o.venue) || 'v') }, o);

test('keeps every in-window event (no cap, no ranking), drops only past', () => {
  const events = [
    ev({ name: 'Past',  dateISO: '2026-06-01T10:00:00' }),               // past -> dropped
    ev({ name: 'A',     dateISO: '2026-06-04T19:00:00', venue: 'V1' }),  // thisWeek
    ev({ name: 'B',     dateISO: '2026-06-05T12:00:00', venue: 'V2' }),  // Fri -> thisWeekend
    ev({ name: 'Later', dateISO: '2026-08-01T10:00:00', venue: 'V3' }),  // later
  ];
  const out = curate(events, RUN);
  assert.deepEqual(out.thisWeek.map(e => e.name), ['A']);
  assert.deepEqual(out.thisWeekend.map(e => e.name), ['B']);
  assert.deepEqual(out.later.map(e => e.name), ['Later']);
});

test('does not cap a bucket — shows every event in it', () => {
  const events = Array.from({ length: 20 }, (_, i) =>
    ev({ name: 'N' + i, venue: 'V' + i, dateISO: '2026-06-04T0' + (i % 10) + ':00:00' }));
  const out = curate(events, RUN);
  assert.equal(out.thisWeek.length, 20);
});

test('dedupes duplicates and merges via (no relevance involved)', () => {
  const a = ev({ name: 'Show', dateISO: '2026-06-05T19:00:00', via: ['skint'] });
  const b = ev({ name: 'show', dateISO: '2026-06-05T20:00:00', via: ['timeout'] });
  const out = curate([a, b], RUN);
  assert.equal(out.thisWeekend.length, 1);
  assert.deepEqual(out.thisWeekend[0].via.sort(), ['skint', 'timeout']);
});

test('sorts each bucket chronologically (earliest first)', () => {
  const events = [
    ev({ name: 'Late',  venue: 'V1', dateISO: '2026-06-04T20:00:00' }),
    ev({ name: 'Early', venue: 'V2', dateISO: '2026-06-04T09:00:00' }),
  ];
  const out = curate(events, RUN);
  assert.deepEqual(out.thisWeek.map(e => e.name), ['Early', 'Late']);
});

test('BUCKETS includes the Later bucket', () => {
  assert.ok(BUCKETS.includes('later'));
});

// --- fuzzy cross-source dedupe (real duplicate pairs from the 2026-08-14 digest) ---

const RUN2 = '2026-08-14T10:00:00';

test('merges name-containment variants when venues are compatible (Radiolab case)', () => {
  const skint = ev({ name: 'Radiolab: Grass Fed at Little Island', venue: 'Little Island',
    dateISO: '2026-08-15T17:00:00', time: '5:00 PM', via: ['The Skint'], price: '' });
  const li = ev({ name: 'Radiolab: Grass Fed', venue: 'Little Island (The Glade)',
    dateISO: '2026-08-15T17:00:00', time: '5:00 PM', via: ['Little Island'], price: 'Free' });
  const out = curate([skint, li], RUN2);
  assert.equal(out.thisWeekend.length, 1);
  assert.deepEqual(out.thisWeekend[0].via.sort(), ['Little Island', 'The Skint']);
  assert.equal(out.thisWeekend[0].price, 'Free');  // gap-filled from the duplicate
});

test('merges token-subset variants at the same venue (House Crawl case)', () => {
  const a = ev({ name: 'Art House Crawl + Illuminated Creatures Parade',
    venue: 'Governors Island (Nolan Park & Colonels Row)', dateISO: '2026-08-15T14:00:00', via: ['The Skint'] });
  const b = ev({ name: 'House Crawl and Parade',
    venue: 'Governors Island (Nolan Park & Colonels Row)', dateISO: '2026-08-15T14:00:00', via: ['Governors Island'] });
  const out = curate([a, b], RUN2);
  assert.equal(out.thisWeekend.length, 1);
});

test('merges high-token-overlap names at the identical venue (VW Gridlock case)', () => {
  const a = ev({ name: 'Gridlock on Governors Island: VW Car Show',
    venue: 'Governors Island (Picnic Point)', dateISO: '2026-08-16T10:00:00', time: 'All day', via: ['Governors Island'] });
  const b = ev({ name: 'Volkswagen Gridlock Car Show on Governors Island',
    venue: 'Governors Island (Picnic Point)', dateISO: '2026-08-16T10:00:00', time: '10:00 AM', via: ['The Skint'] });
  const out = curate([a, b], RUN2);
  assert.equal(out.thisWeekend.length, 1);
});

test('merges short-name containment when venue tokens overlap (The Fling case)', () => {
  const a = ev({ name: 'The Fling at Fort Greene Park (25th Anniversary)',
    venue: 'Monument Plaza, Fort Greene Park', dateISO: '2026-09-25T18:00:00', via: ['Fort Greene Park Conservancy'] });
  const b = ev({ name: 'The Fling', venue: 'Fort Greene Park Conservancy',
    dateISO: '2026-09-25T18:30:00', via: ['feed: Fort Greene Park Conservancy'] });
  const out = curate([a, b], RUN2);
  assert.equal(out.later.length, 1);
});

test('merges suffixed name at same venue (Bookstore Romance Day case)', () => {
  const a = ev({ name: 'Bookstore Romance Day at Greenlight Bookstore', venue: 'Greenlight Bookstore',
    dateISO: '2026-08-15T10:00:00', via: ['The Skint'] });
  const b = ev({ name: 'Bookstore Romance Day!', venue: 'Greenlight Bookstore in Fort Greene',
    dateISO: '2026-08-15T10:00:00', via: ['feed: Greenlight Bookstore'] });
  const out = curate([a, b], RUN2);
  assert.equal(out.thisWeekend.length, 1);
});

test('does NOT merge different movies in a shared series (shared-prefix names)', () => {
  const a = ev({ name: 'Free Outdoor Movie: Michael', venue: 'Hudson Yards Public Square',
    dateISO: '2026-08-14T20:00:00', via: ['The Skint'] });
  const b = ev({ name: 'Free Outdoor Movie: Nacho Libre', venue: 'Bushwick Inlet Park',
    dateISO: '2026-08-14T20:00:00', via: ['The Skint'] });
  const out = curate([a, b], RUN2);
  const total = BUCKETS.reduce((n, k) => n + out[k].length, 0);
  assert.equal(total, 2);
});

test('does NOT merge different series even at the same park (Yoga vs Movies)', () => {
  const a = ev({ name: 'Yoga in the Park', venue: 'Fort Greene Park',
    dateISO: '2026-08-26T10:00:00', via: ['feed: Fort Greene Park Conservancy'] });
  const b = ev({ name: 'Summer Movies in the Park: Space Jam', venue: 'Fort Greene Park',
    dateISO: '2026-08-26T20:00:00', via: ['feed: Fort Greene Park Conservancy'] });
  const out = curate([a, b], RUN2);
  const total = BUCKETS.reduce((n, k) => n + out[k].length, 0);
  assert.equal(total, 2);
});

test('does NOT merge same generic name at unrelated venues on the same day', () => {
  const a = ev({ name: 'Trivia Night', venue: 'Union Hall', dateISO: '2026-08-18T19:00:00', via: ['x'] });
  const b = ev({ name: 'Trivia Night', venue: 'Littlefield', dateISO: '2026-08-18T19:00:00', via: ['y'] });
  const out = curate([a, b], RUN2);
  assert.equal(out.nextWeek.length, 2);
});

test('does NOT merge the same event name on different days', () => {
  const a = ev({ name: 'Radiolab: Grass Fed', venue: 'Little Island', dateISO: '2026-08-15T17:00:00', via: ['x'] });
  const b = ev({ name: 'Radiolab: Grass Fed', venue: 'Little Island', dateISO: '2026-08-16T17:00:00', via: ['x'] });
  const out = curate([a, b], RUN2);
  assert.equal(out.thisWeekend.length, 2);
});

test('fuzzy dedupe: possessive + "at <venue>" wording (the Spike Lee case)', () => {
  const a = ev({ name: 'BK Loves MJ (Spike Lee Joint) at Fort Greene Park', dateISO: '2026-06-06T12:00:00', venue: 'Fort Greene Park, Central Lawn', via: ['gmail'], url: 'https://a' });
  const b = ev({ name: 'Spike Lee’s BK Loves MJ', dateISO: '2026-06-06T12:00:00', venue: 'Fort Greene Park Conservancy', via: ['feed'], url: 'https://b' });
  const out = curate([a, b], RUN);
  assert.equal(out.thisWeekend.length, 1);
  assert.deepEqual(out.thisWeekend[0].via.sort(), ['feed', 'gmail']);
});

test('applies standing exclusions (kids, comedy, virtual, book talks)', () => {
  const out = curate([
    ev({ name: 'Storytime in the Park', dateISO: '2026-06-05T11:00:00', url: 'https://x' }),
    ev({ name: 'Late Laughs', category: 'comedy', dateISO: '2026-06-05T20:00:00', url: 'https://x' }),
    ev({ name: 'Zoning 101', venue: 'Online', dateISO: '2026-06-05T20:00:00', url: 'https://x' }),
    ev({ name: 'Author Shares Her New Book', dateISO: '2026-06-05T20:00:00', url: 'https://x' }),
    ev({ name: 'Keep Me', dateISO: '2026-06-05T20:00:00', url: 'https://x' }),
  ], RUN);
  assert.deepEqual(out.thisWeekend.map(e => e.name), ['Keep Me']);
  assert.deepEqual(out._stats.excluded, { kids: 1, comedy: 1, virtual: 1, book_talk: 1 });
});

test('keeps events without a real URL but flags them (and counts them)', () => {
  const out = curate([
    ev({ name: 'No Link', venue: 'A', dateISO: '2026-06-05T20:00:00', url: '' }),
    ev({ name: 'Bad Link', venue: 'B', dateISO: '2026-06-05T20:00:00', url: 'see website' }),
    ev({ name: 'Search Link', venue: 'C', dateISO: '2026-06-05T20:00:00', url: 'https://www.google.com/search?q=x' }),
    ev({ name: 'Good', venue: 'D', dateISO: '2026-06-05T20:00:00', url: 'https://ok' }),
  ], RUN);
  assert.deepEqual(out.thisWeekend.map(e => [e.name, !!e.urlMissing, e.url]),
    [['Bad Link', true, ''], ['Good', false, 'https://ok'], ['No Link', true, ''], ['Search Link', true, '']]);
  assert.equal(out._stats.noUrl, 3);
});

test('a duplicate with a real URL repairs a link-less record', () => {
  const out = curate([
    ev({ name: 'Harvest Festival', venue: 'Brooklyn Botanic Garden', dateISO: '2026-06-06T11:00:00', url: '', via: ['a'] }),
    ev({ name: 'Harvest Festival', venue: 'BBG', dateISO: '2026-06-06T11:00:00', url: 'https://bbg.org/harvest', via: ['b'] }),
  ], RUN);
  assert.equal(out.thisWeekend.length, 1);
  assert.equal(out.thisWeekend[0].url, 'https://bbg.org/harvest');
  assert.equal(out.thisWeekend[0].urlMissing, undefined);
});

test('collapses a series on 3+ dates to its first date with runsThrough', () => {
  const mk = (d) => ev({ name: 'Open Hours', venue: 'Gallery', dateISO: d + 'T11:00:00', url: 'https://g' });
  const out = curate([mk('2026-06-04'), mk('2026-06-05'), mk('2026-06-06'), mk('2026-06-10'),
    ev({ name: 'Twice Only', venue: 'Gallery', dateISO: '2026-06-04T12:00:00', url: 'https://t' }),
    ev({ name: 'Twice Only', venue: 'Gallery', dateISO: '2026-06-05T12:00:00', url: 'https://t' })], RUN);
  const all = BUCKETS.flatMap(b => out[b]);
  const open = all.filter(e => e.name === 'Open Hours');
  assert.equal(open.length, 1);
  assert.equal(open[0].dateISO, '2026-06-04T11:00:00');
  assert.equal(open[0].runsThrough, '2026-06-10');
  assert.equal(open[0].occurrences, 4);
  assert.equal(all.filter(e => e.name === 'Twice Only').length, 2);   // below threshold: untouched
  assert.equal(out._stats.collapsed, 3);
});
