'use strict';

// Build an email-safe HTML version of the digest: a flat, inline-styled list
// (no JavaScript, minimal CSS) that renders in mail clients like Gmail, plus a
// prominent link to the interactive dashboard. The live page stays as-is.

const DASHBOARD_URL = 'https://events-digest.vercel.app';
const ORDER = ['thisWeek', 'thisWeekend', 'nextWeek', 'nextWeekend', 'later'];
const BUCKET_LABELS = {
  thisWeek: 'This Week', thisWeekend: 'This Weekend',
  nextWeek: 'Next Week', nextWeekend: 'Next Weekend', later: 'Later',
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

function fmtDate(e) {
  const iso = e.dateISO || e.date;
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) return '';
  return DAYS[d.getDay()] + ' ' + MONS[d.getMonth()] + ' ' + d.getDate();
}

function countAll(data) {
  return ORDER.reduce((n, k) => n + ((data[k] || []).length), 0);
}

function emailSubject(data) {
  const wk = (data.meta && data.meta.title)
    ? data.meta.title
    : ('Week of ' + String(data.generated || '').slice(0, 10));
  return 'NYC Events Digest — ' + wk + ' (' + countAll(data) + ' events)';
}

function eventRow(e) {
  const meta = [fmtDate(e), e.time, e.venue, e.neighborhood, e.price]
    .filter(Boolean).map(esc).join(' &middot; ');
  const why = e.why
    ? '<div style="font-size:13px;color:#57534e;font-style:italic;margin-top:2px;">' + esc(e.why) + '</div>'
    : '';
  return '' +
    '<div style="padding:10px 0;border-bottom:1px solid #eeeae6;">' +
      '<a href="' + esc(hrefFor(e)) + '" style="font-weight:600;font-size:15px;color:#1c1917;text-decoration:none;">' +
        esc(e.name) + '</a>' +
      '<div style="font-size:13px;color:#78716c;margin-top:2px;">' + meta + '</div>' +
      why +
    '</div>';
}

function buildEmailHtml(data) {
  const subject = emailSubject(data);
  const button =
    '<a href="' + DASHBOARD_URL + '" style="display:inline-block;background:#1c1917;color:#ffffff;' +
    'padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">' +
    'Open the full dashboard &rarr;</a>';

  const sections = ORDER
    .filter((k) => (data[k] || []).length)
    .map((k) => {
      const rows = data[k].map(eventRow).join('');
      return '' +
        '<h2 style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;' +
        'color:#a8a29e;margin:28px 0 4px;">' + esc(BUCKET_LABELS[k]) + ' (' + data[k].length + ')</h2>' +
        rows;
    }).join('');

  return '' +
    '<!--SUBJECT:' + subject.replace(/-->/g, '') + '-->\n' +
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;' +
    'max-width:640px;margin:0 auto;padding:24px 20px;color:#1c1917;background:#ffffff;">' +
      '<h1 style="font-size:20px;font-weight:700;margin:0 0 6px;">' + esc(emailTitle(data)) + '</h1>' +
      '<p style="font-size:13px;color:#78716c;margin:0 0 16px;">' + countAll(data) + ' events, uncurated &mdash; scan and pick your own.</p>' +
      button +
      sections +
      '<p style="margin-top:32px;font-size:12px;color:#a8a29e;">' +
        'Generated automatically. <a href="' + DASHBOARD_URL + '" style="color:#a8a29e;">View the live dashboard</a>.' +
      '</p>' +
    '</div>';
}

function emailTitle(data) {
  return (data.meta && data.meta.title) ? data.meta.title : ('Week of ' + String(data.generated || '').slice(0, 10));
}

module.exports = { buildEmailHtml, emailSubject, DASHBOARD_URL };
