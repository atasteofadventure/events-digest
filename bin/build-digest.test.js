'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildSections } = require('./build-digest');

test('renders only non-empty buckets and hides This Weekend on Sunday', () => {
  const curated = {
    thisWeek: [{ name: 'A', dateISO: '2026-06-07T19:00:00', category: 'tech_ai', venue: 'V', via: [] }],
    thisWeekend: [{ name: 'W', dateISO: '2026-06-07T20:00:00', category: 'tours', venue: 'V', via: [] }],
    nextWeek: [], nextWeekend: [],
  };
  const html = buildSections(curated, '2026-06-07T17:00:00'); // Sunday
  assert.match(html, /This Week/);
  assert.doesNotMatch(html, /This Weekend/);   // hidden on Sunday
  assert.doesNotMatch(html, /Next Week<\/h2>/); // empty hidden
});

test('weekday run shows This Weekend when populated', () => {
  const curated = {
    thisWeek: [], thisWeekend: [{ name: 'W', dateISO: '2026-06-05T20:00:00', venue: 'V', via: [] }],
    nextWeek: [], nextWeekend: [],
  };
  const html = buildSections(curated, '2026-06-04T10:00:00'); // Thursday
  assert.match(html, /This Weekend/);
});
