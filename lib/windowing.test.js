'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { bucketFor, dedupeKey } = require('./windowing');

// Anchor run date: Thursday 2026-06-04 10:00 (local, no tz)
const THU = '2026-06-04T10:00:00';

test('weekday event later this week → thisWeek', () => {
  assert.equal(bucketFor('2026-06-04T19:00:00', THU), 'thisWeek');   // Thu eve
  assert.equal(bucketFor('2026-06-05T12:00:00', THU), 'thisWeek');   // Fri noon (before 5pm)
});

test('Fri 5pm onward through Sun → thisWeekend', () => {
  assert.equal(bucketFor('2026-06-05T19:00:00', THU), 'thisWeekend'); // Fri 7pm
  assert.equal(bucketFor('2026-06-07T15:00:00', THU), 'thisWeekend'); // Sun
});

test('following Mon–Fri → nextWeek', () => {
  assert.equal(bucketFor('2026-06-08T18:00:00', THU), 'nextWeek');    // Mon
  assert.equal(bucketFor('2026-06-12T12:00:00', THU), 'nextWeek');    // Fri noon
});

test('following Sat–Sun → nextWeekend', () => {
  assert.equal(bucketFor('2026-06-13T14:00:00', THU), 'nextWeekend'); // Sat
});

test('past event and far-future event → out', () => {
  assert.equal(bucketFor('2026-06-01T10:00:00', THU), 'out');  // last Mon
  assert.equal(bucketFor('2026-07-01T10:00:00', THU), 'out');  // weeks out
});

test('Sunday run: this weekend is the current (mostly past) Sat–Sun', () => {
  const SUN = '2026-06-07T17:00:00';
  assert.equal(bucketFor('2026-06-07T20:00:00', SUN), 'thisWeekend'); // Sun eve
  assert.equal(bucketFor('2026-06-09T19:00:00', SUN), 'nextWeek');    // Tue
});

test('dedupeKey: same event, different punctuation/case → same key', () => {
  const a = { name: 'Jazz at Bar Bayeux!', dateISO: '2026-06-05T19:00:00', venue: 'Bar Bayeux' };
  const b = { name: 'jazz at bar bayeux', dateISO: '2026-06-05T21:00:00', venue: 'BAR BAYEUX' };
  assert.equal(dedupeKey(a), dedupeKey(b));
});

test('dedupeKey: same name/venue, different date → different key', () => {
  const a = { name: 'Tour', dateISO: '2026-06-05T19:00:00', venue: 'Green-Wood' };
  const b = { name: 'Tour', dateISO: '2026-06-12T19:00:00', venue: 'Green-Wood' };
  assert.notEqual(dedupeKey(a), dedupeKey(b));
});
