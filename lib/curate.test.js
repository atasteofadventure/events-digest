'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { curate } = require('./curate');
const { dedupeKey } = require('./windowing');

const RUN = '2026-06-04T10:00:00';
const ev = (o) => Object.assign({ name: 'E', venue: 'V', via: ['x'], relevance: 0.5 }, o);

test('drops out-of-window and already-seen events', () => {
  const events = [
    ev({ name: 'Past', dateISO: '2026-06-01T10:00:00' }),                 // out
    ev({ name: 'Keep', dateISO: '2026-06-04T19:00:00' }),                 // thisWeek
    ev({ name: 'Seen', dateISO: '2026-06-05T12:00:00', venue: 'V2' }),    // thisWeek but seen
  ];
  const state = { seen_events: [dedupeKey(events[2])] };
  const out = curate(events, state, RUN, 10);
  assert.deepEqual(out.thisWeek.map(e => e.name), ['Keep']);
});

test('dedupes duplicates and merges via, keeping highest relevance', () => {
  const a = ev({ name: 'Show', dateISO: '2026-06-05T19:00:00', via: ['skint'], relevance: 0.4 });
  const b = ev({ name: 'show', dateISO: '2026-06-05T20:00:00', via: ['timeout'], relevance: 0.9 });
  const out = curate([a, b], { seen_events: [] }, RUN, 10);
  assert.equal(out.thisWeekend.length, 1);
  assert.equal(out.thisWeekend[0].relevance, 0.9);
  assert.deepEqual(out.thisWeekend[0].via.sort(), ['skint', 'timeout']);
});

test('caps each bucket at volumePerBucket, highest relevance first', () => {
  const events = Array.from({ length: 5 }, (_, i) =>
    ev({ name: 'N' + i, venue: 'V' + i, dateISO: '2026-06-04T1' + i + ':00:00', relevance: i / 10 }));
  const out = curate(events, { seen_events: [] }, RUN, 2);
  assert.equal(out.thisWeek.length, 2);
  assert.deepEqual(out.thisWeek.map(e => e.name), ['N4', 'N3']);
});
