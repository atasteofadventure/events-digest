'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isStale, alertHtml, MAX_AGE_HOURS } = require('./watchdog');

test('fresh digest (17h old) is not stale at the default threshold', () => {
  const now = 1_800_000_000;
  assert.equal(isStale(now - 17 * 3600, now, MAX_AGE_HOURS), false);
});

test('old digest is stale', () => {
  const now = 1_800_000_000;
  assert.equal(isStale(now - 41 * 3600, now, 40), true);
});

test('missing digest (no commit found) is stale', () => {
  assert.equal(isStale(null, 1_800_000_000, 40), true);
  assert.equal(isStale(0, 1_800_000_000, 40), true);
});

test('default threshold clears a healthy Thursday-to-Friday gap', () => {
  // Routine: Thu 22:00 UTC. Watchdog: Fri 15:00 UTC. Gap = 17h; threshold must exceed it.
  assert.ok(MAX_AGE_HOURS > 17);
  // ...but must catch a fully missed week (7 days).
  assert.ok(MAX_AGE_HOURS < 7 * 24);
});

test('alertHtml names the routine dashboard and the live page for debugging', () => {
  const html = alertHtml(65);
  assert.match(html, /did not run/i);
  assert.match(html, /claude\.ai\/code\/routines\/trig_01Hef3r9byEvZAeMTo8rtgzD/);
  assert.match(html, /events-digest\.vercel\.app/);
  assert.match(html, /65h ago/);
});

test('alertHtml handles the no-commit-found case', () => {
  assert.match(alertHtml(null), /no digest commit found/i);
});
