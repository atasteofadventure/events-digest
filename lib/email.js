'use strict';

// Build an email-safe HTML version of the digest: a flat, inline-styled list
// (no JavaScript, minimal CSS) that renders in mail clients like Gmail, plus a
// prominent link to the interactive dashboard. The live page stays as-is.
//
// Scope: only this week + this weekend (today through Sunday). Events are grouped
// by day, and within each day by category — no relevance filtering, every event
// in range is shown.

const DASHBOARD_URL = 'https://events-digest.vercel.app';

// Only these buckets go in the email. The dashboard still shows everything (incl. Later).
const INCLUDED = ['thisWeek', 'thisWeekend'];

// Mirror of the dashboard's category order + labels (template.html). Categories not
// listed here are appended after, in first-seen order, under their humanized key.
const CATEGORY_ORDER = ['tech_ai', 'music_nightlife', 'comedy', 'film_screenings', 'art_exhibitions', 'talks_lectures', 'workshops_classes', 'tours_experiences', 'festivals_parties', 'miscellaneous'];
const CATEGORY_LABELS = {
  tech_ai: 'Tech & AI',
  music_nightlife: 'Music & Nightlife',
  comedy: 'Comedy',
  film_screenings: 'Film & Screenings',
  art_exhibitions: 'Art & Exhibitions',
  talks_lectures: 'Talks & Lectures',
  workshops_classes: 'Workshops & Classes',
  tours_experiences: 'Tours & Experiences',
  festivals_parties: 'Festivals & Parties',
  miscellaneous: 'Miscellaneous',
};

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Same destination logic as the dashboard: real URL if present, else a web search.
function hrefFor(e) {
  const u = (e && e.url ? String(e.url) : '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  const q = [e && e.name, e && e.venue, 'NYC'].filter(Boolean).join(' ');
  return 'https://www.google.com/search?q=' + encodeURIComponent(q);
}

// All events in scope (this week + this weekend), flattened.
function includedEvents(data) {
  return INCLUDED.reduce((acc, k) => acc.concat(data[k] || []), []);
}

function dayKey(e) {
  return String(e.dateISO || e.date || '').slice(0, 10);   // YYYY-MM-DD, or '' if undated
}

function dayHeading(key) {
  const d = key ? new Date(key + 'T12:00:00') : null;       // noon avoids TZ off-by-one
  if (!d || isNaN(d)) return 'Date to be announced';
  return DAYS_FULL[d.getDay()] + ', ' + MONS[d.getMonth()] + ' ' + d.getDate();
}

// Order categories present in a day's events: known categories first (CATEGORY_ORDER),
// then any unknown ones in the order they appear.
function orderedCategories(events) {
  const present = [];
  const seen = {};
  for (const e of events) {
    const c = e.category || 'other';
    if (!seen[c]) { seen[c] = true; present.push(c); }
  }
  const known = CATEGORY_ORDER.filter((c) => present.includes(c));
  const extra = present.filter((c) => !CATEGORY_ORDER.includes(c));
  return known.concat(extra);
}

function categoryLabel(c) {
  return CATEGORY_LABELS[c] || c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function emailSubject(data) {
  const wk = (data.meta && data.meta.title)
    ? data.meta.title
    : ('Week of ' + String(data.generated || '').slice(0, 10));
  return 'NYC Events Digest — ' + wk + ' (' + includedEvents(data).length + ' events)';
}

function emailTitle(data) {
  return (data.meta && data.meta.title) ? data.meta.title : ('Week of ' + String(data.generated || '').slice(0, 10));
}

function eventRow(e) {
  // Date lives in the day heading now, so the row carries only time/place/price.
  const meta = [e.time, e.venue, e.neighborhood, e.price]
    .filter(Boolean).map(esc).join(' &middot; ');
  const why = e.why
    ? '<div style="font-size:13px;color:#57534e;font-style:italic;margin-top:2px;">' + esc(e.why) + '</div>'
    : '';
  return '' +
    '<div style="padding:8px 0;border-bottom:1px solid #eeeae6;">' +
      '<a href="' + esc(hrefFor(e)) + '" style="font-weight:600;font-size:15px;color:#1c1917;text-decoration:none;">' +
        esc(e.name) + '</a>' +
      (meta ? '<div style="font-size:13px;color:#78716c;margin-top:2px;">' + meta + '</div>' : '') +
      why +
    '</div>';
}

function categoryBlock(category, events) {
  const rows = events.map(eventRow).join('');
  return '' +
    '<h3 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;' +
    'color:#a8a29e;margin:16px 0 2px;">' + esc(categoryLabel(category)) + '</h3>' +
    rows;
}

function dayBlock(key, events) {
  const cats = orderedCategories(events);
  const blocks = cats.map((c) => {
    const inCat = events.filter((e) => (e.category || 'other') === c)
      .sort((a, b) => String(a.dateISO || '').localeCompare(String(b.dateISO || '')));
    return categoryBlock(c, inCat);
  }).join('');
  return '' +
    '<h2 style="font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;' +
    'color:#1c1917;border-bottom:2px solid #1c1917;padding-bottom:4px;margin:32px 0 4px;">' +
    esc(dayHeading(key)) + '</h2>' +
    blocks;
}

function buildEmailHtml(data) {
  const subject = emailSubject(data);
  const events = includedEvents(data);
  const button =
    '<a href="' + DASHBOARD_URL + '" style="display:inline-block;background:#1c1917;color:#ffffff;' +
    'padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">' +
    'Open the full dashboard &rarr;</a>';

  // Group by day, chronological. Undated events (shouldn't occur in-range) sort last.
  const byDay = {};
  for (const e of events) {
    const k = dayKey(e);
    (byDay[k] || (byDay[k] = [])).push(e);
  }
  const dayKeys = Object.keys(byDay).sort((a, b) => (a || '~').localeCompare(b || '~'));
  const sections = dayKeys.map((k) => dayBlock(k, byDay[k])).join('');

  // Source coverage line (from bin/build-digest.js sourceReport) — shows which
  // configured sources produced nothing this run, so gaps are visible.
  const rep = data.meta && data.meta.source_report;
  const coverage = rep
    ? '<p style="margin:24px 0 0;font-size:12px;color:#a8a29e;">' +
      esc(String(rep.contributing)) + ' sources contributed' +
      (rep.empty && rep.empty.length ? '; nothing from: ' + esc(rep.empty.join(', ')) : '') +
      '</p>'
    : '';

  return '' +
    '<!--SUBJECT:' + subject.replace(/-->/g, '') + '-->\n' +
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;' +
    'max-width:640px;margin:0 auto;padding:24px 20px;color:#1c1917;background:#ffffff;">' +
      '<h1 style="font-size:20px;font-weight:700;margin:0 0 6px;">' + esc(emailTitle(data)) + '</h1>' +
      '<p style="font-size:13px;color:#78716c;margin:0 0 16px;">' +
        events.length + ' events this week &amp; this weekend, by day.</p>' +
      button +
      sections +
      coverage +
      '<p style="margin-top:32px;font-size:12px;color:#a8a29e;">' +
        'Generated automatically. <a href="' + DASHBOARD_URL + '" style="color:#a8a29e;">View the live dashboard</a>.' +
      '</p>' +
    '</div>';
}

module.exports = { buildEmailHtml, emailSubject, DASHBOARD_URL };
