# Digest Coverage & Delivery Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two diagnosed problems with the NYC events digest: (1) lopsided/missing source coverage, (2) fragmented delivery (localhost + Vercel + unreliable email) — ending with ONE pipeline (the cloud routine), ONE dashboard (Vercel), and ONE reliable weekly email that links to it.

**Architecture:** The cloud routine (RemoteTrigger `trig_01Hef3r9byEvZAeMTo8rtgzD`, Thursdays 22:00 UTC) stays canonical: it reads Gmail newsletters, extracts `events.json`, runs the deterministic Node build, and pushes to `main` (→ Vercel deploy → Resend email via GitHub Action). We ADD a deterministic feed fetcher (ICS + schema.org JSON-LD, zero-dep) so venue calendars (Fort Greene Park Conservancy, BAM, etc.) contribute events without LLM scraping variance. We REMOVE the local launchd/Chrome pipeline entirely. We make the email fire on ANY `digest:` push (not just Thursday) and add a Friday watchdog that emails an alert if no digest landed.

**Tech Stack:** Node 20, zero npm dependencies (matches existing repo convention), `node --test` for tests, GitHub Actions, Resend API.

## Diagnosis summary (evidence, verified 2026-07-02)

1. **Coverage:** Cloud pipeline is email-only; 64/79 configured sources are `enabled:false` scrape sources (incl. Fort Greene Park Conservancy) that can never appear. Of the 15 enabled newsletters, 8 never arrive in Gmail at all (verified by direct Gmail search, 30-day window): NY Adventure Club, Brooklyn Public Library, Nonsense NYC, BKReader, Built In NYC, Patch ×3. Effective pool ≈ 7 newsletters → live Vercel data: 142 events, 61 from The Skint alone.
2. **Fragmentation:** A second, local launchd pipeline (Chrome-scrape via `claude -p`) pops the localhost:3847 dashboard. Its output is a coin flip (Jun 21: 172 events / Jun 25: 0 / Jul 2: 40) — LLM improvisation, Chrome-must-be-open dependency, skip-if-exists guard.
3. **Email:** `email.yml` runs succeed whenever triggered; failures are upstream (routine dying before push — Jun 25 fan-out bug, patched Jun 27, verification = tonight's run) plus a Thursday-only send guard that silently skips recovery runs, and no alerting when a run fails.
4. **Email content is fine as-is** — `lib/email.js` already renders the week's events with a prominent "Open the full dashboard →" button to https://events-digest.vercel.app. Do NOT redesign it.

## Global Constraints

- **Do not push anything to `main` before the Thu 2026-07-02 22:01 UTC routine run completes** — that run verifies the Jun 27 fan-out fix and must be observed unpolluted. Work on a branch; merge after.
- Zero npm dependencies. Node 20 built-ins only (`fetch`, `node:test`, `fs`, `child_process`).
- TDD: failing test → minimal code → pass → commit. Full suite: `node --test lib/*.test.js bin/*.test.js` (34 passing today; must stay green).
- **No curation** ([[feedback-digest-curation]]): every valid deduped event is shown. Validity-only filtering (has date, in NYC, not sold out, is a real event). Never rank, cap, or suppress.
- The email keeps its current format (full this-week+weekend listing + dashboard button). Only delivery mechanics change.
- Resend free tier: only delivers to sarah.fellay@gmail.com from onboarding@resend.dev. Secrets `RESEND_API_KEY`, `EMAIL_TO` already set in GitHub.
- The cloud routine reads `prompt-cloud.md` from the repo — updating that file updates the routine. Its `allowed_tools` must NOT be widened (Task was removed deliberately on 2026-06-27).
- Only Sarah can subscribe to newsletters. New subscriptions use the alias **sarah.fellay+nycevents@gmail.com** (an existing Gmail filter auto-labels alias mail into `events-digest`, which the routine reads).

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/feeds.js` + `lib/feeds.test.js` | Create | Parse ICS and schema.org JSON-LD into digest event objects |
| `bin/fetch-feeds.js` + `bin/fetch-feeds.test.js` | Create | Fetch all `type:"feed"` sources, write `feed-events.json`, never crash the run |
| `bin/build-digest.js` + `bin/build-digest.test.js` | Modify | Merge `feed-events.json` into the build; emit per-source coverage report |
| `lib/email.js` + `lib/email.test.js` | Modify (small) | One footer line: sources contributed / empty |
| `config.json` | Modify | Add `type:"feed"` sources; quarantine dead newsletter queries |
| `prompt-cloud.md` | Modify | Add "run fetch-feeds" step; commit feed-events.json |
| `.github/workflows/email.yml` | Modify | Send on any `digest:` push (drop Thursday-only guard) |
| `bin/watchdog.js` + `bin/watchdog.test.js`, `.github/workflows/watchdog.yml` | Create | Friday dead-man switch: alert email if no fresh digest |
| `docs/sources-audit.md`, `docs/SUBSCRIBE-CHECKLIST.md` | Create | Per-source feed/newsletter audit; Sarah's subscribe list |
| local pipeline files (see Task 2) | Delete | Decommission localhost pipeline |

---

### Task 1: Sync the local clone with origin

The local clone is 5 commits behind `origin/main` (at `dab5c69`; origin at `2dba128`) with stale working-tree modifications from the now-dead local-pipeline era. The cloud runs from origin, so origin is truth.

**Files:** none created; repo state only.

- [ ] **Step 1: Confirm no unpushed local commits**

```bash
cd ~/events-digest
git fetch origin
git log origin/main..HEAD --oneline
```
Expected: empty output (local `dab5c69` is an ancestor of origin). If NOT empty, stop and surface to Sarah.

- [ ] **Step 2: Review then discard stale working-tree modifications**

```bash
git diff --stat   # expect: config.json, lib/email.js, prompt-cloud.md, prompt.md, run-digest.sh, state.json, template.html
git diff origin/main -- config.json
```
The only local `config.json` delta vs origin is a `miscellaneous` entry in the `categories` display map. Check whether origin already has it:
```bash
git show origin/main:config.json | grep -A3 '"miscellaneous"'
```
If origin LACKS the `categories.miscellaneous` entry (label "Miscellaneous", color `#64748b`), save it aside to re-apply in Task 7. Everything else is superseded (origin's `2dba128` is the newer email.js/template) or belongs to the local pipeline being deleted.

```bash
git checkout -- .
git pull --ff-only origin main
git log --oneline -3   # expect 2dba128 at HEAD
```

- [ ] **Step 3: Verify test suite is green at origin state**

```bash
node --test lib/*.test.js bin/*.test.js
```
Expected: all pass (34 today).

- [ ] **Step 4: Create the working branch**

```bash
git checkout -b fix/coverage-and-delivery
```

---

### Task 2: Decommission the local pipeline

Sarah approved full removal. This kills the localhost:3847 popup and the second data source.

**Files:**
- Delete (launchd): `~/Library/LaunchAgents/com.events-digest.runner.plist`, `~/Library/LaunchAgents/com.events-digest.server.plist`
- Delete (tracked): `server.js`, `run-digest.sh`, `run.sh`, `prompt.md`, `com.events-digest.runner.plist`, `com.events-digest.server.plist`, `test-server.sh`, `test-persistence.sh`
- Delete (untracked local cruft): `build_digest.py`, `build_digest_0618.py`, `build_digest_0621.py`, `build_digest_0625.py`, `build_digest_0702.py`, `update_state.py`, `update_state_0618.py`, `update_state_0702.py`, `state.json.bak-0618`

- [ ] **Step 1: Unload and remove the launchd jobs**

```bash
launchctl bootout gui/$(id -u)/com.events-digest.runner 2>/dev/null || true
launchctl bootout gui/$(id -u)/com.events-digest.server 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.events-digest.runner.plist ~/Library/LaunchAgents/com.events-digest.server.plist
```

- [ ] **Step 2: Verify nothing is scheduled or listening**

```bash
launchctl list | grep events-digest; lsof -i :3847
```
Expected: both empty. If a server process is still on :3847, `kill` it and re-check.

- [ ] **Step 3: Remove the files from the repo**

```bash
cd ~/events-digest
git rm server.js run-digest.sh run.sh prompt.md com.events-digest.runner.plist com.events-digest.server.plist test-server.sh test-persistence.sh
rm -f build_digest*.py update_state*.py state.json.bak-0618
```

- [ ] **Step 4: Run tests (nothing in lib/ or bin/ referenced those files)**

```bash
node --test lib/*.test.js bin/*.test.js
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: decommission local launchd/Chrome pipeline — cloud routine is the only pipeline"
```

---

### Task 3: Source audit + subscription checklist (research, no code)

> **✅ DONE 2026-07-02 (inline, ahead of plan execution).** Deliverables exist:
> `docs/sources-audit.md` (full classification: 8 ready feeds, 4 RSS-tier, ~35 newsletter-only,
> 10 drop/redundant) and `docs/SUBSCRIBE-CHECKLIST.md` (tiered). Committed on
> `fix/coverage-and-delivery`. **Task 7 must use the audit's section-1 table verbatim** as the
> feed entries. **Task 4/5 amendment:** the audit found RSS routes worth supporting — add
> `format:"rss"` to the fetcher for NYC Parks (`events_300_rss.xml`, 1,565 items — REQUIRES a
> filter, e.g. Brooklyn parks only, decide with Sarah) and NYC Resistor (event date parsed from
> item titles like "Jul 05 2026 : ..."). Skip Secret Science Club / City Reliquary RSS (dates in
> prose — not deterministic). The remainder of this task's steps are kept for reference only.

Decide, per missing source, HOW it re-enters the digest: structured feed, newsletter subscription, or drop.

**Files:**
- Create: `docs/sources-audit.md`
- Create: `docs/SUBSCRIBE-CHECKLIST.md`

**Inputs:** the 64 `enabled:false` scrape sources in `config.json` + the 8 dead newsletter queries (NY Adventure Club, Brooklyn Public Library, Nonsense NYC, BKReader, Built In NYC, Patch Fort Greene, Patch Bed-Stuy, Patch BK Heights-DUMBO).

**Priority tier 1** (Sarah-named or proven event producers in past runs — audit these first): Fort Greene Park Conservancy, Green-Wood Cemetery, BAM, Nitehawk Cinema, Brooklyn Museum, Prospect Park Conservancy, Brooklyn Botanic Garden, Pioneer Works, Rooftop Films, Club Free Time, NYC Parks Movies, Greenlight Bookstore, Books Are Magic, NYC Resistor, Secret Science Club, Atlas Obscura NYC, Turnstile Tours, Brooklyn Grange, Gowanus Dredgers, NY Mycological Society, Explorers Club, Movies With A View.

**Already verified live (2026-07-02) — start the audit table with these:**

| Source | Tier | Method | Feed URL | Notes |
|---|---|---|---|---|
| Green-Wood Cemetery | 1 | ics | `https://www.green-wood.com/calendar/?ical=1` | WP "The Events Calendar" plugin; 30 VEVENTs verified |
| Fort Greene Park Conservancy | 1 | squarespace-json | `https://fortgreenepark.org/calendar?format=json` | 53 upcoming items verified incl. fitness classes; per-event `?format=ical` also exists but collection-level ical returns HTML |
| NYC Resistor | 1 | jsonld | Eventbrite event pages linked from `https://www.nycresistor.com/` | all events sold via Eventbrite; alternatively audit their Eventbrite organizer page |
| Brooklyn Museum | 1 | none-found | — | calendar is JS-rendered, no ICS/JSON-LD in raw HTML; fallback = newsletter subscription |

Any WordPress venue site showing `tribe-events` markup supports `?ical=1` on its calendar URL; any Squarespace site supports `?format=json` on the events collection. Check those two patterns first — they cover a large share of small venues.

- [ ] **Step 1: For each source, check for a structured feed, in this order**

1. **ICS**: look for "Add to calendar", "Subscribe", Google Calendar embeds (`calendar.google.com/calendar/ical/...ics`), Squarespace (`?format=ical`), Tockify, The Events Calendar (WordPress: `/events/?ical=1`).
2. **schema.org JSON-LD**: fetch the events page HTML (plain `curl -sL`) and grep for `application/ld+json` containing `"@type":"Event"` (or `"Event"` in a list). Eventbrite organizer pages, Dice, Squarespace, and most modern venue sites have this.
3. **Newsletter**: a signup form on the site.
4. None of the above → mark `drop-or-manual`.

Record a table row per source in `docs/sources-audit.md`:

```markdown
| Source | Tier | Method | Feed URL / signup URL | Notes |
|---|---|---|---|---|
| Fort Greene Park Conservancy | 1 | ics | https://... | Google Calendar embed on /events |
```

- [ ] **Step 2: Write `docs/SUBSCRIBE-CHECKLIST.md` for Sarah**

For every source whose method is `newsletter` (including the 8 dead queries — verify each actually offers a newsletter): one checkbox line with the signup URL and the standing instruction:

```markdown
# Subscribe checklist (use sarah.fellay+nycevents@gmail.com — auto-labels into events-digest)
- [ ] NY Adventure Club — https://www.nyadventureclub.com/ (footer signup)
...
```

- [ ] **Step 3: Commit**

```bash
git add docs/sources-audit.md docs/SUBSCRIBE-CHECKLIST.md
git commit -m "docs: source audit — feed/newsletter/drop decision per missing source"
```

**Produces:** the authoritative list of `type:"feed"` entries Task 7 adds to `config.json`, and the checklist Sarah works through once.

---

### Task 4: `lib/feeds.js` — ICS and JSON-LD parsing

Pure parsing, no network. Normalizes into the exact event shape `bin/build-digest.js` / `lib/curate.js` consume: `{id, name, dateISO, time, venue, neighborhood, price, url, category, source, via, why}`.

**Files:**
- Create: `lib/feeds.js`
- Test: `lib/feeds.test.js`

**Interfaces:**
- Produces: `parseICS(text) -> vevent[]`, `icsToEvents(text, {sourceName}) -> event[]`, `jsonLdToEvents(html, {sourceName}) -> event[]`, `squarespaceJsonToEvents(json, {sourceName}) -> event[]` — consumed by Task 5.
- `squarespaceJsonToEvents` handles Squarespace collection JSON (`<calendar-url>?format=json`): items live in `json.upcoming` (fallback `json.items`), each with `title`, `startDate` (epoch ms), `fullUrl` (site-relative — prefix the origin), `location.addressTitle`, `excerpt` (HTML — strip tags for `why`). Add a test mirroring the ICS one using a two-item fixture (one with location, one without), asserting name/dateISO/url/venue. Verified live against fortgreenepark.org 2026-07-02 (53 items).
- `bin/fetch-feeds.js` (Task 5) accordingly accepts `format: 'ics' | 'jsonld' | 'squarespace-json'` and needs the source's site origin to absolutize `fullUrl` (derive from `feed_url`).
- Events carry `category: 'miscellaneous'` (feeds don't classify; no-curation means never drop for lack of category), `via: ['feed: <sourceName>']`, stable `id` = `feed-<slug(source)>-<yyyy-mm-dd>-<slug(name)>`.

- [ ] **Step 1: Write the failing tests**

```js
// lib/feeds.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseICS, icsToEvents, jsonLdToEvents } = require('./feeds');

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'SUMMARY:Yoga in the Park',
  'DTSTART;TZID=America/New_York:20260711T100000',
  'LOCATION:Fort Greene Park\\, Brooklyn',
  'URL:https://fortgreenepark.org/events/yoga',
  'DESCRIPTION:Free outdoor vinyasa. All levels',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:All-Day Festival',
  'DTSTART;VALUE=DATE:20260712',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseICS extracts VEVENT fields incl. folded lines and params', () => {
  const evts = parseICS(ICS);
  assert.equal(evts.length, 2);
  assert.equal(evts[0].summary, 'Yoga in the Park');
  assert.equal(evts[0].location, 'Fort Greene Park, Brooklyn');
});

test('icsToEvents normalizes to digest event shape', () => {
  const [e, allDay] = icsToEvents(ICS, { sourceName: 'Fort Greene Park Conservancy' });
  assert.equal(e.name, 'Yoga in the Park');
  assert.equal(e.dateISO, '2026-07-11T10:00:00');
  assert.equal(e.time, '10:00 AM');
  assert.equal(e.venue, 'Fort Greene Park, Brooklyn');
  assert.equal(e.url, 'https://fortgreenepark.org/events/yoga');
  assert.equal(e.category, 'miscellaneous');
  assert.deepEqual(e.via, ['feed: Fort Greene Park Conservancy']);
  assert.match(e.id, /^feed-fort-greene-park-conservancy-2026-07-11-/);
  assert.equal(allDay.dateISO, '2026-07-12T00:00:00'); // all-day: midnight, time ''
  assert.equal(allDay.time, '');
});

test('jsonLdToEvents pulls schema.org Events out of HTML', () => {
  const html = '<html><script type="application/ld+json">' + JSON.stringify([{
    '@type': 'Event', name: 'Rooftop Screening',
    startDate: '2026-07-15T20:30:00-04:00',
    location: { '@type': 'Place', name: 'Industry City' },
    offers: { price: '15', priceCurrency: 'USD' },
    url: 'https://example.com/rooftop', description: 'Outdoor movie night.',
  }]) + '</script></html>';
  const [e] = jsonLdToEvents(html, { sourceName: 'Rooftop Films' });
  assert.equal(e.name, 'Rooftop Screening');
  assert.equal(e.dateISO.slice(0, 10), '2026-07-15');
  assert.equal(e.venue, 'Industry City');
  assert.equal(e.price, '$15');
  assert.equal(e.url, 'https://example.com/rooftop');
});

test('jsonLdToEvents survives malformed JSON blocks and @graph nesting', () => {
  const html = '<script type="application/ld+json">{broken</script>'
    + '<script type="application/ld+json">' + JSON.stringify({
        '@graph': [{ '@type': 'Event', name: 'G', startDate: '2026-08-01' }] }) + '</script>';
  const evts = jsonLdToEvents(html, { sourceName: 'X' });
  assert.equal(evts.length, 1);
  assert.equal(evts[0].name, 'G');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test lib/feeds.test.js`
Expected: FAIL — `Cannot find module './feeds'`

- [ ] **Step 3: Implement `lib/feeds.js`**

```js
'use strict';
// Deterministic feed parsing: ICS calendars and schema.org JSON-LD event markup.
// Feeds don't classify events, and no-curation means nothing is dropped for
// lack of a category — everything lands in 'miscellaneous'.

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// RFC 5545: long lines fold with CRLF + space/tab; unfold before parsing.
function parseICS(text) {
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

// 20260711T100000[Z] or 20260712 (all-day) -> local-naive ISO (matches events.json style)
function icsDateToISO(dt) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/.exec(String(dt || ''));
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  return `${y}-${mo}-${d}T${hh || '00'}:${mm || '00'}:${ss || '00'}`;
}

function timeLabel(iso, isAllDay) {
  if (isAllDay) return '';
  const h = Number(iso.slice(11, 13)), m = iso.slice(14, 16);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

function makeEvent({ sourceName, name, dateISO, time, venue, price, url, why }) {
  return {
    id: `feed-${slug(sourceName)}-${dateISO.slice(0, 10)}-${slug(name).slice(0, 40)}`,
    name, dateISO, time: time || '', venue: venue || sourceName,
    neighborhood: '', price: price || '',
    url: url || '', category: 'miscellaneous',
    source: sourceName, via: [`feed: ${sourceName}`],
    why: (why || '').slice(0, 200),
  };
}

function icsToEvents(text, { sourceName }) {
  return parseICS(text)
    .filter((v) => v.summary && v.dtstart)
    .map((v) => {
      const dateISO = icsDateToISO(v.dtstart);
      if (!dateISO) return null;
      const isAllDay = !/T/.test(v.dtstart);
      return makeEvent({
        sourceName, name: v.summary, dateISO,
        time: timeLabel(dateISO, isAllDay),
        venue: v.location, url: v.url, why: v.description,
      });
    })
    .filter(Boolean);
}

function collectLdEvents(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => collectLdEvents(n, out)); return; }
  const t = node['@type'];
  const isEvent = t === 'Event' || (Array.isArray(t) && t.includes('Event')) ||
    (typeof t === 'string' && /Event$/.test(t)); // MusicEvent, TheaterEvent, ...
  if (isEvent && node.name && node.startDate) out.push(node);
  if (node['@graph']) collectLdEvents(node['@graph'], out);
}

function jsonLdToEvents(html, { sourceName }) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    collectLdEvents(data, out);
  }
  return out.map((n) => {
    const dateISO = String(n.startDate).replace(/([+-]\d{2}:\d{2}|Z)$/, '');
    const full = /T\d{2}/.test(dateISO) ? dateISO : dateISO.slice(0, 10) + 'T00:00:00';
    const offers = Array.isArray(n.offers) ? n.offers[0] : n.offers;
    const price = offers && offers.price != null && offers.price !== ''
      ? (Number(offers.price) === 0 ? 'Free' : `$${offers.price}`) : '';
    const loc = n.location && (n.location.name ||
      (n.location.address && (n.location.address.streetAddress || n.location.address)));
    return makeEvent({
      sourceName, name: n.name, dateISO: full,
      time: timeLabel(full, !/T\d{2}/.test(dateISO)),
      venue: typeof loc === 'string' ? loc : '',
      price, url: n.url, why: n.description,
    });
  });
}

module.exports = { parseICS, icsToEvents, jsonLdToEvents };
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test lib/feeds.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/feeds.js lib/feeds.test.js
git commit -m "feat: deterministic feed parsing — ICS + schema.org JSON-LD to digest events"
```

---

### Task 5: `bin/fetch-feeds.js` — fetch all feed sources, write `feed-events.json`

Network CLI around Task 4's parsers. A failing feed must NEVER kill the digest run — errors are captured per source and reported.

**Files:**
- Create: `bin/fetch-feeds.js`
- Test: `bin/fetch-feeds.test.js`

**Interfaces:**
- Consumes: `icsToEvents`/`jsonLdToEvents` from `lib/feeds.js`; `config.json` sources with `{type:'feed', name, feed_url, format:'ics'|'jsonld', enabled:true}`.
- Produces: `feed-events.json` at repo root: `{generated, events: [...], errors: [{source, error}]}` — consumed by Task 6. Exports `fetchFeeds(sources, fetchImpl)` for tests.

- [ ] **Step 1: Write the failing tests**

```js
// bin/fetch-feeds.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fetchFeeds } = require('./fetch-feeds');

const ICS = 'BEGIN:VEVENT\r\nSUMMARY:A\r\nDTSTART:20260711T100000\r\nEND:VEVENT';
const fakeFetch = (behavior) => async (url) => {
  const b = behavior[url];
  if (b instanceof Error) throw b;
  const status = b.status || 200;
  return { ok: status === 200, status, text: async () => b.body || '' };
};

test('fetchFeeds parses each enabled feed by format and aggregates events', async () => {
  const sources = [
    { type: 'feed', name: 'Park', feed_url: 'https://p/cal.ics', format: 'ics', enabled: true },
    { type: 'feed', name: 'Off', feed_url: 'https://x', format: 'ics', enabled: false },
    { type: 'newsletter', name: 'Skint' },
  ];
  const { events, errors } = await fetchFeeds(sources, fakeFetch({ 'https://p/cal.ics': { body: ICS } }));
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'Park');
  assert.equal(errors.length, 0);
});

test('a failing feed is recorded as an error, not thrown', async () => {
  const sources = [
    { type: 'feed', name: 'Bad', feed_url: 'https://bad', format: 'ics', enabled: true },
    { type: 'feed', name: 'Good', feed_url: 'https://good', format: 'ics', enabled: true },
  ];
  const { events, errors } = await fetchFeeds(sources, fakeFetch({
    'https://bad': new Error('ECONNRESET'),
    'https://good': { body: ICS },
  }));
  assert.equal(events.length, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].source, 'Bad');
});

test('non-200 responses are errors too', async () => {
  const { errors } = await fetchFeeds(
    [{ type: 'feed', name: 'Blocked', feed_url: 'https://403', format: 'jsonld', enabled: true }],
    fakeFetch({ 'https://403': { status: 403 } })
  );
  assert.match(errors[0].error, /403/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test bin/fetch-feeds.test.js`
Expected: FAIL — `Cannot find module './fetch-feeds'`

- [ ] **Step 3: Implement `bin/fetch-feeds.js`**

```js
#!/usr/bin/env node
'use strict';
// Fetch every enabled type:"feed" source in config.json and write the parsed
// events to feed-events.json. A broken feed never fails the run — it is
// recorded in .errors and reported by the build/routine summary.
const fs = require('fs');
const path = require('path');
const { icsToEvents, jsonLdToEvents } = require('../lib/feeds');

const TIMEOUT_MS = 20000;
const UA = 'Mozilla/5.0 (compatible; events-digest/1.0; +https://events-digest.vercel.app)';

async function fetchOne(src, fetchImpl) {
  const res = await fetchImpl(src.feed_url, {
    headers: { 'User-Agent': UA, Accept: 'text/calendar, text/html;q=0.9, */*;q=0.5' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  const opts = { sourceName: src.name };
  return src.format === 'jsonld' ? jsonLdToEvents(body, opts) : icsToEvents(body, opts);
}

async function fetchFeeds(sources, fetchImpl) {
  const feeds = (sources || []).filter((s) => s.type === 'feed' && s.enabled !== false);
  const events = [];
  const errors = [];
  for (const src of feeds) {
    try {
      const evts = await fetchOne(src, fetchImpl);
      events.push(...evts);
      console.log(`feed ok   ${src.name}: ${evts.length} events`);
    } catch (e) {
      errors.push({ source: src.name, error: String((e && e.message) || e) });
      console.log(`feed FAIL ${src.name}: ${String((e && e.message) || e)}`);
    }
  }
  return { events, errors };
}

async function main() {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const { events, errors } = await fetchFeeds(config.sources, fetch);
  const out = { generated: process.env.RUN_DATE || new Date().toISOString(), events, errors };
  fs.writeFileSync(path.join(root, 'feed-events.json'), JSON.stringify(out, null, 2));
  console.log(`Wrote feed-events.json — ${events.length} events, ${errors.length} feed errors`);
}

if (require.main === module) {
  main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}
module.exports = { fetchFeeds };
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test bin/fetch-feeds.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add bin/fetch-feeds.js bin/fetch-feeds.test.js
git commit -m "feat: fetch-feeds CLI — resilient per-source fetching to feed-events.json"
```

---

### Task 6: Merge feed events into the build + per-source coverage report

`bin/build-digest.js` currently reads only `events.json`. Merge `feed-events.json` (if present) before curation — `lib/curate.js` already dedupes across sources by name+date+venue and merges `via`, so newsletter/feed duplicates collapse. Also emit a per-source coverage report so lopsided sourcing is visible instead of silent.

**Files:**
- Modify: `bin/build-digest.js` (function `main()`, and add `sourceReport()`)
- Modify: `lib/email.js` (footer line)
- Test: `bin/build-digest.test.js`, `lib/email.test.js`

**Interfaces:**
- Produces: `digests/sources.json` = `[{source, count}]` sorted desc, plus `feedErrors` passthrough; `data.meta.source_report = {contributing: N, empty: [names...]}` available to `buildEmailHtml`.

- [ ] **Step 1: Write the failing tests** (add to existing `bin/build-digest.test.js`)

```js
const { sourceReport, mergeFeedEvents } = require('./build-digest');

test('mergeFeedEvents concatenates newsletter and feed events', () => {
  const a = [{ id: '1', name: 'A', dateISO: '2026-07-10T19:00:00', via: ['The Skint'] }];
  const feed = { events: [{ id: 'feed-x', name: 'B', dateISO: '2026-07-11T10:00:00', via: ['feed: Park'] }] };
  const merged = mergeFeedEvents(a, feed);
  assert.equal(merged.length, 2);
});

test('mergeFeedEvents tolerates missing/empty feed file content', () => {
  assert.equal(mergeFeedEvents([{ id: '1' }], null).length, 1);
  assert.equal(mergeFeedEvents([{ id: '1' }], {}).length, 1);
});

test('sourceReport counts events per via-source and lists empty configured sources', () => {
  const events = [
    { via: ['The Skint'] }, { via: ['The Skint', 'feed: Park'] }, { via: ['feed: Park'] },
  ];
  const configured = ['The Skint', 'Park', 'Nonsense NYC'];
  const rep = sourceReport(events, configured);
  assert.deepEqual(rep.counts[0], { source: 'The Skint', count: 2 });
  assert.ok(rep.empty.includes('Nonsense NYC'));
  assert.equal(rep.contributing, 2);
});
```

And in `lib/email.test.js`:

```js
test('email footer shows source coverage when meta.source_report present', () => {
  const html = buildEmailHtml({ meta: { title: 'T', source_report: { contributing: 7, empty: ['Nonsense NYC', 'BKReader'] } },
    generated: '2026-07-09T22:00:00', thisWeek: [], thisWeekend: [] });
  assert.match(html, /7 sources contributed/);
  assert.match(html, /Nonsense NYC/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test bin/build-digest.test.js lib/email.test.js`
Expected: FAIL — `mergeFeedEvents is not a function` (and the email footer assertion fails).

- [ ] **Step 3: Implement**

In `bin/build-digest.js`, add above `main()` and export both:

```js
// Feed events are fetched separately (bin/fetch-feeds.js) into feed-events.json;
// merge them with the newsletter-extracted events before curation. curate()
// dedupes name+date+venue across the merged set and unions `via`.
function mergeFeedEvents(events, feedFile) {
  const feedEvents = (feedFile && Array.isArray(feedFile.events)) ? feedFile.events : [];
  return [...(events || []), ...feedEvents];
}

// Visibility: who actually contributed this run, and which configured sources
// produced nothing (dead subscription, broken feed, quiet week).
function sourceReport(events, configuredNames) {
  const tally = new Map();
  for (const e of events || []) {
    for (const v of (Array.isArray(e.via) ? e.via : [e.source || 'unknown'])) {
      const name = String(v).replace(/^feed:\s*/, '');
      tally.set(name, (tally.get(name) || 0) + 1);
    }
  }
  const counts = [...tally.entries()].map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
  const empty = (configuredNames || []).filter((n) => !tally.has(n));
  return { counts, empty, contributing: counts.length };
}
```

In `main()`, replace the `events` read + curate lines:

```js
  const rawEvents = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'));
  const feedPath = path.join(root, 'feed-events.json');
  const feedFile = fs.existsSync(feedPath) ? JSON.parse(fs.readFileSync(feedPath, 'utf8')) : null;
  const events = mergeFeedEvents(rawEvents, feedFile);

  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const configuredNames = (config.sources || []).filter((s) => s.enabled !== false).map((s) => s.name);
  const report = sourceReport(events, configuredNames);
  if (feedFile && Array.isArray(feedFile.errors)) report.feedErrors = feedFile.errors;
```

Pass it into `buildData`'s meta (`source_report: { contributing: report.contributing, empty: report.empty }`), write it, and log it:

```js
  fs.writeFileSync(path.join(root, 'digests', 'sources.json'), JSON.stringify(report, null, 2));
  console.log(`Sources: ${report.contributing} contributed; empty: ${report.empty.join(', ') || 'none'}`);
```

Update `module.exports` to include `mergeFeedEvents, sourceReport`.

In `lib/email.js`, in the footer block (around the existing "Generated automatically" line, `lib/email.js:157` area), add before it:

```js
  const rep = data.meta && data.meta.source_report;
  const repLine = rep
    ? '<div style="font-size:12px;color:#a8a29e;margin-bottom:6px;">'
      + esc(String(rep.contributing)) + ' sources contributed'
      + (rep.empty && rep.empty.length ? '; nothing from: ' + esc(rep.empty.join(', ')) : '')
      + '</div>'
    : '';
```

and include `repLine` in the footer HTML.

- [ ] **Step 4: Run the FULL suite**

Run: `node --test lib/*.test.js bin/*.test.js`
Expected: all pass (old + new).

- [ ] **Step 5: Commit**

```bash
git add bin/build-digest.js bin/build-digest.test.js lib/email.js lib/email.test.js
git commit -m "feat: merge feed events into build + per-source coverage report (page json, email footer)"
```

---

### Task 7: `config.json` — add feed sources, quarantine dead newsletters

**Files:**
- Modify: `config.json`

- [ ] **Step 1: Add the feed sources from the Task 3 audit** (tier 1 first), each as:

```json
{ "type": "feed", "name": "Fort Greene Park Conservancy", "format": "ics",
  "feed_url": "<from audit>", "enabled": true }
```

If the old `scrape` entry for the same venue exists, leave it `enabled:false` (harmless history) — the new `feed` entry is the live one.

- [ ] **Step 2: Quarantine the 8 dead newsletter queries** — set on each (NY Adventure Club, Brooklyn Public Library, Nonsense NYC, BKReader, Built In NYC, Patch ×3):

```json
"enabled": false,
"note": "no email ever received as of 2026-07-02 — pending subscription, see docs/SUBSCRIBE-CHECKLIST.md; re-enable after subscribing"
```

- [ ] **Step 3: Re-apply the `categories.miscellaneous` display entry if Task 1 found origin lacked it** (label "Miscellaneous", color `#64748b`).

- [ ] **Step 4: Validate + smoke-test the fetcher against real feeds**

```bash
node -e "JSON.parse(require('fs').readFileSync('config.json','utf8')); console.log('valid json')"
node bin/fetch-feeds.js
node -e "const f=require('./feed-events.json'); console.log(f.events.length,'events,',f.errors.length,'errors'); f.errors.forEach(e=>console.log('ERR',e.source,e.error))"
```
Expected: valid json; a nonzero event count; investigate any erroring feed URL now (fix the URL or mark that source `enabled:false` with a note) rather than shipping a dead feed.

- [ ] **Step 5: Commit**

```bash
git add config.json
git commit -m "config: add structured feed sources (audit tier 1); quarantine 8 never-arriving newsletters"
```

---

### Task 8: `prompt-cloud.md` — routine runs the fetcher and commits its output

**Files:**
- Modify: `prompt-cloud.md`

- [ ] **Step 1: Insert a new step between "2. Extract events" and "3. Build the digest"**

```markdown
## 2.5 Fetch structured feeds (deterministic)

Run the feed fetcher — it pulls venue calendars (ICS / JSON-LD) listed as
`type:"feed"` in config.json and writes `feed-events.json`:

```bash
node bin/fetch-feeds.js
```

A failing feed never fails the run; failures are recorded in
`feed-events.json` under `errors`. Do not retry them manually and do not
scrape those websites yourself — just include the errors in your final report.
The build merges `feed-events.json` with your extracted `events.json`
automatically.
```

- [ ] **Step 2: Update step 4 (Publish) to commit the new artifacts**

```bash
git add digests/ state.json events.json feed-events.json
```

- [ ] **Step 3: Update step 5 (Report)** — add: "include the per-source coverage line the build prints (`Sources: N contributed; empty: ...`) and any feed errors."

- [ ] **Step 4: Commit**

```bash
git add prompt-cloud.md
git commit -m "routine: fetch structured feeds before build; commit feed-events.json; report coverage"
```

---

### Task 9: `email.yml` — send on any `digest:` push

Today a recovery run on Friday+ builds and deploys but silently skips the email (`DOW=4` guard). The `digest:` commit prefix is guard enough — only the routine (or a deliberate manual run) produces those.

**Files:**
- Modify: `.github/workflows/email.yml`

- [ ] **Step 1: Replace the decide step**

```yaml
      - name: Decide whether to send
        id: decide
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "send=true" >> "$GITHUB_OUTPUT"
          else
            MSG=$(git log -1 --pretty=%s)
            if printf '%s' "$MSG" | grep -q '^digest:'; then
              echo "send=true" >> "$GITHUB_OUTPUT"
            else
              echo "send=false" >> "$GITHUB_OUTPUT"
              echo "Skipping send (msg='$MSG'); only digest: pushes are emailed."
            fi
          fi
```

- [ ] **Step 2: Fix the stale header comment** (currently says "twice a week (Thu + Sun)"):

```yaml
# Sends the email-safe digest (digests/email.html) whenever a digest build is
# pushed (the cloud routine runs Thursdays; recovery runs on other days now
# email too). Trigger manually any time via the "Run workflow" button.
```

- [ ] **Step 3: Validate + commit**

```bash
ruby -ryaml -e "YAML.load_file('.github/workflows/email.yml'); puts 'valid yaml'" 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/email.yml')); print('valid yaml')"
git add .github/workflows/email.yml
git commit -m "ci: email on any digest push, not only Thursdays — recovery runs now deliver"
```

---

### Task 10: Watchdog — alert email when no digest landed

Dead-man switch: Friday 15:00 UTC (11am ET), ~17h after the Thursday run. If the newest `digest:` commit is older than 40 hours, email an alert. Closes the silent-failure hole (Jun 25: no digest, no email, no signal).

**Files:**
- Create: `bin/watchdog.js`
- Create: `.github/workflows/watchdog.yml`
- Test: `bin/watchdog.test.js`

**Interfaces:**
- Consumes: `sendEmail` from `bin/send-email.js` (already exported).
- Produces: exports `isStale(lastEpochSec, nowEpochSec, maxAgeHours)` and `alertHtml(hoursSince)`.

- [ ] **Step 1: Write the failing tests**

```js
// bin/watchdog.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isStale, alertHtml } = require('./watchdog');

test('fresh digest (17h old) is not stale at 40h threshold', () => {
  const now = 1_800_000_000;
  assert.equal(isStale(now - 17 * 3600, now, 40), false);
});

test('missing or old digest is stale', () => {
  const now = 1_800_000_000;
  assert.equal(isStale(now - 41 * 3600, now, 40), true);
  assert.equal(isStale(null, now, 40), true);
});

test('alertHtml names the routine dashboard for debugging', () => {
  const html = alertHtml(65);
  assert.match(html, /did not run/i);
  assert.match(html, /claude\.ai\/code\/routines\/trig_01Hef3r9byEvZAeMTo8rtgzD/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test bin/watchdog.test.js`
Expected: FAIL — `Cannot find module './watchdog'`

- [ ] **Step 3: Implement `bin/watchdog.js`**

```js
#!/usr/bin/env node
'use strict';
// Dead-man switch: if no `digest:` commit landed recently, email an alert.
// Runs from .github/workflows/watchdog.yml every Friday; the Thursday routine
// failing silently was the original bug (2026-06-25) this guards against.
const { execSync } = require('child_process');
const { sendEmail } = require('./send-email');

const MAX_AGE_HOURS = 40; // Thursday 22:00 UTC run -> Friday 15:00 UTC check = ~17h when healthy

function isStale(lastEpochSec, nowEpochSec, maxAgeHours) {
  if (!lastEpochSec) return true;
  return (nowEpochSec - lastEpochSec) > maxAgeHours * 3600;
}

function alertHtml(hoursSince) {
  const since = hoursSince == null ? 'never (no digest commit found)' : `${Math.round(hoursSince)}h ago`;
  return '<div style="font-family:sans-serif">'
    + '<h2>NYC Events Digest did not run this week</h2>'
    + `<p>Last <code>digest:</code> commit: ${since}. No digest email was sent.</p>`
    + '<p>Check the routine transcript: '
    + '<a href="https://claude.ai/code/routines/trig_01Hef3r9byEvZAeMTo8rtgzD">routine dashboard</a>. '
    + 'Usual suspects: GitHub push credential (re-run /web-setup), Gmail connector auth.</p>'
    + '<p><a href="https://events-digest.vercel.app">Current (stale) dashboard</a></p></div>';
}

function lastDigestEpoch() {
  try {
    const out = execSync('git log -1 --format=%ct --grep="^digest:" --', { encoding: 'utf8' }).trim();
    return out ? Number(out) : null;
  } catch { return null; }
}

async function main() {
  const last = lastDigestEpoch();
  const now = Math.floor(Date.now() / 1000);
  if (!isStale(last, now, MAX_AGE_HOURS)) {
    console.log('Digest is fresh; no alert.');
    return;
  }
  const hours = last ? (now - last) / 3600 : null;
  if (process.env.DRY_RUN) { console.log('[dry-run] would alert; hours since:', hours); return; }
  await sendEmail({
    apiKey: process.env.RESEND_API_KEY,
    to: process.env.EMAIL_TO,
    from: process.env.EMAIL_FROM || 'NYC Events Digest <onboarding@resend.dev>',
    subject: '⚠️ NYC Events Digest did not run this week',
    html: alertHtml(hours),
  });
  console.log('Alert sent.');
}

if (require.main === module) {
  main().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}
module.exports = { isStale, alertHtml, MAX_AGE_HOURS };
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test bin/watchdog.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Create `.github/workflows/watchdog.yml`**

```yaml
name: Digest watchdog

# Friday 15:00 UTC (~11am ET), ~17h after the Thursday 22:00 UTC routine run.
# Emails an alert if no `digest:` commit landed in the last 40 hours.
on:
  schedule:
    - cron: '0 15 * * 5'
  workflow_dispatch: {}

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # full history — the check greps commit log
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Alert if digest is stale
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          EMAIL_TO: ${{ secrets.EMAIL_TO }}
          EMAIL_FROM: ${{ secrets.EMAIL_FROM }}
        run: node bin/watchdog.js
```

- [ ] **Step 6: Dry-run locally + commit**

```bash
DRY_RUN=1 node bin/watchdog.js   # expect "Digest is fresh" or "[dry-run] would alert" depending on repo state
git add bin/watchdog.js bin/watchdog.test.js .github/workflows/watchdog.yml
git commit -m "feat: Friday watchdog — alert email when the weekly digest did not land"
```

---

### Task 11 (OPTIONAL — confirm with Sarah first): non-empty send guard

Sarah declined this on 2026-06-01 ("leave as is"). Re-offer it now that reliability is the complaint: if a run extracts almost nothing (broken Gmail read), today it emails a blank digest. If she declines again, skip this task; the watchdog (Task 10) already covers total failure.

If approved: `lib/email.js` embeds `<!--COUNT:N-->` after the existing `<!--SUBJECT:...-->` comment (N = thisWeek+thisWeekend length); `bin/send-email.js` `main()` parses it and, when `N < 3`, skips the normal send and instead sends "⚠️ digest looks empty (N events) — check the routine" using the same `sendEmail`. TDD both: `extractCount` unit tests mirroring `extractSubject`'s, plus a DRY_RUN path assertion.

---

### Task 12: Merge and verify end-to-end

- [ ] **Step 1: Preconditions** — confirm tonight's scheduled run (Thu 2026-07-02 22:01 UTC) completed: `git fetch && git log origin/main --oneline -3` shows a `digest: 2026-07-02` commit, the email arrived, and Vercel updated. (That run verifies the Jun 27 fan-out fix, independent of this plan. If it FAILED, get the run transcript from https://claude.ai/code/routines/trig_01Hef3r9byEvZAeMTo8rtgzD before merging anything — do not stack changes on an undiagnosed failure.)

- [ ] **Step 2: Merge**

```bash
git checkout main && git pull --ff-only origin main
git merge --no-ff fix/coverage-and-delivery -m "merge: coverage (feeds) + delivery (any-day email, watchdog, local pipeline removed)"
node --test lib/*.test.js bin/*.test.js   # full suite green
git push origin main
```
Note: this push touches `digests/email.html`? No — merge commits here don't rebuild digests, and the commit message doesn't start with `digest:`, so no email fires. Vercel redeploys (content unchanged).

- [ ] **Step 3: Trigger a manual routine run** (routine dashboard "Run now", or ask Sarah). After it completes:

```bash
git fetch origin
git log origin/main -1 --oneline                     # digest: commit
git show origin/main:digests/sources.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log('contributing:',r.contributing);console.log(r.counts.slice(0,15));console.log('empty:',r.empty)})"
```
Expected: `contributing` well above the old ~7; feed sources (e.g. Fort Greene Park Conservancy) present in `counts`; `empty` lists only quarantined/quiet sources.

- [ ] **Step 4: Verify delivery surface**
  - https://events-digest.vercel.app shows the new run, with feed-sourced events visible.
  - The digest email arrived (any day — this manual run proves the Task 9 guard change), with the dashboard button and the new "N sources contributed" footer line.
  - `gh run list --workflow=email.yml --limit 3` shows the send succeeded.
  - `gh workflow run watchdog.yml && sleep 60 && gh run list --workflow=watchdog.yml --limit 1` — expect success with "Digest is fresh; no alert."

- [ ] **Step 5: Hand Sarah `docs/SUBSCRIBE-CHECKLIST.md`** — the newsletters only she can subscribe to (with the +nycevents alias). After she subscribes, re-enable those sources in `config.json` (flip `enabled:true`, drop the `note`) in a follow-up commit.

---

## Out of scope (deliberately)

- Email content/format redesign — already has the dashboard link; Sarah confirmed keep as-is.
- Taste/feedback learning, curation of any kind — standing no-curation rule.
- Verified Resend domain — free-tier delivery to sarah.fellay@gmail.com works; revisit only if spam problems appear.
- Re-adding LLM website scraping — rejected in favor of deterministic feeds.
