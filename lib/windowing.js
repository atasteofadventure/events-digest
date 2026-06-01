'use strict';

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Returns one of: 'thisWeek' | 'thisWeekend' | 'nextWeek' | 'nextWeekend' | 'later' | 'past'
// 'past' (also unparseable dates) is dropped by the build; 'later' (anything beyond
// next weekend) is kept in its own section so nothing upcoming is hidden.
function bucketFor(eventDateISO, runDateISO) {
  const ev = new Date(eventDateISO);
  const run = new Date(runDateISO);
  if (isNaN(ev)) return 'past';
  if (ev < startOfDay(run)) return 'past';

  const dow = run.getDay();                       // 0 Sun .. 6 Sat
  const mondayOffset = (dow === 0 ? -6 : 1 - dow);
  const mon = startOfDay(addDays(run, mondayOffset));        // Monday this week
  const friEve = (() => { const f = addDays(mon, 4); f.setHours(17, 0, 0, 0); return f; })();
  const sunEnd = (() => { const s = addDays(mon, 6); s.setHours(23, 59, 59, 999); return s; })();
  const monNext = addDays(mon, 7);
  const friEveNext = (() => { const f = addDays(monNext, 4); f.setHours(17, 0, 0, 0); return f; })();
  const sunEndNext = (() => { const s = addDays(monNext, 6); s.setHours(23, 59, 59, 999); return s; })();

  if (ev >= friEve && ev <= sunEnd) return 'thisWeekend';
  if (ev >= startOfDay(run) && ev < friEve) return 'thisWeek';
  if (ev >= friEveNext && ev <= sunEndNext) return 'nextWeekend';
  if (ev >= monNext && ev < friEveNext) return 'nextWeek';
  return 'later';
}

function dedupeKey(event) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const day = (event.dateISO || '').slice(0, 10);
  return `${norm(event.name)}|${day}|${norm(event.venue)}`;
}

module.exports = { bucketFor, dedupeKey, startOfDay, addDays };
