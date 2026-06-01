'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildEmailHtml, emailSubject } = require('./email');

const data = {
  meta: { title: 'Week of 2026-06-04' },
  generated: '2026-06-04T22:00:00',
  thisWeek: [
    { name: 'Jazz <Night>', url: 'https://ex.com/jazz', dateISO: '2026-06-04T19:00:00', time: '7:00 PM', venue: 'Bar Bayeux', neighborhood: 'PLG', price: 'Free' },
  ],
  thisWeekend: [],
  nextWeek: [
    { name: 'Talk', url: '', dateISO: '2026-06-09T18:00:00', time: '6:00 PM', venue: 'BISR', neighborhood: 'Brooklyn', price: '$15' },
  ],
  nextWeekend: [],
  later: [],
};

test('emailSubject summarizes the week and total count', () => {
  const s = emailSubject(data);
  assert.match(s, /Week of 2026-06-04/);
  assert.match(s, /2 events/);
});

test('buildEmailHtml links to the dashboard', () => {
  assert.match(buildEmailHtml(data), /https:\/\/events-digest\.vercel\.app/);
});

test('buildEmailHtml includes events and HTML-escapes names', () => {
  const h = buildEmailHtml(data);
  assert.match(h, /Jazz &lt;Night&gt;/);
  assert.doesNotMatch(h, /Jazz <Night>/);
  assert.ok(h.includes('https://ex.com/jazz'));
});

test('buildEmailHtml renders only non-empty bucket sections', () => {
  const h = buildEmailHtml(data);
  assert.match(h, /This Week/);
  assert.match(h, /Next Week/);
  assert.doesNotMatch(h, /This Weekend/);
  assert.doesNotMatch(h, /Next Weekend/);
});

test('buildEmailHtml uses a search fallback when an event url is blank', () => {
  assert.match(buildEmailHtml(data), /google\.com\/search/);  // the nextWeek "Talk" has no url
});

test('buildEmailHtml embeds the subject as a leading comment for the sender', () => {
  assert.match(buildEmailHtml(data), /^<!--SUBJECT:.*-->/);
});
