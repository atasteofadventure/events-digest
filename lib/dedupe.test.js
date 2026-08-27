'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { compare, isDuplicate, normName, canonicalUrl, venuesCompatible } = require('./dedupe');

const ev = (name, venue, dateISO, extra) => Object.assign({ name, venue, dateISO, url: '' }, extra);
const D = '2026-08-29';

// ---- real duplicates seen across sources ----

test('possessive + parenthetical + "at <venue>" suffix (Spike Lee case)', () => {
  const a = ev('BK Loves MJ (Spike Lee Joint) at Fort Greene Park', 'Fort Greene Park, Central Lawn', D + 'T12:00:00');
  const b = ev('Spike Lee’s BK Loves MJ', 'Fort Greene Park Conservancy', D + 'T12:00:00');
  assert.equal(compare(a, b).dup, true, JSON.stringify(compare(a, b)));
});

test('aggregator rewording that embeds the original title (Radiolab case)', () => {
  const a = ev('Radiolab: Grass Fed', 'Little Island (The Glade)', D + 'T19:00:00');
  const b = ev('Live-Radio Romp with Radiolab: Grass Fed at Little Island', 'Little Island', D + 'T19:00:00');
  assert.equal(isDuplicate(a, b), true);
});

test('reordered wording with abbreviation (VW Gridlock case)', () => {
  const a = ev('Gridlock: The Annual VW Car Show', 'Green-Wood Cemetery', D + 'T10:00:00');
  const b = ev('Volkswagen Gridlock Car Show 2026', 'Green-Wood', D + 'T10:00:00');
  assert.equal(isDuplicate(a, b), true);
});

test('token-subset wording (House Crawl case)', () => {
  const a = ev('House Crawl and Parade', 'Governors Island', D + 'T13:00:00');
  const b = ev('Art House Crawl + Illuminated Creatures Parade', 'Governors Island', D + 'T13:00:00');
  assert.equal(isDuplicate(a, b), true);
});

test('same canonical URL is decisive even when names differ', () => {
  const a = ev('Opening: City Fragments', 'Gowanus Dredgers Boathouse', D + 'T18:00:00', { url: 'https://www.gowanusdredgers.org/event/city-fragments/?utm_source=skint' });
  const b = ev('City Fragments | Carol Dronsfield & Leigh Klonsky', 'Gowanus Dredgers Canoe Club Boathouse, 165 2nd St', D + 'T18:00:00', { url: 'https://gowanusdredgers.org/event/city-fragments' });
  assert.equal(compare(a, b).reason, 'same-url');
});

test('diacritics, curly quotes, and case differences are ignored', () => {
  const a = ev('Café Society: Édith Piaf Night', 'Joe’s Pub', D + 'T20:00:00');
  const b = ev("cafe society: edith piaf night", "Joe's Pub", D + 'T20:00:00');
  assert.equal(isDuplicate(a, b), true);
});

test('one source has a time, the other is all-day (00:00): still a duplicate', () => {
  const a = ev('Harvest Festival', 'Brooklyn Botanic Garden', D + 'T11:00:00');
  const b = ev('Harvest Festival', 'BBG', D + 'T00:00:00');
  assert.equal(isDuplicate(a, b), true);
});

test('unknown / generic venue does not block a name match', () => {
  const a = ev('Historian Discusses Dogs in the Visual Arts', 'New York City ( NYC )', D + 'T18:00:00');
  const b = ev('Dogs in the Visual Arts', 'National Arts Club', D + 'T18:30:00');
  assert.equal(isDuplicate(a, b), true);
});

test('leading "Venue: " prefix is stripped', () => {
  const a = ev('Museum of the Moving Image: Frances Ha', 'Museum of the Moving Image', D + 'T19:00:00');
  const b = ev('Frances Ha', 'MoMI, Astoria', D + 'T19:00:00');
  assert.equal(isDuplicate(a, b), true);
});

// ---- look-alikes that must stay separate ----

test('different films at the same venue on the same day', () => {
  const a = ev('Frances Ha at Museum of the Moving Image', 'Museum of the Moving Image', D + 'T19:00:00');
  const b = ev('The Untouchables (70mm) at Museum of the Moving Image', 'Museum of the Moving Image', D + 'T19:00:00');
  const c = ev("It's a Mad, Mad, Mad, Mad World (70mm) at Museum of the Moving Image", 'Museum of the Moving Image', D + 'T15:00:00');
  assert.equal(isDuplicate(a, b), false);
  assert.equal(isDuplicate(b, c), false);
});

test('same generic name at unrelated venues (Trivia Night)', () => {
  const a = ev('Trivia Night', 'Union Hall', D + 'T19:00:00');
  const b = ev('Trivia Night', 'Littlefield', D + 'T19:00:00');
  assert.equal(isDuplicate(a, b), false);
});

test('same series, different borough (Family Camping)', () => {
  const a = ev('Family Camping: Brooklyn', 'Salt Marsh Nature Center (in Marine Park)', D + 'T17:00:00');
  const b = ev('Family Camping: Manhattan', 'West 218th Street (in Inwood Hill Park)', D + 'T17:00:00');
  assert.equal(isDuplicate(a, b), false);
});

test('the fair vs. its opening night (event-type discriminator)', () => {
  const a = ev('NY Art Book Fair 2026 at MoMA PS1', 'MoMA PS1', D + 'T12:00:00');
  const b = ev('NY Art Book Fair 2026 Opening Night at MoMA PS1', 'MoMA PS1', D + 'T18:00:00');
  assert.equal(isDuplicate(a, b), false);
});

test('exhibition vs. a curator tour of it', () => {
  const a = ev('Art of the Street: Hirschfeld Collection', 'New York Historical Society', D + 'T11:00:00');
  const b = ev('Art of the Street: Hirschfeld Collection Curator Tour', 'New York Historical Society', D + 'T11:00:00');
  assert.equal(isDuplicate(a, b), false);
});

test('same activity at the same park, different program (Juggling vs Salsa)', () => {
  const a = ev('Juggling in Greeley Square Park', 'Greeley Square Park', D + 'T12:00:00');
  const b = ev('Social Salsa at Greeley Square Park', 'Greeley Square Park', D + 'T18:00:00');
  assert.equal(isDuplicate(a, b), false);
});

test('same name and venue but hours apart is two showtimes, not one', () => {
  const a = ev('Frances Ha', 'MoMI', D + 'T14:00:00');
  const b = ev('Frances Ha', 'MoMI', D + 'T19:30:00');
  assert.equal(compare(a, b).reason, 'time-apart');
});

test('different days are never duplicates', () => {
  const a = ev('Same Thing', 'Same Place', '2026-08-29T19:00:00');
  const b = ev('Same Thing', 'Same Place', '2026-08-30T19:00:00');
  assert.equal(isDuplicate(a, b), false);
});

test('a shared tracking-redirect host is not a URL match', () => {
  const a = ev('Event A', 'X', D + 'T19:00:00', { url: 'https://mailchi.mp/abc/link1' });
  const b = ev('Event B', 'Y', D + 'T19:00:00', { url: 'https://mailchi.mp/abc/link2' });
  assert.equal(canonicalUrl(a.url), null);
  assert.equal(isDuplicate(a, b), false);
});

// ---- helpers ----

test('normName strips possessives, parentheticals, venue suffix/prefix, filler', () => {
  assert.equal(normName('Spike Lee’s BK Loves MJ', 'Fort Greene Park'), 'spike lee bk loves mj');
  assert.equal(normName('BK Loves MJ (Spike Lee Joint) at Fort Greene Park', 'Fort Greene Park, Central Lawn'), 'bk loves mj');
  assert.equal(normName('Social Salsa at Greeley Square Park', 'Greeley Square Park'), 'social salsa');
  assert.equal(normName('Sunset in the Park', 'Pier 1'), 'sunset in the park');   // "in the park" is the title, venue does not match
  assert.equal(normName('Dogs in the Visual Arts', 'National Arts Club'), 'dogs in the visual arts');   // one shared word is not a location clause
});

test('canonicalUrl normalizes host/path/query and strips tracking params', () => {
  assert.equal(canonicalUrl('https://WWW.Example.org/event/x/?utm_source=a&id=5'), 'example.org/event/x?id=5');
  assert.equal(canonicalUrl('http://example.org/event/x'), 'example.org/event/x');
  assert.equal(canonicalUrl('https://www.google.com/search?q=x'), null);
  assert.equal(canonicalUrl(''), null);
});

test('venuesCompatible: substring, shared tokens, generic venue', () => {
  assert.equal(venuesCompatible('Little Island (The Glade)', 'Little Island'), true);
  assert.equal(venuesCompatible('Fort Greene Park, Central Lawn', 'Fort Greene Park Conservancy'), true);
  assert.equal(venuesCompatible('Union Hall', 'Littlefield'), false);
  assert.equal(venuesCompatible('New York City ( NYC )', 'Anything'), true);
  assert.equal(venuesCompatible('Brooklyn Botanic Garden', 'BBG'), true);
  assert.equal(venuesCompatible('Museum of the Moving Image', 'MoMI, Astoria'), true);
});

test('a shared source-level fallback URL or listing page never identifies an event', () => {
  const a = ev('Bowls II - AD', 'Makeville Studio', D + 'T19:00:00', { url: 'https://www.makeville.com/classes', urlIsFallback: true });
  const b = ev('Carving for Beginners: ESG', 'Makeville Studio', D + 'T19:00:00', { url: 'https://www.makeville.com/classes', urlIsFallback: true });
  assert.equal(isDuplicate(a, b), false);
  assert.equal(canonicalUrl('https://www.arlenesgrocerynyc.com/upcoming-events'), null);
  assert.equal(canonicalUrl('https://venue.org/events/'), null);
  assert.equal(canonicalUrl('https://venue.org/events/the-show'), 'venue.org/events/the-show');
});
