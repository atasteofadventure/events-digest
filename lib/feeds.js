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

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
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

function makeEvent({ sourceName, name, dateISO, time, venue, price, url, why }) {
  return {
    id: `feed-${slug(sourceName)}-${dateISO.slice(0, 10)}-${slug(name).slice(0, 40)}`,
    name: stripTags(name), // also decodes HTML entities (&nbsp;, &amp;, ...)
    dateISO,
    time: time || '',
    venue: venue || sourceName,
    neighborhood: '',
    price: price || '',
    url: url || '',
    category: 'miscellaneous',
    source: sourceName,
    via: [`feed: ${sourceName}`],
    why: stripTags(why).slice(0, 200),
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

function icsToEvents(text, { sourceName }) {
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

function jsonLdToEvents(html, { sourceName }) {
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
    return makeEvent({
      sourceName,
      name: n.name,
      dateISO,
      time: hasTime ? timeLabel(dateISO) : '',
      venue: typeof loc === 'string' ? loc : '',
      price,
      url: typeof n.url === 'string' ? n.url : '',
      why: typeof n.description === 'string' ? n.description : '',
    });
  });
}

// ---------- Squarespace collection JSON (<collection-url>?format=json) ----------

function squarespaceJsonToEvents(json, { sourceName, origin }) {
  const items = (json && (json.upcoming || json.items)) || [];
  return items
    .filter((i) => i && i.title && i.startDate)
    .map((i) => {
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
    events.push(makeEvent({
      sourceName,
      name: title,
      dateISO: iso,
      time,
      venue: tagContent(item, 'event:location') || tagContent(item, 'event:parknames'),
      price: '', // feed has no pricing; most parks events are free but don't assert it
      url: tagContent(item, 'registration_url') || tagContent(item, 'link'),
      why: tagContent(item, 'description'),
    }));
  }
  return events;
}

// ---------- NYC Resistor RSS ("Jul 05 2026 : Title" posts) ----------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function resistorRssToEvents(xml, { sourceName }) {
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

function eventbriteOrganizerToEvents(html, { sourceName }) {
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
      }));
    }
  }
  return events;
}

module.exports = {
  parseICS, icsToEvents, jsonLdToEvents, squarespaceJsonToEvents,
  nycParksRssToEvents, resistorRssToEvents, eventbriteOrganizerToEvents,
};
