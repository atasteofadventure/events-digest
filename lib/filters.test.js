'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { dropReason, applyExclusions } = require('./filters');

const ev = (o) => Object.assign({ name: 'E', venue: 'V', why: '', category: 'miscellaneous' }, o);

test('drops child-oriented events (the Storytime case)', () => {
  assert.equal(dropReason(ev({ name: 'Storytime in the Park', why: 'Sing, read, and play with librarians… playing with other children' })), 'kids');
  assert.equal(dropReason(ev({ name: 'Family Fun Day' })), 'kids');
  assert.equal(dropReason(ev({ name: 'Nature Walk for Kids' })), 'kids');
  assert.equal(dropReason(ev({ name: 'Toddler Music Hour' })), 'kids');
  assert.equal(dropReason(ev({ name: 'Drawing Class, ages 6-10' })), 'kids');
});

test('keeps adult events whose text merely mentions family/history/children', () => {
  assert.equal(dropReason(ev({ name: 'Family Business: The Hirschfelds', why: 'A talk on a family art collection' })), null);
  assert.equal(dropReason(ev({ name: 'Green-Wood Twilight Tour' })), null);
  assert.equal(dropReason(ev({ name: 'History by a Hair', why: "a genomic investigation into Jefferson's paternity of Sally Hemings' children" })), null);
  assert.equal(dropReason(ev({ name: 'Niche Night: Y2K Baby One More Time', why: 'in his youth he was reckless' })), null);
  assert.equal(dropReason(ev({ name: 'Nature Walk', why: 'For kids and their grown-ups' })), 'kids');
});

test('a comedy FILM screening is a film, not a comedy show', () => {
  assert.equal(dropReason(ev({ name: "It's a Mad, Mad, Mad, Mad World (70mm)", category: 'film_screenings', why: 'slapstick comedy epic screens in 70mm' })), null);
  assert.equal(dropReason(ev({ name: 'Sunset Show', category: 'miscellaneous', why: 'an evening of stand-up' })), 'comedy');
});

test('drops comedy by category or by name', () => {
  assert.equal(dropReason(ev({ name: 'Late Show', category: 'comedy' })), 'comedy');
  assert.equal(dropReason(ev({ name: 'Comedy on Kingston: Stand-Up in Crown Heights', category: 'music_nightlife' })), 'comedy');
  assert.equal(dropReason(ev({ name: 'Punderdome', why: 'A stand-up pun competition' })), 'comedy');
});

test('drops online-only events but keeps hybrid in-person ones', () => {
  assert.equal(dropReason(ev({ name: 'Become a Thought Leader', venue: 'Online (NYPL)', category: 'talks_lectures' })), 'virtual');
  assert.equal(dropReason(ev({ name: 'Virtual Tour of the Archive' })), 'virtual');
  assert.equal(dropReason(ev({ name: 'Webinar: Zoning 101' })), 'virtual');
  assert.equal(dropReason(ev({ name: 'Ambassador Discusses His Career (In Person AND Online!)', venue: 'NYC' })), null);
  assert.equal(dropReason(ev({ name: 'Talk', venue: 'NYC', attendance: 'online' })), 'virtual');
});

test('drops book talks', () => {
  assert.equal(dropReason(ev({ name: 'Discuss a Nonfiction Book about the Nature of Consciousness' })), 'book_talk');
  assert.equal(dropReason(ev({ name: 'Architect Celebrates His New Book, Shingle Style Houses (+ Signing)' })), 'book_talk');
  assert.equal(dropReason(ev({ name: 'NYT Journalist Shares Her Book on Crime in Gilded Age NYC' })), 'book_talk');
  assert.equal(dropReason(ev({ name: 'Jane Doe: Book Launch' })), 'book_talk');
  assert.equal(dropReason(ev({ name: 'An Evening with X', why: 'The author discusses her new memoir' })), 'book_talk');
  assert.equal(dropReason(ev({ name: 'Reading', literary: true })), 'book_talk');
});

test('keeps talks that are not about a book', () => {
  assert.equal(dropReason(ev({ name: 'Art Scholars Discuss Stettheimer & O’Keeffe', category: 'talks_lectures' })), null);
  assert.equal(dropReason(ev({ name: 'Cyanotype Workshop with Brian Ellis' })), null);
  assert.equal(dropReason(ev({ name: 'Bookbinding Workshop' })), null);
});

test('applyExclusions returns kept list and per-reason counts', () => {
  const { kept, dropped } = applyExclusions([
    ev({ name: 'Keep' }), ev({ name: 'Storytime' }), ev({ name: 'Stand-up Night' }), ev({ name: 'Open Mic', category: 'comedy' }),
  ]);
  assert.deepEqual(kept.map(e => e.name), ['Keep']);
  assert.deepEqual(dropped, { kids: 1, comedy: 2 });
});

test('drops listings the organizer withdrew (CANCELED:, sold out)', () => {
  assert.equal(dropReason(ev({ name: 'CANCELED: Bodyweight Circuit Training' })), 'cancelled');
  assert.equal(dropReason(ev({ name: 'Big Show [SOLD OUT]' })), 'cancelled');
  assert.equal(dropReason(ev({ name: 'Cancel Culture: a panel' })), null);
});
