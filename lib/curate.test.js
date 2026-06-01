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
