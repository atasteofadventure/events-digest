'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { candidatePairs, pairKey } = require('../lib/dedupe');
const { curate } = require('../lib/curate');

const D = '2026-06-06';
const ev = (id, name, venue, time, extra) => Object.assign({ id, name, venue, dateISO: D + 'T' + time + ':00', url: 'https://x/' + id, via: [id] }, extra);

test('candidatePairs surfaces the ambiguous band and skips clear cases', () => {
  const events = [
    ev('a', 'NY Art Book Fair 2026', 'MoMA PS1', '12:00'),
    ev('b', 'NY Art Book Fair 2026 Opening Night', 'MoMA PS1', '13:00'),   // discriminator-blocked -> review
    ev('c', 'Radiolab: Grass Fed', 'Little Island', '19:00'),
    ev('d', 'Radiolab Grass Fed Live', 'Little Island', '19:00'),           // auto-merged -> not a candidate
    ev('e', 'Trivia Night', 'Union Hall', '19:00'),
    ev('f', 'Knitting Circle', 'Union Hall', '19:00'),                      // dissimilar -> not a candidate
    ev('g', 'Jazz on the Lawn: Trio Session with Guests', 'Fort Greene Park', '18:00'),
    ev('h', 'Summer Jazz Session', 'Fort Greene Park Conservancy', '18:30'),  // mid-band similarity -> review
  ];
  const pairs = candidatePairs(events);
  const keys = pairs.map((p) => pairKey(p.a, p.b));
  assert.ok(keys.includes('a|b'), 'discriminator pair reviewed');
  assert.ok(keys.includes('g|h'), 'mid-band pair reviewed: ' + JSON.stringify(keys));
  assert.ok(!keys.includes('c|d'), 'auto-merge not reviewed');
  assert.ok(!keys.includes('e|f'), 'dissimilar not reviewed');
});

test('verdicts override the heuristics in both directions and are logged', () => {
  const a = ev('a', 'NY Art Book Fair 2026', 'MoMA PS1', '12:00');
  const b = ev('b', 'NY Art Book Fair 2026 Opening Night', 'MoMA PS1', '13:00');
  const c = ev('c', 'Radiolab: Grass Fed', 'Little Island', '19:00');
  const d = ev('d', 'Radiolab Grass Fed Live', 'Little Island', '19:00');
  const RUN = '2026-06-04T10:00:00';
  const plain = curate([a, b, c, d], RUN);
  assert.equal(plain.thisWeekend.length, 3);                                // a, b apart; c+d merged
  const judged = curate([a, b, c, d], RUN, { verdicts: [{ a: 'a', b: 'b', same: true }, { a: 'd', b: 'c', same: false }] });
  assert.equal(judged.thisWeekend.length, 3);                               // a+b merged; c, d apart
  assert.deepEqual(judged.thisWeekend.map((e) => e.name).sort(), ['NY Art Book Fair 2026', 'Radiolab Grass Fed Live', 'Radiolab: Grass Fed']);
  assert.deepEqual(judged._stats.merges.map((m) => m.reason), ['llm-same']);
});
