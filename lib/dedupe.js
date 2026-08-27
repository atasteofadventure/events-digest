'use strict';
// Cross-source duplicate detection.
//
// The same event reaches us from several places (a newsletter, the venue's own
// email, the venue's calendar feed, an aggregator) and each words it differently:
//   "Spike Lee’s BK Loves MJ"            vs "BK Loves MJ (Spike Lee Joint) at Fort Greene Park"
//   "Radiolab: Grass Fed"                vs "Live-Radio Romp with Radiolab: Grass Fed at Little Island"
//   "Volkswagen Gridlock Car Show 2026"  vs "Gridlock: The Annual VW Car Show"
// while genuinely different events can look alike:
//   "Frances Ha at MoMI"                 vs "The Untouchables (70mm) at MoMI"     (same venue, same day)
//   "Trivia Night" @ Union Hall          vs "Trivia Night" @ Littlefield
//   "NY Art Book Fair"                   vs "NY Art Book Fair Opening Night"
//
// Two records are the same event when they are on the same day and EITHER
//   (a) point at the same canonical URL, OR
//   (b) their normalized names are similar enough (bigram Dice, token Jaccard,
//       or token containment) AND their venues are compatible AND their start
//       times are within a couple of hours AND the longer name does not add an
//       event-type word (opening, reception, tour, ...) that marks it as a
//       different event at the same thing.
// Every threshold below is pinned by a test in dedupe.test.js.

const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'at', 'of', 'in', 'on', 'to', 'with', 'for', 'by', 'from', 'vs', 'w']);
// Marketing/filler words that vary between sources without changing the event.
const FILLER = new Set(['free', 'presents', 'present', 'featuring', 'feat', 'ft', 'live', 'event', 'events', 'nyc',
  'new', 'york', 'city', 'brooklyn', 'manhattan', 'queens', 'bronx', 'annual', 'edition', 'special', 'official',
  '2025', '2026', '2027']);
// Words that, when only ONE name has them, signal a different sub-event of the
// same thing (the fair vs. its opening night; the exhibition vs. a curator tour).
const DISCRIMINATORS = new Set(['opening', 'closing', 'reception', 'preview', 'night', 'party', 'afterparty', 'after',
  'panel', 'talk', 'lecture', 'tour', 'screening', 'workshop', 'class', 'gala', 'brunch', 'dinner', 'lunch', 'breakfast',
  'kickoff', 'finale', 'ceremony', 'walkthrough', 'q&a', 'qa', 'conversation', 'performance', 'concert', 'market',
  'matinee', 'encore', 'premiere', 'rehearsal', 'members', 'member', 'vip', 'canceled', 'cancelled', 'postponed']);
// A venue is "generic" when nothing is left after removing place-holder words
// ("New York City ( NYC )", "Brooklyn", "Various locations", "TBA").
const GENERIC_WORDS = new Set(['new', 'york', 'city', 'nyc', 'ny', 'brooklyn', 'manhattan', 'queens', 'bronx', 'staten', 'island',
  'online', 'tba', 'tbd', 'various', 'multiple', 'locations', 'location', 'venue', 'venues']);
function isGenericVenue(nv) {
  return tokensOf(nv).every((t) => GENERIC_WORDS.has(t));
}
// "BBG" for "Brooklyn Botanic Garden", "MoMI" for "Museum of the Moving Image":
// initials of every word except the/and/a/an.
function acronym(nv) {
  const words = nv.split(' ').filter((w) => w && !['the', 'and', 'a', 'an'].includes(w));
  return words.length >= 2 ? words.map((w) => w[0]).join('') : '';
}

const VENUE_WORDS = /\b(park|museum|hall|center|centre|library|garden|gardens|theater|theatre|club|bar|square|island|pier|cemetery|gallery|studio|church|cathedral|plaza|lawn|boathouse|bookstore|brewery|cafe|lounge|arena|stadium|market|pavilion|rooftop|terrace|campus|school|university|college|institute|society|conservancy|street|st|ave|avenue|room)\b/;

// ---------- normalization ----------

function fold(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')           // strip diacritics
    .replace(/[‘’‚′]/g, "'")                  // curly -> straight apostrophe
    .replace(/[“”″]/g, '"')
    .replace(/[–—‒]/g, '-')
    .toLowerCase();
}

function normVenue(v) {
  return fold(v).replace(/'s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokensOf(s) {
  return s.split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function venueTokens(v) {
  return new Set(tokensOf(normVenue(v)).filter((t) => !FILLER.has(t)));
}

// Normalize an event name for comparison. Removes possessives, parentheticals,
// a trailing "at/in/@ <place>" when the place overlaps the venue (or the
// original text), a leading "<venue>: " / "<venue> presents", and filler.
function normName(name, venue) {
  let n = fold(name)
    .replace(/'s\b/g, '')                                   // possessives
    .replace(/\((?:[^()]*)\)|\[[^\]]*\]/g, ' ')            // (Spike Lee Joint), (70mm), [SOLD OUT]
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim();
  const vt = venueTokens(venue);
  // Trailing location clause: " at fort greene park", " in greeley square park", " @ moma ps1"
  const m = / (?:at|in|@) ([a-z0-9& ]+)$/.exec(n);
  if (m) {
    const tail = tokensOf(m[1]);
    const hits = tail.filter((t) => vt.has(t)).length;
    // With a known venue the clause must overlap it; with no venue to check
    // against, only strip a clause that reads like a place name.
    const looksLikePlace = tail.length <= 5 && VENUE_WORDS.test(m[1]);
    if (vt.size === 0 ? looksLikePlace : (hits === tail.length || hits >= 2)) {
      n = n.slice(0, m.index).trim();
    }
  }
  // Leading venue prefix: "moma ps1 presents x", "little island x" is too loose; only "venue: x" style
  // survives as a sequence of venue tokens at the start.
  const lead = tokensOf(n);
  let cut = 0;
  while (cut < lead.length - 1 && vt.has(lead[cut])) cut++;
  if (cut >= 2 && cut >= vt.size - 1) n = lead.slice(cut).join(' ');
  return n.replace(/\s+/g, ' ').trim();
}

function nameTokens(normalized) {
  return new Set(tokensOf(normalized).filter((t) => !FILLER.has(t)));
}

// ---------- similarity ----------

function bigrams(s) {
  const t = s.replace(/ /g, '');
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    out.set(b, (out.get(b) || 0) + 1);
  }
  return out;
}

// Sørensen–Dice over character bigrams: robust to reordering and small typos.
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ba = bigrams(a), bb = bigrams(b);
  let inter = 0, na = 0, nb = 0;
  for (const [g, c] of ba) { na += c; if (bb.has(g)) inter += Math.min(c, bb.get(g)); }
  for (const c of bb.values()) nb += c;
  return na + nb ? (2 * inter) / (na + nb) : 0;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Share of the smaller token set found in the larger one.
function containment(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (!small.size) return 0;
  let inter = 0;
  for (const t of small) if (large.has(t)) inter++;
  return inter / small.size;
}

// ---------- other signals ----------

const REDIRECT_HOSTS = /(^|\.)(mailchi\.mp|list-manage\.com|click\.|links?\.|email\.|substack\.com|sendgrid\.net|mandrillapp\.com|eventbrite\.com\/e\/.*\?aff|t\.co|bit\.ly|lnkd\.in|go\.|track\.)/;

// A URL that is a whole calendar/listing page rather than one event's page.
// Many events legitimately share it, so it cannot identify an event.
const LISTING_PATH = /^\/?(events?|calendar|classes|schedule|upcoming(-events)?|whats-on|programs?|shows?)\/?$/i;

// Canonical form of an event URL, or null when the URL cannot identify a single
// event: a tracking redirect (two different events wrapped by one newsletter
// share a redirect host), a listing page, or a source-level fallback URL.
function canonicalUrl(u, opts) {
  if (opts && opts.urlIsFallback) return null;
  const s = String(u || '').trim();
  if (!/^https?:\/\//i.test(s)) return null;
  let url;
  try { url = new URL(s); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (REDIRECT_HOSTS.test(host + url.pathname)) return null;
  if (LISTING_PATH.test(url.pathname) || url.pathname === '/' ) return null;
  if (/^(www\.)?google\.[a-z.]+$/.test(url.hostname.toLowerCase())) return null;
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !/^(utm_|fbclid|gclid|mc_|ref|source|campaign|_hs|hs_|ncid|cmp|trk)/i.test(k))
    .sort();
  const q = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  const path = url.pathname.replace(/\/+$/, '').replace(/\/index\.html?$/, '') || '/';
  return `${host}${path}${q}`;
}

function venuesCompatible(a, b) {
  const va = normVenue(a), vb = normVenue(b);
  if (!va || !vb || isGenericVenue(va) || isGenericVenue(vb)) return true; // unknown venue: no evidence against
  if (va === vb) return true;
  if (` ${va} `.includes(` ${vb} `) || ` ${vb} `.includes(` ${va} `)) return true;
  const ta = venueTokens(a), tb = venueTokens(b);
  const acA = acronym(va), acB = acronym(vb);
  if ((acA && tb.has(acA)) || (acB && ta.has(acB))) return true;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap >= 2 || (overlap === 1 && Math.min(ta.size, tb.size) === 1);
}

// Minutes between two start times; null when either lacks a clock time.
function minutesApart(a, b) {
  const ta = /T(\d{2}):(\d{2})/.exec(a || ''), tb = /T(\d{2}):(\d{2})/.exec(b || '');
  if (!ta || !tb) return null;
  const midnightA = ta[1] === '00' && ta[2] === '00', midnightB = tb[1] === '00' && tb[2] === '00';
  if (midnightA || midnightB) return null;                 // 00:00 means "all day / unknown"
  return Math.abs((+ta[1] * 60 + +ta[2]) - (+tb[1] * 60 + +tb[2]));
}

function sameDay(a, b) {
  const da = String(a.dateISO || '').slice(0, 10), db = String(b.dateISO || '').slice(0, 10);
  return !!da && da === db;
}

// ---------- decision ----------

const T = { dice: 0.82, jaccard: 0.6, containment: 0.8, minutes: 150, strongDice: 0.92, minTokensForVenueOverride: 4 };

// Returns { dup: boolean, reason, score } so callers (and tests) can see why.
function compare(a, b) {
  if (!sameDay(a, b)) return { dup: false, reason: 'different-day' };

  const ua = canonicalUrl(a.url, a), ub = canonicalUrl(b.url, b);
  if (ua && ub && ua === ub) return { dup: true, reason: 'same-url', score: 1 };

  const na = normName(a.name, a.venue), nb = normName(b.name, b.venue);
  if (!na || !nb) return { dup: false, reason: 'no-name' };
  const ta = nameTokens(na), tb = nameTokens(nb);

  const mins = minutesApart(a.dateISO, b.dateISO);
  if (mins !== null && mins > T.minutes) return { dup: false, reason: 'time-apart' };

  // A word present in only one name that marks a distinct sub-event.
  for (const t of ta) if (!tb.has(t) && DISCRIMINATORS.has(t)) return { dup: false, reason: 'discriminator:' + t };
  for (const t of tb) if (!ta.has(t) && DISCRIMINATORS.has(t)) return { dup: false, reason: 'discriminator:' + t };

  const d = dice(na, nb), j = jaccard(ta, tb), c = containment(ta, tb);
  const compatible = venuesCompatible(a.venue, b.venue);

  if (compatible) {
    if (d >= T.dice) return { dup: true, reason: 'dice', score: d };
    if (j >= T.jaccard) return { dup: true, reason: 'jaccard', score: j };
    if (c >= T.containment && Math.min(ta.size, tb.size) >= 2) return { dup: true, reason: 'containment', score: c };
    if (na === nb) return { dup: true, reason: 'exact', score: 1 };
    return { dup: false, reason: 'dissimilar', score: Math.max(d, j, c) };
  }
  // Venues disagree: only a near-identical, sufficiently specific name overrides
  // ("Trivia Night" at two bars is two events; a 5-word title matching 92% is one).
  if (d >= T.strongDice && Math.min(ta.size, tb.size) >= T.minTokensForVenueOverride) {
    return { dup: true, reason: 'strong-name-venue-mismatch', score: d };
  }
  return { dup: false, reason: 'venue-mismatch', score: d };
}

function isDuplicate(a, b) { return compare(a, b).dup; }

// Exact key for the fast path: normalized name | day | normalized venue.
function exactKey(e) {
  return `${normName(e.name, e.venue)}|${String(e.dateISO || '').slice(0, 10)}|${normVenue(e.venue)}`;
}

module.exports = { compare, isDuplicate, exactKey, normName, normVenue, canonicalUrl, venuesCompatible, dice, jaccard, containment, THRESHOLDS: T };
