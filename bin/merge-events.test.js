'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergeInbox } = require('./merge-events');

function tmpInbox(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

const evt = (id, extra = {}) => ({
  id, name: `Event ${id}`, dateISO: '2026-08-20T19:00:00', time: '7:00 PM',
  venue: 'V', neighborhood: 'N', price: 'Free', url: 'https://example.com',
  category: 'miscellaneous', source: 'S', via: ['The Skint'], why: '',
  ...extra,
});

test('merges arrays from multiple files in filename order', () => {
  const dir = tmpInbox({
    '02-second.json': JSON.stringify([evt('b')]),
    '01-first.json': JSON.stringify([evt('a'), evt('a2')]),
  });
  const { events, files } = mergeInbox(dir);
  assert.deepEqual(events.map(e => e.id), ['a', 'a2', 'b']);
  assert.deepEqual(files, ['01-first.json', '02-second.json']);
});

test('accepts an {events: [...]} wrapper object', () => {
  const dir = tmpInbox({ 'a.json': JSON.stringify({ events: [evt('x')] }) });
  assert.deepEqual(mergeInbox(dir).events.map(e => e.id), ['x']);
});

test('ignores non-.json files', () => {
  const dir = tmpInbox({
    'a.json': JSON.stringify([evt('x')]),
    'notes.txt': 'scratch',
    '.DS_Store': '',
  });
  const { events, files } = mergeInbox(dir);
  assert.equal(events.length, 1);
  assert.deepEqual(files, ['a.json']);
});

test('throws naming the file when a batch is malformed JSON', () => {
  const dir = tmpInbox({
    'good.json': JSON.stringify([evt('x')]),
    'bad.json': '{"events": [truncated',
  });
  assert.throws(() => mergeInbox(dir), /bad\.json/);
});

test('throws naming the file when a batch is neither array nor {events}', () => {
  const dir = tmpInbox({ 'weird.json': JSON.stringify({ foo: 1 }) });
  assert.throws(() => mergeInbox(dir), /weird\.json/);
});

test('throws naming the file and index when an entry is missing id or name', () => {
  const dir = tmpInbox({ 'a.json': JSON.stringify([evt('ok'), { name: 'no id' }]) });
  assert.throws(() => mergeInbox(dir), /a\.json.*\[1\]/);
});

test('throws when the inbox directory is missing or has no batch files', () => {
  assert.throws(() => mergeInbox(path.join(os.tmpdir(), 'does-not-exist-xyz')), /no such|not found|missing/i);
  const empty = tmpInbox({});
  assert.throws(() => mergeInbox(empty), /no .*\.json/i);
});

test('an explicitly empty batch array is allowed (a source with zero events)', () => {
  const dir = tmpInbox({
    'a.json': JSON.stringify([evt('x')]),
    'quiet-source.json': '[]',
  });
  assert.equal(mergeInbox(dir).events.length, 1);
});
