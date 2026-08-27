'use strict';
// Deterministic feed parsing: ICS calendars, schema.org JSON-LD markup,
// Squarespace collection JSON, and two structured RSS dialects (NYC Parks'
// event: namespace, NYC Resistor's date-in-title posts).
//
// Feeds don't classify events, and no-curation means nothing is dropped for
// lack of a category — everything lands in 'miscellaneous'. Every parser
// returns the exact event shape the build consumes (see makeEvent).

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// A reasonable named-entity table (that scale, not exhaustive). &amp; is
// handled separately, LAST, so that &amp;eacute; decodes to the literal
// "&eacute;" rather than double-decoding into "é".
const NAMED_ENTITIES = {
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
  uuml: 'ü', ouml: 'ö', aacute: 'á', iacute: 'í',
  oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function fromCodePoint(cp) {
  try { return String.fromCodePoint(cp); } catch { return ''; } // out-of-range -> drop
}

// Decode HTML entities: numeric decimal (&#233;), numeric hex (&#x2019;), a
// named table, and &amp; LAST. Run this AFTER tag-stripping.
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in NAMED_ENTITIES ? NAMED_ENTITIES[n] : m))
    .replace(/&amp;/g, '&'); // last, so &amp;eacute; -> &eacute; (not é)
}

// Strip tags, then decode entities (order matters — see decodeEntities),
// then collapse whitespace.
function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

// Truncate to <=max chars on a word boundary, appending an ellipsis only when
// the text was actually cut. Trailing punctuation/space is trimmed first.
function truncateWords(s, max) {
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  return cut.replace(/[\s.,;:!?–—-]+$/, '') + '…';
}

// Normalize a description into `why`: strip tags/entities, drop a leading
// photo-credit prefix ("Credit: Evan Rabeck Before our gates..."), then
// truncate to 200 chars on a word boundary. The credit rule is conservative:
// it only fires when "Credit:" is the very start, followed by 1-3 capitalized
// words before the real (also-capitalized) sentence.
function cleanWhy(why) {
  const s = stripTags(why)
    .replace(/^Credit:\s+(?:[A-Z]\S*\s+){1,3}(?=[A-Z])/, '');
  return truncateWords(s, 200);
}

// Fort Greene Park runs mixed programming with no per-event category; classify
// by title keyword, defaulting to miscellaneous.
function fgpTitleCategory(title) {
  return /yoga|fitness|workout|run club|AMP'd|pilates|zumba|tai chi/i.test(String(title || ''))
    ? 'sports_fitness' : 'miscellaneous';
}

// NYC Parks event:categories -> digest id. First-match wins, so order matters
// (an event tagged both "Art" and "Arts & Crafts" resolves to art_exhibitions).
const PARKS_CATEGORY_MAP = [
  ['Fitness', 'sports_fitness'], ['Exercise Classes', 'sports_fitness'],
  ['Outdoor Fitness', 'sports_fitness'], ['Shape Up NYC', 'sports_fitness'],
  ['Sports', 'sports_fitness'], ['Running/Jogging', 'sports_fitness'],
  ['Basketball/Netball', 'sports_fitness'], ['Dance Classes', 'sports_fitness'],
  ['Free Summer Movies', 'film_screenings'], ['Movies', 'film_screenings'],
  ['Free Summer Concerts', 'music_nightlife'], ['Concerts', 'music_nightlife'],
  ['Music', 'music_nightlife'],
  ['Art', 'art_exhibitions'],
  ['Arts & Crafts', 'workshops_classes'],
  ['Talks', 'talks_lectures'], ['Education', 'talks_lectures'],
  ['Tours', 'tours_experiences'], ['History', 'tours_experiences'],
  ['Nature', 'tours_experiences'], ['Birding', 'tours_experiences'],
  ['Wildlife', 'tours_experiences'], ['Waterfront', 'tours_experiences'],
  ['Hiking', 'tours_experiences'],
];

function parksCategory(cats) {
  const set = new Set(cats);
  for (const [name, id] of PARKS_CATEGORY_MAP) if (set.has(name)) return id;
  return 'miscellaneous';
}

// Convert a UTC wall time to America/New_York local, returned as a naive ISO
// string (the format events.json uses). Needed for Google Calendar ICS, which
// stores times as UTC (...Z); rendering those raw would show times 4-5h late.
function utcToNewYork(y, mo, d, hh, mm, ss) {
  const dt = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(dt);
  const get = (t) => parts.find((p) => p.type === t).value;
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`;
}

function timeLabel(iso) {
  const h = Number(iso.slice(11, 13));
  const m = iso.slice(14, 16);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

// Generic title classifier: strong keywords beat a source-wide default
// category (a cyanotype workshop on the Gowanus Dredgers' calendar is a
// workshop, not a sport). First match wins; order is specificity.
const TITLE_RULES = [
  [/\b(workshop|class|masterclass|course|lesson|tutorial|make your own|learn to|101\b|bootcamp|hands-on)\b/i, 'workshops_classes'],
  [/\b(screening|film|movie|cinema|documentary|shorts program)\b/i, 'film_screenings'],
  [/\b(concert|live music|dj|band|jam|sessions?|karaoke|orchestra|choir|recital|album release|dance party)\b/i, 'music_nightlife'],
  [/\b(exhibit(ion)?|gallery|opening reception|art show|installation|vernissage)\b/i, 'art_exhibitions'],
  [/\b(lecture|talk|panel|symposium|conversation|discussion|q ?& ?a|keynote)\b/i, 'talks_lectures'],
  [/\b(festival|parade|block party|street fair|celebration|fest)\b/i, 'festivals_parties'],
  [/\b(yoga|pilates|fitness|workout|run club|paddl(e|ing)|kayak|canoe|climb(ing)?|race|zumba|tai chi|voyage)\b/i, 'sports_fitness'],
  [/\b(tour|walk(ing)?|hike|foray|birding|bird walk|stroll|expedition)\b/i, 'tours_experiences'],
];
function titleCategory(title) {
  const t = String(title || '');
  for (const [re, cat] of TITLE_RULES) if (re.test(t)) return cat;
  return null;
}

// ICS CATEGORIES (WordPress/Tribe calendars) -> digest id, used when the title
// carries no strong keyword.
const ICS_CATEGORY_MAP = [
  ['Arts', 'art_exhibitions'], ['Music', 'music_nightlife'], ['Guided Tours', 'tours_experiences'],
  ['Tours', 'tours_experiences'], ['On the Water', 'sports_fitness'], ['Fitness', 'sports_fitness'],
  ['Talks', 'talks_lectures'], ['Lecture', 'talks_lectures'], ['Workshop', 'workshops_classes'],
  ['Film', 'film_screenings'],
];
function icsCategory(cats) {
  const set = new Set(cats || []);
  for (const [name, id] of ICS_CATEGORY_MAP) if (set.has(name)) return id;
  return null;
}

// Some sites emit one site-wide blurb as every event's DESCRIPTION (Gowanus
// Dredgers, 2026-08). A `why` shared by 3+ events of one source is boilerplate,
// not an event description; blank it so it can neither mislead the reader nor
// trip the keyword exclusions.
function stripSharedWhy(events) {
  const counts = new Map();
  for (const e of events) if (e.why) counts.set(e.why, (counts.get(e.why) || 0) + 1);
  for (const e of events) if (e.why && counts.get(e.why) >= 3) e.why = '';
  return events;
}

// fallbackUrl: a source's public calendar page, used only when the feed carries
// no per-event link (Google Calendar ICS). The build drops events without a
// real URL, so a source with linkless items needs `fallback_url` in config.
function makeEvent({ sourceName, name, dateISO, time, venue, price, url, why, category, fallbackUrl, attendance, literary }) {
  const u = String(url || '').trim();
  return {
    id: `feed-${slug(sourceName)}-${dateISO.slice(0, 10)}-${slug(name).slice(0, 40)}`,
    name: stripTags(name), // also decodes HTML entities (&nbsp;, &amp;, ...)
    dateISO,
    time: time || '',
    venue: stripTags(venue) || sourceName, // decode entities in venue too (Café, ...)
    neighborhood: '',
    price: price || '',
    url: /^https?:\/\//i.test(u) ? u : (fallbackUrl || ''),
    ...(!/^https?:\/\//i.test(u) && fallbackUrl ? { urlIsFallback: true } : {}),
    category: titleCategory(name) || category || 'miscellaneous',
    source: sourceName,
    via: [`feed: ${sourceName}`],
    why: cleanWhy(why), // word-boundary truncation + credit-line strip
    ...(attendance ? { attendance } : {}),
    ...(literary ? { literary: true } : {}),
  };
}

// ---------- ICS (RFC 5545) ----------

function parseICS(text) {
  // Unfold: long lines continue with CRLF + one space/tab.
  const unfolded = String(text || '').replace(/\r?\n[ \t]/g, '');
  const events = [];
  let cur = null;
  for (const line of unfolded.split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0].toUpperCase();
    const raw = line.slice(i + 1);
    const val = raw.replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
    if (key === 'SUMMARY') cur.summary = val;
    else if (key === 'DTSTART') cur.dtstart = raw.trim();
    else if (key === 'URL') cur.url = val;
    else if (key === 'LOCATION') cur.location = val;
    else if (key === 'DESCRIPTION') cur.description = val;
    else if (key === 'CATEGORIES') cur.categories = val.split(',').map(x => x.trim()).filter(Boolean);
  }
  return events;
}

// 20260711T100000 / 20260705T230000Z / 20260712 -> { iso, allDay }
function icsDateToISO(dt) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(dt || ''));
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  const allDay = hh === undefined;
  if (z) return { iso: utcToNewYork(+y, +mo, +d, +hh, +mm, +(ss || 0)), allDay: false };
  return { iso: `${y}-${mo}-${d}T${hh || '00'}:${mm || '00'}:${ss || '00'}`, allDay };
}

function icsToEvents(text, { sourceName, defaultCategory, fallbackUrl }) {
  return parseICS(text)
    .filter((v) => v.summary && v.dtstart)
    .map((v) => {
      const parsed = icsDateToISO(v.dtstart);
      if (!parsed) return null;
      return makeEvent({
        sourceName,
        name: v.summary,
        dateISO: parsed.iso,
        time: parsed.allDay ? '' : timeLabel(parsed.iso),
        venue: v.location,
        url: v.url,
        why: v.description,
        category: icsCategory(v.categories) || defaultCategory,
        fallbackUrl,
      });
    })
    .filter(Boolean);
}

// ---------- schema.org JSON-LD ----------

function collectLdEvents(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => collectLdEvents(n, out)); return; }
  const t = node['@type'];
  const isEvent = t === 'Event'
    || (Array.isArray(t) && t.includes('Event'))
    || (typeof t === 'string' && /Event$/.test(t)); // MusicEvent, TheaterEvent, ...
  if (isEvent && node.name && node.startDate) out.push(node);
  if (node['@graph']) collectLdEvents(node['@graph'], out);
}

function jsonLdToEvents(html, { sourceName, defaultCategory, fallbackUrl }) {
  const found = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try { collectLdEvents(JSON.parse(m[1]), found); } catch { /* skip broken block */ }
  }
  return found.map((n) => {
    // Timezone handling: a trailing Z is true UTC (e.g. Club Free Time) and must
    // be converted to NY local; a ±HH:MM offset on an NYC site already carries
    // the local wall time, so stripping the offset keeps the right time.
    let raw = String(n.startDate);
    if (/T\d{2}.*Z$/.test(raw)) {
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$/.exec(raw);
      if (m) raw = utcToNewYork(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
    } else {
      raw = raw.replace(/([+-]\d{2}:\d{2}|Z)$/, '');
    }
    const hasTime = /T\d{2}/.test(raw);
    const dateISO = hasTime ? raw.padEnd(19, ':00').slice(0, 19) : raw.slice(0, 10) + 'T00:00:00';
    const offers = Array.isArray(n.offers) ? n.offers[0] : n.offers;
    const price = offers && offers.price != null && offers.price !== ''
      ? (Number(offers.price) === 0 ? 'Free' : `$${offers.price}`) : '';
    const loc = n.location && (n.location.name
      || (n.location.address && (n.location.address.streetAddress || n.location.address)));
    // Club Free Time puts the event page under offers.url / organizer.url (with
    // a doubled slash) and never at the top-level url.
    const pick = (...cands) => {
      for (const c of cands) if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c.replace(/([^:])\/\/+/g, '$1/');
      return '';
    };
    const url = pick(n.url, offers && offers.url, n.organizer && n.organizer.url);
    const mode = String(n.eventAttendanceMode || '');
    const attendance = /OnlineEventAttendanceMode/.test(mode) ? 'online'
      : /MixedEventAttendanceMode/.test(mode) ? 'mixed' : '';
    const t = n['@type'];
    const literary = t === 'LiteraryEvent' || (Array.isArray(t) && t.includes('LiteraryEvent'));
    return makeEvent({
      sourceName,
      name: n.name,
      dateISO,
      time: hasTime ? timeLabel(dateISO) : '',
      venue: typeof loc === 'string' ? loc : '',
      price,
      url,
      why: typeof n.description === 'string' ? n.description : '',
      category: defaultCategory,
      fallbackUrl,
      attendance,
      literary,
    });
  });
}

// ---------- Squarespace collection JSON (<collection-url>?format=json) ----------

function squarespaceJsonToEvents(json, { sourceName, origin, defaultCategory }) {
  const items = (json && (json.upcoming || json.items)) || [];
  return items
    .filter((i) => i && i.title && i.startDate)
    .map((i) => {
      // No configured default (Fort Greene Park's mixed programming) -> classify
      // by title keyword; otherwise the source-wide default applies.
      const category = defaultCategory || fgpTitleCategory(i.title);
      // startDate is epoch ms (UTC); Squarespace events are NYC-local venues.
      const d = new Date(i.startDate);
      const [y, mo, day, hh, mm, ss] = [
        d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(),
        d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
      ];
      const iso = utcToNewYork(y, mo, day, hh, mm, ss);
      const url = i.fullUrl ? new URL(i.fullUrl, origin).href : '';
      const venue = i.location && (i.location.addressTitle || i.location.addressLine1);
      return makeEvent({
        sourceName,
        name: i.title,
        dateISO: iso,
        time: timeLabel(iso),
        venue,
        url,
        why: i.excerpt,
        category,
      });
    });
}

// ---------- NYC Parks RSS (custom event: namespace) ----------

function cdata(s) {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(String(s || ''));
  return (m ? m[1] : String(s || '')).trim();
}

function tagContent(item, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(item);
  return m ? cdata(m[1]) : '';
}

// "10:00 am" -> "T10:00:00"; "" -> midnight + no time label
function parksTime(startdate, starttime) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(starttime || '').trim());
  if (!m) return { iso: `${startdate}T00:00:00`, time: '' };
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  const iso = `${startdate}T${String(h).padStart(2, '0')}:${m[2]}:00`;
  return { iso, time: timeLabel(iso) };
}

function nycParksRssToEvents(xml, { sourceName, boroughs, excludeCategories, boroughOnlyCategories }) {
  const items = String(xml || '').match(/<item>[\s\S]*?<\/item>/g) || [];
  const excluded = new Set(excludeCategories || []);
  const events = [];
  for (const item of items) {
    const startdate = tagContent(item, 'event:startdate');
    const title = tagContent(item, 'title');
    if (!startdate || !title) continue;
    // Park IDs encode borough in the first letter: B/M/Q/X, R = Staten Island.
    const ids = tagContent(item, 'event:parkids').split(/[,\s]+/).filter(Boolean);
    if (Array.isArray(boroughs) && boroughs.length) {
      if (!ids.some((id) => boroughs.includes(id[0].toUpperCase()))) continue;
    }
    const cats = tagContent(item, 'event:categories').split('|').map((c) => c.trim()).filter(Boolean);
    // User-chosen category excludes (e.g. Best for Kids, Swimming/Aquatics).
    if (cats.some((c) => excluded.has(c))) continue;
    // Borough-conditional categories (e.g. Fitness only in Brooklyn): drop when
    // the event carries the category but none of its parks is in an allowed borough.
    if (boroughOnlyCategories) {
      const eventBoroughs = ids.map((id) => id[0].toUpperCase());
      const blocked = cats.some((c) => {
        const allowed = boroughOnlyCategories[c];
        return Array.isArray(allowed) && !eventBoroughs.some((b) => allowed.includes(b));
      });
      if (blocked) continue;
    }
    const { iso, time } = parksTime(startdate, tagContent(item, 'event:starttime'));
    // A "Free …" category (Free Summer Concerts/Movies/Theater) reliably means
    // free admission; nothing else is asserted (rec-center classes can be paid).
    const price = cats.some((c) => c.startsWith('Free')) ? 'Free' : '';
    events.push(makeEvent({
      sourceName,
      name: title,
      dateISO: iso,
      time,
      venue: tagContent(item, 'event:location') || tagContent(item, 'event:parknames'),
      price,
      url: tagContent(item, 'registration_url') || tagContent(item, 'link'),
      why: tagContent(item, 'description'),
      category: parksCategory(cats),
    }));
  }
  return events;
}

// ---------- NYC Resistor RSS ("Jul 05 2026 : Title" posts) ----------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function resistorRssToEvents(xml, { sourceName, defaultCategory }) {
  const items = String(xml || '').match(/<item>[\s\S]*?<\/item>/g) || [];
  const events = [];
  for (const item of items) {
    const title = tagContent(item, 'title');
    const m = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s*:\s*(.+)$/.exec(title);
    if (!m) continue; // blog post, not an event announcement
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) continue;
    const dateISO = `${m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}T00:00:00`;
    events.push(makeEvent({
      sourceName,
      name: m[4],
      dateISO,
      time: '',
      venue: sourceName,
      url: tagContent(item, 'link'),
      why: tagContent(item, 'description'),
      category: defaultCategory,
    }));
  }
  return events;
}

// ---------- Eventbrite organizer pages ----------
// Organizer pages (eventbrite.com/o/<name>-<id>) embed a server-rendered
// "upcomingEvents":[...] JSON array. This is an undocumented page structure,
// not a stable API — if Eventbrite redesigns, this parser returns [] and the
// source shows up as a fetch/coverage gap (loud failure, handled upstream).

// Extract a balanced JSON array starting at the first '[' at/after `from`.
// String-aware so brackets inside string values don't break the matching.
function matchJsonArray(s, from) {
  const start = s.indexOf('[', from);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return s.slice(start, k + 1); }
  }
  return null;
}

function ebPrice(avail) {
  if (!avail) return '';
  if (avail.is_free) return 'Free';
  const num = (p) => (p && p.major_value != null) ? Number(p.major_value) : 0;
  const min = num(avail.minimum_ticket_price);
  const max = num(avail.maximum_ticket_price);
  if (!min && !max) return '';
  const fmt = (n) => '$' + (Number.isInteger(n) ? n : n.toFixed(2)).toString();
  return min === max ? fmt(min) : `${fmt(min)}-${max % 1 ? max.toFixed(2) : max}`;
}

function eventbriteOrganizerToEvents(html, { sourceName, defaultCategory }) {
  const s = String(html || '');
  const seen = new Set();
  const events = [];
  let i = -1;
  while ((i = s.indexOf('"upcomingEvents":', i + 1)) !== -1) {
    const raw = matchJsonArray(s, i);
    if (!raw) continue;
    let arr;
    try { arr = JSON.parse(raw); } catch { continue; }
    for (const ev of arr) {
      if (!ev || !ev.name || !ev.start_date || seen.has(ev.id)) continue;
      seen.add(ev.id);
      if (ev.is_cancelled || ev.is_online_event) continue;
      if (ev.ticket_availability && ev.ticket_availability.is_sold_out) continue;
      const time = String(ev.start_time || '').slice(0, 5);
      const dateISO = `${ev.start_date}T${time || '00:00'}:00`;
      events.push(makeEvent({
        sourceName,
        name: ev.name,
        dateISO,
        time: time ? timeLabel(dateISO) : '',
        venue: ev.primary_venue && ev.primary_venue.name,
        price: ebPrice(ev.ticket_availability),
        url: ev.url,
        why: ev.summary,
        category: defaultCategory,
      }));
    }
  }
  return events;
}

// Eventbrite EVENT pages embed schema.org JSON-LD with a real description and
// offers that the organizer-page blob lacks. Parse one event page and return
// { why, price } for enrichment (both '' when nothing usable is found).
function schemaOfferPrice(offers) {
  const o = Array.isArray(offers) ? offers[0] : offers;
  if (!o) return '';
  const toNum = (v) => (v != null && v !== '' ? Number(v) : null);
  let low = toNum(o.lowPrice != null ? o.lowPrice : o.price);
  let high = toNum(o.highPrice != null ? o.highPrice : (o.lowPrice != null ? o.highPrice : o.price));
  if (low == null || Number.isNaN(low)) return '';
  if (high == null || Number.isNaN(high)) high = low;
  if (low === 0 && high === 0) return 'Free';
  const fmt = (n) => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
  return low === high ? fmt(low) : `${fmt(low)}-${high % 1 ? high.toFixed(2) : high}`;
}

function eventbriteEventPageInfo(html) {
  const found = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try { collectLdEvents(JSON.parse(m[1]), found); } catch { /* skip broken block */ }
  }
  const node = found[0];
  if (!node) return { why: '', price: '' };
  return {
    why: typeof node.description === 'string' ? cleanWhy(node.description) : '',
    price: schemaOfferPrice(node.offers),
  };
}

module.exports = {
  titleCategory, icsCategory, stripSharedWhy,
  parseICS, icsToEvents, jsonLdToEvents, squarespaceJsonToEvents,
  nycParksRssToEvents, resistorRssToEvents, eventbriteOrganizerToEvents,
  decodeEntities, cleanWhy, parksCategory, fgpTitleCategory, eventbriteEventPageInfo,
};
