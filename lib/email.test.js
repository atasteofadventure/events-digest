'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildEmailHtml, emailSubject } = require('./email');

// Mon Jun 1 (talks + film), Tue Jun 2 (tech) are this-week; Sat Jun 6 (tours) is
// this-weekend. The nextWeek "Future Talk" (Tue Jun 9) must be excluded entirely.
const data = {
  meta: { title: 'Week of 2026-06-01' },
  generated: '2026-06-01T22:00:00',
  thisWeek: [
    { name: 'Jazz <Night>', url: 'https://ex.com/jazz', dateISO: '2026-06-01T19:00:00', time: '7:00 PM', venue: 'Bar Bayeux', neighborhood: 'PLG', price: 'Free', category: 'talks_lectures' },
    { name: 'Noir Film', url: '', dateISO: '2026-06-01T21:00:00', time: '9:00 PM', venue: 'Metrograph', neighborhood: 'LES', price: '$15', category: 'film_screenings' },
    { name: 'LLM Meetup', url: 'https://ex.com/llm', dateISO: '2026-06-02T18:30:00', time: '6:30 PM', venue: 'Betaworks', neighborhood: 'Flatiron', price: 'Free', category: 'tech_ai' },
  ],
  thisWeekend: [
    { name: 'Industry City Walk', url: 'https://ex.com/walk', dateISO: '2026-06-06T11:00:00', time: '11:00 AM', venue: 'Industry City', neighborhood: 'Sunset Park', price: '$20', category: 'tours_experiences' },
  ],
  nextWeek: [
    { name: 'Future Talk', url: 'https://ex.com/future', dateISO: '2026-06-09T18:00:00', time: '6:00 PM', venue: 'BISR', neighborhood: 'Brooklyn', price: '$15', category: 'talks_lectures' },
  ],
  nextWeekend: [],
  later: [],
};

test('emailSubject counts only this-week and this-weekend events', () => {
  const s = emailSubject(data);
  assert.match(s, /Week of 2026-06-01/);
  assert.match(s, /4 events/);          // 3 thisWeek + 1 thisWeekend; nextWeek excluded
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

test('buildEmailHtml excludes events beyond this weekend', () => {
  const h = buildEmailHtml(data);
  assert.doesNotMatch(h, /Future Talk/);
  assert.doesNotMatch(h, /ex\.com\/future/);
});

test('buildEmailHtml drops the uncurated framing copy', () => {
  const h = buildEmailHtml(data);
  assert.doesNotMatch(h, /uncurated/i);
  assert.doesNotMatch(h, /scan and pick/i);
});

test('buildEmailHtml groups events under a heading per day, in chronological order', () => {
  const h = buildEmailHtml(data);
  const mon = h.indexOf('Monday, Jun 1');
  const tue = h.indexOf('Tuesday, Jun 2');
  const sat = h.indexOf('Saturday, Jun 6');
  assert.ok(mon !== -1 && tue !== -1 && sat !== -1, 'all three day headings present');
  assert.ok(mon < tue && tue < sat, 'days are ordered chronologically');
});

test('buildEmailHtml groups events by category within a day, using category labels in order', () => {
  const h = buildEmailHtml(data);
  // Monday has a film (Noir Film) and a talk (Jazz Night). In CATEGORY_ORDER,
  // film_screenings precedes talks_lectures, so its label must come first.
  const film = h.indexOf('Film &amp; Screenings');
  const talks = h.indexOf('Talks &amp; Lectures');
  assert.ok(film !== -1 && talks !== -1, 'category labels present');
  assert.ok(film < talks, 'film category precedes talks within the day');
  assert.match(h, /Tech &amp; AI/);
  assert.match(h, /Tours &amp; Experiences/);
});

test('buildEmailHtml uses a search fallback when an event url is blank', () => {
  assert.match(buildEmailHtml(data), /google\.com\/search/);  // Noir Film has no url
});

test('buildEmailHtml embeds the subject as a leading comment for the sender', () => {
  assert.match(buildEmailHtml(data), /^<!--SUBJECT:.*-->/);
});

test('buildEmailHtml labels music_nightlife and orders it before film within a day', () => {
  const d = {
    meta: { title: 'X' },
    thisWeek: [
      { name: 'DJ Night', url: 'https://x/dj', dateISO: '2026-06-27T22:00:00', time: '10:00 PM', venue: 'Club', neighborhood: 'Wburg', price: '', category: 'music_nightlife' },
      { name: 'A Film', url: 'https://x/f', dateISO: '2026-06-27T19:00:00', time: '7:00 PM', venue: 'Cinema', neighborhood: 'LES', price: '$15', category: 'film_screenings' },
    ],
    thisWeekend: [], nextWeek: [], nextWeekend: [], later: [],
  };
  const h = buildEmailHtml(d);
  const music = h.indexOf('Music &amp; Nightlife');
  const film = h.indexOf('Film &amp; Screenings');
  assert.ok(music !== -1, 'music_nightlife label present');
  assert.ok(music < film, 'music_nightlife precedes film_screenings');
});

test('buildEmailHtml gives miscellaneous a proper label as the catch-all', () => {
  const d = {
    meta: { title: 'X' },
    thisWeek: [
      { name: 'Odd Thing', url: '', dateISO: '2026-06-27T20:00:00', time: '8:00 PM', venue: 'Somewhere', neighborhood: 'BK', price: '', category: 'miscellaneous' },
    ],
    thisWeekend: [], nextWeek: [], nextWeekend: [], later: [],
  };
  assert.match(buildEmailHtml(d), /Miscellaneous/);
});

// ---------- clean rendering of empty fields ----------
test('event with empty why/price/neighborhood renders without dangling separators or empty why', () => {
  const d = {
    meta: { title: 'X' },
    thisWeek: [
      { name: 'Sparse Event', url: 'https://x/s', dateISO: '2026-06-27T19:00:00', time: '7:00 PM', venue: 'Somewhere', neighborhood: '', price: '', why: '', category: 'miscellaneous' },
    ],
    thisWeekend: [], nextWeek: [], nextWeekend: [], later: [],
  };
  const h = buildEmailHtml(d);
  // The meta line joins only the two present parts, once, with no trailing/double separator.
  assert.match(h, /7:00 PM &middot; Somewhere/);
  assert.doesNotMatch(h, /&middot; &middot;/);       // no double separator
  assert.doesNotMatch(h, /&middot;\s*<\/div>/);       // no dangling separator before close
  assert.doesNotMatch(h, /font-style:italic/);        // empty why produces no italic node
});

test('event with only a name renders no empty meta line', () => {
  const d = {
    meta: { title: 'X' },
    thisWeek: [
      { name: 'Bare Event', url: 'https://x/b', dateISO: '2026-06-27T19:00:00', time: '', venue: '', neighborhood: '', price: '', why: '', category: 'miscellaneous' },
    ],
    thisWeekend: [], nextWeek: [], nextWeekend: [], later: [],
  };
  const h = buildEmailHtml(d);
  assert.match(h, /Bare Event/);
  assert.doesNotMatch(h, /color:#78716c;margin-top:2px/); // the meta div style is never emitted
  assert.doesNotMatch(h, /font-style:italic/);
});

test('a fully-populated event still shows every meta part and the why line', () => {
  const d = {
    meta: { title: 'X' },
    thisWeek: [
      { name: 'Full Event', url: 'https://x/f', dateISO: '2026-06-27T19:00:00', time: '7:00 PM', venue: 'The Venue', neighborhood: 'Bushwick', price: '$10', why: 'A real one-line description.', category: 'miscellaneous' },
    ],
    thisWeekend: [], nextWeek: [], nextWeekend: [], later: [],
  };
  const h = buildEmailHtml(d);
  assert.match(h, /7:00 PM &middot; The Venue &middot; Bushwick &middot; \$10/);
  assert.match(h, /font-style:italic/);
  assert.match(h, /A real one-line description\./);
});

test('sports_fitness has a label and sorts after tours_experiences, before festivals_parties', () => {
  const d = {
    meta: { title: 'X' },
    thisWeek: [
      { name: 'Sunrise Yoga', url: 'https://x/y', dateISO: '2026-06-27T07:00:00', time: '7:00 AM', venue: 'Prospect Park', neighborhood: 'PLG', price: 'Free', category: 'sports_fitness' },
      { name: 'Sunset Walk', url: 'https://x/w', dateISO: '2026-06-27T18:00:00', time: '6:00 PM', venue: 'Industry City', neighborhood: 'Sunset Park', price: '$5', category: 'tours_experiences' },
      { name: 'Block Party', url: 'https://x/p', dateISO: '2026-06-27T20:00:00', time: '8:00 PM', venue: 'The Street', neighborhood: 'BK', price: 'Free', category: 'festivals_parties' },
    ],
    thisWeekend: [], nextWeek: [], nextWeekend: [], later: [],
  };
  const h = buildEmailHtml(d);
  const tours = h.indexOf('Tours &amp; Experiences');
  const sports = h.indexOf('Sports &amp; Fitness');
  const festivals = h.indexOf('Festivals &amp; Parties');
  assert.ok(sports !== -1, 'Sports & Fitness label present');
  assert.ok(tours < sports && sports < festivals, 'sports_fitness sits between tours and festivals');
});

// ---------- source coverage footer ----------
test('email footer shows source coverage when meta.source_report is present', () => {
  const d = { meta: { title: 'T', source_report: { contributing: 7, empty: ['Nonsense NYC', 'BKReader'] } },
    generated: '2026-06-01T22:00:00', thisWeek: [], thisWeekend: [], nextWeek: [], nextWeekend: [], later: [] };
  const html = buildEmailHtml(d);
  assert.match(html, /7 sources contributed/);
  assert.match(html, /Nonsense NYC, BKReader/);
});

test('email footer omits coverage line without meta.source_report', () => {
  const d = { meta: { title: 'T' }, generated: '2026-06-01T22:00:00', thisWeek: [], thisWeekend: [], nextWeek: [], nextWeekend: [], later: [] };
  assert.doesNotMatch(buildEmailHtml(d), /sources contributed/);
});
