# Email Cloud Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the weekly NYC events digest entirely from the `events-digest` Gmail label via a cloud routine, bucketed into this-week / this-weekend / next-week / next-weekend, hosted on Vercel.

**Architecture:** The cloud routine (LLM) reads the labeled inbox (paginated) and extracts events to structured JSON. A deterministic Node build step buckets by event date, dedupes, suppresses already-featured events, sorts by LLM-assigned relevance, and renders a four-section HTML page. The routine publishes the HTML + updated state to the GitHub repo via the Contents API; Vercel auto-deploys and serves the page plus serverless feedback endpoints backed by Vercel KV.

**Tech Stack:** Node.js (zero-runtime-dep core; `node:test` for tests), Vercel serverless functions, `@vercel/kv`, the claude.ai Gmail connector, the RemoteTrigger routines API.

**Decisions locked (from spec review):** legacy scrape sources disabled-but-kept; 10–12 events per bucket; hide "This Weekend" on Sunday runs.

**Rev 3 (2026-05-30) — STATIC, no database.** Per spec rev 3: **Tasks 6, 7, 8 (Vercel serverless functions, `vercel.json` KV/functions, `@vercel/kv`) are CUT.** No Supabase/Neon/KV. Saves use `localStorage`; thumbs feedback deferred. Task 5 (template) is adjusted: four tabs, **save via localStorage only, remove the server feedback/saved POSTs**. `vercel.json` becomes static-only (rewrite `/` → newest digest). Task 12 keeps only the publish path (routine commits HTML → Vercel auto-deploys).

---

## File structure

| Path | Responsibility | Status |
|---|---|---|
| `lib/windowing.js` | Pure helpers: `bucketFor`, `dedupeKey` | create |
| `lib/windowing.test.js` | Tests for the above (`node --test`) | create |
| `lib/curate.js` | Pure: dedupe + window-filter + seen-suppress + rank + take top-N | create |
| `lib/curate.test.js` | Tests for curate | create |
| `bin/build-digest.js` | CLI: events.json + state.json + template → digest HTML + new state | create |
| `template.html` | Two tabs → four sections; feedback fetch() → `/api/*` | modify |
| `api/feedback.js` | Serverless: record thumbs (ported from server.js) | create |
| `api/saved-events.js` | Serverless: get/set saved events (ported from server.js) | create |
| `vercel.json` | Routing + function config | create |
| `package.json` | Add `@vercel/kv`; `type: module` decision noted below | create |
| `prompt-cloud.md` | Routine curator instructions | create |
| `config.json` | Disable `type:"scrape"` sources; add `volume_per_bucket` | modify |
| `server.js`, `run-digest.sh`, `*.plist` | Retire (leave in git history; remove from active use) | modify |

**Module format:** use **CommonJS** (`require`/`module.exports`) for `lib/*` and `bin/*` to match existing `server.js`; Vercel functions in `api/*` use ESM `export default`. Do not set `"type":"module"` globally (would break `server.js` style); instead name any ESM files `.mjs` if needed. Vercel treats `api/*.js` as ESM by its own convention, which is fine since they are standalone.

---

## Phase 0 — Prerequisites (USER, in parallel; build does not block on these except Phase 5)

- [ ] User: create Vercel account, link the `events-digest` GitHub repo (auto-deploy on push).
- [ ] User: enable Vercel KV on the project; copy the KV env vars into Vercel project env.
- [ ] User: create a fine-grained GitHub token (contents: read+write on `atasteofadventure/events-digest`); store it where the routine can use it (see Task 12).

---

## Phase 1 — Windowing helpers (TDD, buildable now)

### Task 1: `bucketFor`

**Files:**
- Create: `lib/windowing.js`
- Test: `lib/windowing.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/windowing.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { bucketFor } = require('./windowing');

// Anchor run date: Thursday 2026-06-04 10:00 ET (use ISO with no tz = local)
const THU = '2026-06-04T10:00:00';

test('weekday event later this week → thisWeek', () => {
  assert.equal(bucketFor('2026-06-04T19:00:00', THU), 'thisWeek');   // Thu eve
  assert.equal(bucketFor('2026-06-05T12:00:00', THU), 'thisWeek');   // Fri noon (before 5pm)
});

test('Fri 5pm onward through Sun → thisWeekend', () => {
  assert.equal(bucketFor('2026-06-05T19:00:00', THU), 'thisWeekend'); // Fri 7pm
  assert.equal(bucketFor('2026-06-07T15:00:00', THU), 'thisWeekend'); // Sun
});

test('following Mon–Fri → nextWeek', () => {
  assert.equal(bucketFor('2026-06-08T18:00:00', THU), 'nextWeek');    // Mon
  assert.equal(bucketFor('2026-06-12T12:00:00', THU), 'nextWeek');    // Fri noon
});

test('following Sat–Sun → nextWeekend', () => {
  assert.equal(bucketFor('2026-06-13T14:00:00', THU), 'nextWeekend'); // Sat
});

test('past event and far-future event → out', () => {
  assert.equal(bucketFor('2026-06-01T10:00:00', THU), 'out');  // last Mon
  assert.equal(bucketFor('2026-07-01T10:00:00', THU), 'out');  // weeks out
});

test('Sunday run: this weekend is the current (mostly past) Sat–Sun', () => {
  const SUN = '2026-06-07T17:00:00';
  assert.equal(bucketFor('2026-06-07T20:00:00', SUN), 'thisWeekend'); // Sun eve
  assert.equal(bucketFor('2026-06-09T19:00:00', SUN), 'nextWeek');    // Tue
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/windowing.test.js`
Expected: FAIL ("Cannot find module './windowing'" or `bucketFor is not a function`).

- [ ] **Step 3: Implement**

```js
// lib/windowing.js
'use strict';

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// Returns one of: 'thisWeek' | 'thisWeekend' | 'nextWeek' | 'nextWeekend' | 'out'
function bucketFor(eventDateISO, runDateISO) {
  const ev = new Date(eventDateISO);
  const run = new Date(runDateISO);
  if (isNaN(ev)) return 'out';
  if (ev < startOfDay(run)) return 'out';

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
  return 'out';
}

module.exports = { bucketFor, startOfDay, addDays };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/windowing.test.js`
Expected: PASS (all bucketFor tests).

- [ ] **Step 5: Commit**

```bash
git add lib/windowing.js lib/windowing.test.js
git commit -m "feat: bucketFor windowing helper with tests"
```

### Task 2: `dedupeKey`

**Files:** Modify `lib/windowing.js`; Modify `lib/windowing.test.js`

- [ ] **Step 1: Add failing tests**

```js
const { dedupeKey } = require('./windowing');

test('same event, different punctuation/case → same key', () => {
  const a = { name: 'Jazz at Bar Bayeux!', dateISO: '2026-06-05T19:00:00', venue: 'Bar Bayeux' };
  const b = { name: 'jazz at bar bayeux', dateISO: '2026-06-05T21:00:00', venue: 'BAR BAYEUX' };
  assert.equal(dedupeKey(a), dedupeKey(b));
});

test('same name/venue, different date → different key', () => {
  const a = { name: 'Tour', dateISO: '2026-06-05T19:00:00', venue: 'Green-Wood' };
  const b = { name: 'Tour', dateISO: '2026-06-12T19:00:00', venue: 'Green-Wood' };
  assert.notEqual(dedupeKey(a), dedupeKey(b));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/windowing.test.js`
Expected: FAIL (`dedupeKey is not a function`).

- [ ] **Step 3: Implement (append to `lib/windowing.js`, extend exports)**

```js
function dedupeKey(event) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const day = (event.dateISO || '').slice(0, 10);
  return `${norm(event.name)}|${day}|${norm(event.venue)}`;
}

module.exports = { bucketFor, dedupeKey, startOfDay, addDays };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/windowing.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/windowing.js lib/windowing.test.js
git commit -m "feat: dedupeKey helper with tests"
```

---

## Phase 2 — Curation (TDD, buildable now)

### Task 3: `curate(events, state, runDateISO, volumePerBucket)`

Dedupe (keep richest, merge `via`), drop `out`, suppress keys in `state.seen_events`, sort by `relevance` desc within bucket, take top N.

**Files:** Create `lib/curate.js`, `lib/curate.test.js`

- [ ] **Step 1: Write failing tests**

```js
// lib/curate.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { curate } = require('./curate');

const RUN = '2026-06-04T10:00:00';
const ev = (o) => Object.assign({ name: 'E', venue: 'V', via: ['x'], relevance: 0.5 }, o);

test('drops out-of-window and already-seen events', () => {
  const events = [
    ev({ name: 'Past', dateISO: '2026-06-01T10:00:00' }),                 // out
    ev({ name: 'Keep', dateISO: '2026-06-04T19:00:00' }),                 // thisWeek
    ev({ name: 'Seen', dateISO: '2026-06-05T12:00:00', venue: 'V2' }),    // thisWeek but seen
  ];
  const state = { seen_events: [require('./windowing').dedupeKey(events[2])] };
  const out = curate(events, state, RUN, 10);
  const names = out.thisWeek.map(e => e.name);
  assert.deepEqual(names, ['Keep']);
});

test('dedupes duplicates and merges via, keeping highest relevance', () => {
  const a = ev({ name: 'Show', dateISO: '2026-06-05T19:00:00', via: ['skint'], relevance: 0.4 });
  const b = ev({ name: 'show', dateISO: '2026-06-05T20:00:00', via: ['timeout'], relevance: 0.9 });
  const out = curate([a, b], { seen_events: [] }, RUN, 10);
  assert.equal(out.thisWeekend.length, 1);
  assert.equal(out.thisWeekend[0].relevance, 0.9);
  assert.deepEqual(out.thisWeekend[0].via.sort(), ['skint', 'timeout']);
});

test('caps each bucket at volumePerBucket, highest relevance first', () => {
  const events = Array.from({ length: 5 }, (_, i) =>
    ev({ name: 'N' + i, venue: 'V' + i, dateISO: '2026-06-04T1' + i + ':00:00', relevance: i / 10 }));
  const out = curate(events, { seen_events: [] }, RUN, 2);
  assert.equal(out.thisWeek.length, 2);
  assert.deepEqual(out.thisWeek.map(e => e.name), ['N4', 'N3']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test lib/curate.test.js`
Expected: FAIL (`Cannot find module './curate'`).

- [ ] **Step 3: Implement**

```js
// lib/curate.js
'use strict';
const { bucketFor, dedupeKey } = require('./windowing');

const BUCKETS = ['thisWeek', 'thisWeekend', 'nextWeek', 'nextWeekend'];

function curate(events, state, runDateISO, volumePerBucket) {
  const seen = new Set((state && state.seen_events) || []);
  const byKey = new Map();

  for (const e of events) {
    const bucket = bucketFor(e.dateISO, runDateISO);
    if (bucket === 'out') continue;
    const key = dedupeKey(e);
    if (seen.has(key)) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...e, _bucket: bucket, via: [...(e.via || [])] });
    } else {
      existing.via = Array.from(new Set([...(existing.via || []), ...(e.via || [])]));
      if ((e.relevance || 0) > (existing.relevance || 0)) {
        existing.relevance = e.relevance;
        existing.name = e.name; existing.url = e.url; existing.why = e.why;
      }
    }
  }

  const out = {};
  for (const b of BUCKETS) out[b] = [];
  for (const e of byKey.values()) out[e._bucket].push(e);
  for (const b of BUCKETS) {
    out[b].sort((x, y) => (y.relevance || 0) - (x.relevance || 0));
    out[b] = out[b].slice(0, volumePerBucket);
  }
  return out;
}

module.exports = { curate, BUCKETS };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test lib/curate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/curate.js lib/curate.test.js
git commit -m "feat: curate (dedupe + window + seen-suppress + rank + cap) with tests"
```

---

## Phase 3 — Build CLI + template (buildable now)

### Task 4: `bin/build-digest.js`

Reads `events.json`, `state.json`, `template.html`; writes `digests/<runDate>.html` and updated `state.json`. Hides empty buckets and (per decision) "This Weekend" when run day is Sunday.

- [ ] **Step 1: Write a fixture-based test** (`bin/build-digest.test.js`)

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildSections } = require('./build-digest');

test('renders only non-empty buckets and hides This Weekend on Sunday', () => {
  const curated = {
    thisWeek: [{ name: 'A', dateISO: '2026-06-07T19:00:00', category: 'tech_ai', via: [] }],
    thisWeekend: [{ name: 'W', dateISO: '2026-06-07T20:00:00', category: 'tours', via: [] }],
    nextWeek: [], nextWeekend: [],
  };
  const html = buildSections(curated, '2026-06-07T17:00:00'); // Sunday
  assert.match(html, /This Week/);
  assert.doesNotMatch(html, /This Weekend/);   // hidden on Sunday
  assert.doesNotMatch(html, /Next Week<\/h2>/); // empty hidden
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test bin/build-digest.test.js`
Expected: FAIL (`Cannot find module './build-digest'`).

- [ ] **Step 3: Implement** (`bin/build-digest.js`)

```js
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { curate, BUCKETS } = require('../lib/curate');
const { dedupeKey } = require('../lib/windowing');

const LABELS = { thisWeek: 'This Week', thisWeekend: 'This Weekend', nextWeek: 'Next Week', nextWeekend: 'Next Weekend' };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function buildSections(curated, runDateISO) {
  const isSunday = new Date(runDateISO).getDay() === 0;
  let html = '';
  for (const b of BUCKETS) {
    const items = curated[b] || [];
    if (items.length === 0) continue;
    if (b === 'thisWeekend' && isSunday) continue; // decision #3
    html += `<section class="bucket"><h2>${LABELS[b]}</h2>\n`;
    for (const e of items) {
      html += `  <article class="event" data-key="${esc(dedupeKey(e))}">
    <a class="name" href="${esc(e.url)}">${esc(e.name)}</a>
    <div class="meta">${esc(e.dateISO)} · ${esc(e.venue)} · ${esc(e.price || '')}</div>
    <p class="why">${esc(e.why || '')}</p>
  </article>\n`;
    }
    html += `</section>\n`;
  }
  return html;
}

function main() {
  const root = path.join(__dirname, '..');
  const runDateISO = process.env.RUN_DATE || new Date().toISOString();
  const events = JSON.parse(fs.readFileSync(path.join(root, 'events.json'), 'utf8'));
  const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  const template = fs.readFileSync(path.join(root, 'template.html'), 'utf8');

  const volume = Number(process.env.VOLUME_PER_BUCKET) || 12;
  const curated = curate(events, state, runDateISO, volume);
  const sectionsHtml = buildSections(curated, runDateISO);
  const out = template.replace('<!--SECTIONS-->', sectionsHtml);

  const day = runDateISO.slice(0, 10);
  fs.writeFileSync(path.join(root, 'digests', `${day}.html`), out);

  // update seen_events
  const newlyFeatured = BUCKETS.flatMap(b => (curated[b] || []).map(dedupeKey));
  state.seen_events = Array.from(new Set([...(state.seen_events || []), ...newlyFeatured]));
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify(state, null, 2));
}

if (require.main === module) main();
module.exports = { buildSections };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test bin/build-digest.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bin/build-digest.js bin/build-digest.test.js
git commit -m "feat: build-digest CLI renders four-section digest, updates seen state"
```

### Task 5: Four-section template

**Files:** Modify `template.html`

- [ ] **Step 1:** Read the current `template.html` to learn its structure (two tabs: Weekday/Weekend, collapsible categories, save stars, thumbs).
- [ ] **Step 2:** Replace the two-tab body markup with a single container holding the marker `<!--SECTIONS-->` (the build CLI injects the four `<section>` blocks there). Keep all existing CSS, the saved-events area, and the feedback JS.
- [ ] **Step 3:** Change every feedback/save `fetch()` URL from `http://localhost:3847/...` to relative `/api/...` (e.g., `/api/feedback`, `/api/saved-events`). Search the file for `3847` and `localhost` and replace all.
- [ ] **Step 4:** Verify locally: `RUN_DATE=2026-06-04T10:00:00 node bin/build-digest.js` against a small hand-written `events.json`, open the produced `digests/2026-06-04.html`, confirm four sections render and feedback URLs are relative.
- [ ] **Step 5: Commit**

```bash
git add template.html
git commit -m "feat: template four-section layout + relative /api feedback URLs"
```

---

## Phase 4 — Vercel feedback backend (code buildable now; deploy in Phase 5)

### Task 6: `api/saved-events.js` (port of server.js saved-events)

**Files:** Create `api/saved-events.js`

- [ ] **Step 1:** Implement (KV-backed; GET returns map, POST replaces it).

```js
// api/saved-events.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const saved = (await kv.get('saved-events')) || {};
    return res.status(200).json(saved);
  }
  if (req.method === 'POST') {
    await kv.set('saved-events', req.body || {});
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'method not allowed' });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/saved-events.js
git commit -m "feat: serverless saved-events endpoint (KV)"
```

### Task 7: `api/feedback.js` (port of server.js feedback)

**Files:** Create `api/feedback.js`

- [ ] **Step 1:** Implement (append a thumbs record; GET returns all for the routine to read).

```js
// api/feedback.js
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const all = (await kv.get('feedback')) || [];
    return res.status(200).json(all);
  }
  if (req.method === 'POST') {
    const all = (await kv.get('feedback')) || [];
    all.push({ ...req.body, ts: req.body?.ts || null });
    await kv.set('feedback', all);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'method not allowed' });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/feedback.js
git commit -m "feat: serverless feedback endpoint (KV)"
```

### Task 8: `vercel.json` + `package.json`

**Files:** Create `vercel.json`, `package.json`

- [ ] **Step 1:** `package.json`

```json
{
  "name": "events-digest",
  "private": true,
  "dependencies": { "@vercel/kv": "^1.0.0" }
}
```

- [ ] **Step 2:** `vercel.json` — serve the latest digest at `/` and keep `/digests/*` static; functions auto-detected under `api/`.

```json
{
  "cleanUrls": true,
  "rewrites": [
    { "source": "/", "destination": "/digests/index.html" }
  ]
}
```

(The routine writes `digests/index.html` as a copy of the newest digest each run, so `/` always shows the latest.)

- [ ] **Step 3: Commit**

```bash
git add vercel.json package.json
git commit -m "chore: vercel config + @vercel/kv dependency"
```

---

## Phase 5 — Routine prompt, cutover, and live verification (Phase 0 must be done)

### Task 9: `config.json` updates

**Files:** Modify `config.json`

- [ ] **Step 1:** Set `enabled: false` on every `type: "scrape"` source (keep them in the file). Add a top-level `"volume_per_bucket": 12`. Keep the 15 `type: "newsletter"` `from:` queries enabled.
- [ ] **Step 2: Commit**

```bash
git add config.json
git commit -m "chore: email-only sourcing (disable scrape sources), add volume_per_bucket"
```

### Task 10: `prompt-cloud.md` (routine curator instructions)

**Files:** Create `prompt-cloud.md`

- [ ] **Step 1:** Write the self-contained instructions. Must cover, in order:
  1. **Read email.** Using the Gmail connector, page through `label:events-digest newer_than:30d` to EXHAUSTION (follow nextPageToken; do not stop at page 1). Also run the 15 `from:` queries listed in `config.json`. Fetch full message bodies for candidate events.
  2. **Extract** each event to an object: `{name, dateISO (absolute upcoming date incl. year, resolve relative dates against today), time, venue, neighborhood, price, url, category (one of config.json categories), source, via:[newsletter], relevance (0–1 vs the taste profile in config.json + feedback), why}`. Expand recurring/multi-date listings. Drop non-NYC, undated, promos. Write the array to `events.json`.
  3. **Fold feedback:** `GET https://<vercel-domain>/api/feedback`; use thumbs to adjust `relevance` (down-rank disliked sources/categories, up-rank liked).
  4. **Build:** run `VOLUME_PER_BUCKET=12 RUN_DATE=<now ISO> node bin/build-digest.js`. This writes `digests/<day>.html` and updates `state.json`.
  5. **Publish to GitHub** via the Contents API (see Task 12 for auth): PUT `digests/<day>.html`, copy it to `digests/index.html`, and PUT the updated `state.json`. Use the existing file SHA when updating.
  6. **Report** a summary (counts per bucket, total events read, any sources that errored).
- [ ] **Step 2: Commit**

```bash
git add prompt-cloud.md
git commit -m "feat: cloud routine curator prompt"
```

### Task 11: Vercel deploy verification (after Phase 0)

- [ ] **Step 1:** Confirm Vercel built the repo; visit the deploy URL.
- [ ] **Step 2:** Hand-place a sample `digests/index.html`; confirm it serves at `/`.
- [ ] **Step 3:** `curl -X POST https://<domain>/api/feedback -d '{"event":"t","vote":"up"}' -H 'content-type: application/json'` → `{ok:true}`; then `curl https://<domain>/api/feedback` shows it. Confirms KV works.

### Task 12: Create the production routine

**Files:** none (RemoteTrigger API)

- [ ] **Step 1:** Decide token handling. Preferred: store the GitHub token as a Vercel env var and add a tiny `api/publish.js` that performs the Contents API writes server-side; the routine POSTs the rendered files to `/api/publish` with a shared secret. (Fallback: if the routines platform supports per-routine secrets, give the routine the token directly and skip `api/publish.js`.) Implement the chosen path; commit.
- [ ] **Step 2:** Create the routine via `RemoteTrigger {action:"create"}` with: the Gmail connector attached, `sources` = the `events-digest` repo, model `claude-sonnet-4-6`, `cron_expression` for Thu + Sun ET converted to UTC (two routines or one with both — note cron min interval 1h), and the message = "Read prompt-cloud.md and execute every step."
- [ ] **Step 2 (verify):** `RemoteTrigger {action:"run"}` once; open the routine link; confirm a digest is committed, Vercel redeploys, the four sections render, and bucketing looks right.
- [ ] **Step 3:** Retire local execution: note in `README`/commit that `server.js`, `run-digest.sh`, and the launchd plists are superseded (unload the launchd jobs locally).

---

## Self-review notes

- Spec coverage: reading model (Task 10 step 1, pagination), extraction (10.2), four-bucket (Task 1), dedupe/seen (Tasks 2–3), ranking/volume (Task 3 + config), template (Task 5), Vercel hosting+feedback (Tasks 6–8, 11), publish/state-in-repo (Tasks 4, 10.5, 12), schedule (Task 12). All covered.
- Type consistency: `dedupeKey`, `bucketFor`, `curate`, `buildSections` signatures consistent across tasks; event object shape (`dateISO`, `via`, `relevance`, `why`) consistent from Task 1 through Task 10.
- Open risk carried forward: GitHub-token handling resolved in Task 12 Step 1 (Vercel `api/publish.js` preferred).
```
