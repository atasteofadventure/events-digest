'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildData, injectData, injectTitle } = require('./build-digest');

const curated = {
  thisWeek: [{ name: 'A', dateISO: '2026-06-07T19:00:00', venue: 'V', via: [] }],
  thisWeekend: [{ name: 'W', dateISO: '2026-06-07T20:00:00', venue: 'V', via: [] }],
  nextWeek: [], nextWeekend: [],
  later: [{ name: 'L', dateISO: '2026-08-01T19:00:00', venue: 'V', via: [] }],
};

test('buildData includes five buckets + meta + generated', () => {
  const d = buildData(curated, '2026-06-04T10:00:00', { title: 'Wk' }); // Thursday
  assert.deepEqual(
    Object.keys(d).sort(),
    ['discovered_sources', 'generated', 'later', 'meta', 'nextWeek', 'nextWeekend', 'thisWeek', 'thisWeekend']
  );
  assert.equal(d.thisWeekend.length, 1);
  assert.equal(d.later.length, 1);
});

test('buildData hides thisWeekend on Sunday runs', () => {
  const d = buildData(curated, '2026-06-07T17:00:00', { title: 'Wk' }); // Sunday
  assert.deepEqual(d.thisWeekend, []);
  assert.equal(d.thisWeek.length, 1);
});

test('buildData maps dateISO to YYYY-MM-DD date for the template renderer', () => {
  const c = { thisWeek: [{ name: 'A', dateISO: '2026-06-04T19:30:00', venue: 'V', via: [] }], thisWeekend: [], nextWeek: [], nextWeekend: [] };
  const d = buildData(c, '2026-06-04T10:00:00', {});
  assert.equal(d.thisWeek[0].date, '2026-06-04');
});

test('injectData replaces the EVENTS_JSON marker, dropping the old default', () => {
  const tpl = 'x var EVENTS_DATA = /*__EVENTS_JSON__*/{"old":1}/**/; y';
  const out = injectData(tpl, { meta: {}, thisWeek: [] });
  assert.match(out, /\/\*__EVENTS_JSON__\*\/\{.*"thisWeek"/);
  assert.doesNotMatch(out, /"old":1/);
});

test('injectTitle replaces __DIGEST_TITLE__ with an HTML-escaped title', () => {
  const out = injectTitle('<title>__DIGEST_TITLE__</title>', 'Week of <b>x</b>');
  assert.equal(out, '<title>Week of &lt;b&gt;x&lt;/b&gt;</title>');
});

test('injectData escapes script-breaking chars from untrusted event data (XSS)', () => {
  const tpl = 'var EVENTS_DATA = /*__EVENTS_JSON__*/{}/**/;';
  const out = injectData(tpl, { thisWeek: [{ name: '</script><img src=x onerror=alert(1)>' }] });
  assert.doesNotMatch(out, /<\/script>/i);   // no literal closing tag survives
  assert.match(out, /\\u003c\/script/i);     // escaped form instead
});

// ---------- feed merge + source report ----------
const { mergeFeedEvents, sourceReport } = require('./build-digest');

test('mergeFeedEvents concatenates newsletter and feed events', () => {
  const a = [{ id: '1', name: 'A', dateISO: '2026-07-10T19:00:00', via: ['The Skint'] }];
  const feed = { events: [{ id: 'feed-x', name: 'B', dateISO: '2026-07-11T10:00:00', via: ['feed: Park'] }] };
  assert.equal(mergeFeedEvents(a, feed).length, 2);
});

test('mergeFeedEvents tolerates missing or malformed feed file content', () => {
  assert.equal(mergeFeedEvents([{ id: '1' }], null).length, 1);
  assert.equal(mergeFeedEvents([{ id: '1' }], {}).length, 1);
  assert.equal(mergeFeedEvents(null, { events: [{ id: 'f' }] }).length, 1);
});

test('sourceReport counts per via-source and lists empty configured sources', () => {
  const events = [
    { via: ['The Skint'] },
    { via: ['The Skint', 'feed: Park'] },
    { via: ['feed: Park'] },
  ];
  const rep = sourceReport(events, ['The Skint', 'Park', 'Nonsense NYC']);
  assert.deepEqual(rep.counts[0], { source: 'The Skint', count: 2 });
  assert.deepEqual(rep.counts[1], { source: 'Park', count: 2 }); // "feed: " prefix normalized
  assert.deepEqual(rep.empty, ['Nonsense NYC']);
  assert.equal(rep.contributing, 2);
});

test('sourceReport falls back to event.source when via is missing', () => {
  const rep = sourceReport([{ source: 'Solo' }], []);
  assert.deepEqual(rep.counts, [{ source: 'Solo', count: 1 }]);
});
