'use strict';
// Standing exclusions (user directive, 2026-08-27): the digest never shows
// child-oriented events, comedy, virtual/online-only events, or book talks.
// These are deterministic keyword rules applied at build time so they hold
// regardless of what the LLM extraction or a venue feed hands us. The prompt
// asks the extractor to skip the same things, but this layer is the guarantee.
//
// Every rule is a word-boundary regex over the text the event actually carries
// (name, venue, why). Rules are deliberately narrow: a false drop hides a real
// event, a false keep is merely noise. Tune by adding tests in filters.test.js.

const text = (e) => [e && e.name, e && e.why].filter(Boolean).join(' \n ');

// Kids: the NAME is the reliable signal (organizers put "Kids"/"Storytime"/
// "Toddler" in the title). Descriptions get only unambiguous phrases — a talk
// whose blurb mentions someone's "children" or "youth" is not a kids' event.
const KIDS_NAME = /\b(storytime|story ?time|story hour|kids?|children|children'?s|childrens|toddlers?|tweens?|teens?|youth|family (day|fun|program|festival|workshop|friendly|hour)|ages? \d+(-|–| to )\d+|young readers?|little ones|pre-?k|kindergarten|grades? [k0-9]|playground)\b/i;
const KIDS_WHY = /\b(for (kids|children|toddlers|teens|tweens|young children|little ones|families with (young )?(kids|children))|ages? \d+(-|–| to |\+)|children'?s (program|event|workshop|class|activity|activities)|kids'? (program|event|workshop|class|activity|activities)|storytime|story ?time|all ages welcome)\b/i;
// "Family" alone is too broad (Family Business, family history talks); the
// compound forms above are what kids' programming actually uses.

// Comedy: by category or title; a description only counts for live-comedy
// words, and never for a film screening (a 70mm comedy film is a screening).
const COMEDY_NAME = /\b(comedy|comedian|comedians|stand-?up|improv|sketch show|open mic comedy|roast battle)\b/i;
const COMEDY_WHY = /\b(stand-?up|comedians?|improv|sketch comedy|comedy (show|night|competition|slam|debate|roundtable|club|special|hour|showcase))\b/i;

// Virtual: online-only. Hybrid "in person and online" events stay.
const VIRTUAL = /\b(online|virtual|virtually|zoom|webinar|livestream|live-?streamed?|google meet|microsoft teams)\b/i;
const IN_PERSON = /\bin[- ]person\b/i;

// Book talks: launches, signings, author conversations, book clubs.
const BOOK = /\b(book (talk|launch|club|signing|discussion|reading|release|party|event|tour|presentation)|author (talk|event|reading|discussion|conversation|q ?& ?a)|(his|her|their|new|latest|debut|forthcoming|upcoming) (new |latest |debut |first |second )?(book|memoir|novel|biography|essay collection|poetry collection|short story collection)|reading and signing|signing and discussion|\+ signing|in conversation about (his|her|their)|discuss(es|ing)? (a|the|his|her|their) (new |nonfiction |fiction )?(book|novel|memoir)|celebrates? (his|her|their) (new |latest )?book|shares? (his|her|their) (new |latest )?(book|memoir|novel)|book by|novelist|memoirist)\b/i;

function dropReason(e) {
  if (!e) return null;
  const t = text(e);
  const venue = String((e && e.venue) || '');
  const name = String(e.name || ''), why = String(e.why || '');
  if (e.category === 'comedy' || COMEDY_NAME.test(name)) return 'comedy';
  if (e.category !== 'film_screenings' && COMEDY_WHY.test(why)) return 'comedy';
  if (KIDS_NAME.test(name) || KIDS_WHY.test(why)) return 'kids';
  if (e.attendance === 'online') return 'virtual';
  if ((VIRTUAL.test(venue) || VIRTUAL.test(String(e.name || ''))) && !IN_PERSON.test(t + ' ' + venue)) return 'virtual';
  if (e.literary === true || BOOK.test(t)) return 'book_talk';
  return null;
}

// Filter a list; returns { kept, dropped: { reason: count } }.
function applyExclusions(events) {
  const kept = [];
  const dropped = {};
  for (const e of events || []) {
    const r = dropReason(e);
    if (r) { dropped[r] = (dropped[r] || 0) + 1; continue; }
    kept.push(e);
  }
  return { kept, dropped };
}

module.exports = { dropReason, applyExclusions };
