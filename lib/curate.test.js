'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { curate, BUCKETS } = require('./curate');

const RUN = '2026-06-04T10:00:00';  // Thursday
const ev = (o) => Object.assign({ name: 'E', venue: 'V', via: ['x'] }, o);

test('keeps every in-window event (no cap, no ranking), drops only past', () => {
  const events = [
    ev({ name: 'Past',  dateISO: '2026-06-01T10:00:00' }),               // past -> dropped
    ev({ name: 'A',     dateISO: '2026-06-04T19:00:00', venue: 'V1' }),  // thisWeek
    ev({ name: 'B',     dateISO: '2026-06-05T12:00:00', venue: 'V2' }),  // thisWeek
    ev({ name: 'Later', dateISO: '2026-08-01T10:00:00', venue: 'V3' }),  // later
  ];
  const out = curate(events, RUN);
  assert.deepEqual(out.thisWeek.map(e => e.name), ['A', 'B']);
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

test('does NOT merge different series even at the same park (Storytime vs Movies)', () => {
  const a = ev({ name: 'Storytime in the Park', venue: 'Fort Greene Park',
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
