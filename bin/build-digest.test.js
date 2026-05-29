'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildData, injectData } = require('./build-digest');

const curated = {
  thisWeek: [{ name: 'A', dateISO: '2026-06-07T19:00:00', venue: 'V', via: [] }],
  thisWeekend: [{ name: 'W', dateISO: '2026-06-07T20:00:00', venue: 'V', via: [] }],
  nextWeek: [], nextWeekend: [],
};

test('buildData includes four buckets + meta + generated', () => {
  const d = buildData(curated, '2026-06-04T10:00:00', { title: 'Wk' }); // Thursday
  assert.deepEqual(
    Object.keys(d).sort(),
    ['discovered_sources', 'generated', 'meta', 'nextWeek', 'nextWeekend', 'thisWeek', 'thisWeekend']
  );
  assert.equal(d.thisWeekend.length, 1);
});

test('buildData hides thisWeekend on Sunday runs', () => {
  const d = buildData(curated, '2026-06-07T17:00:00', { title: 'Wk' }); // Sunday
  assert.deepEqual(d.thisWeekend, []);
  assert.equal(d.thisWeek.length, 1);
});

test('injectData replaces the EVENTS_JSON marker, dropping the old default', () => {
  const tpl = 'x var EVENTS_DATA = /*__EVENTS_JSON__*/{"old":1}/**/; y';
  const out = injectData(tpl, { meta: {}, thisWeek: [] });
  assert.match(out, /\/\*__EVENTS_JSON__\*\/\{.*"thisWeek"/);
  assert.doesNotMatch(out, /"old":1/);
});
