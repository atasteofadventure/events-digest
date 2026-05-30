# Email Sourcing + Four-Bucket Windowing + Cloud Routine + Vercel — Design Spec

- **Date:** 2026-05-30 (rev 3 — static, no database)
- **Project:** NYC Events Digest
- **Status:** Draft for review. Connector viability VERIFIED (see below).

## Rev 3 — Static, no database (supersedes the Vercel-KV / serverless / feedback sections below)

Decision (2026-05-30): drop Supabase / any database and the serverless feedback
backend. The digest is a **static page**. User confirmed single-browser use.

- **Saves:** `localStorage` only (per-browser; no cross-device sync, accepted).
- **Feedback/taste-learning loop:** deferred. Ranking still uses the taste
  profile in `config.json`; it just no longer auto-tunes from thumbs. Thumbs UI
  either removed or made a localStorage-only no-op for now.
- **Dropped from this spec/plan:** Vercel KV, Supabase/Neon, `api/feedback.js`,
  `api/saved-events.js`, `@vercel/kv`, the "routine reads feedback" step, and the
  storage-provider decision. (Supabase/Neon/Vercel remain *linked* providers in
  the Stripe project; we simply add no DB service.)
- **Remaining architecture:** cloud routine → read Gmail label (paginated) →
  build four-bucket HTML → publish to the repo → Vercel serves the static page.
  The only write credential is the publish path (routine → repo → Vercel
  auto-deploy), managed via the Stripe Projects CLI / a scoped GitHub token.
- **vercel.json:** static only (rewrite `/` → newest digest); no functions.

## Context & problem

The digest historically scraped ~60 sites + read 15 newsletters, run by local
launchd + `claude -p` on the user's Mac, serving a local Node server on
`localhost:3847`. Two problems: scraping is brittle, and the local headless run's
access to the Gmail connector was uncertain and depended on Chrome + the Mac
being awake.

We are pivoting to: **email-only sourcing** (subscribe broadly via a Gmail alias,
read one labeled stream) executed by a **cloud routine** (scheduled remote agent),
with the digest **hosted on Vercel**.

## VERIFIED (2026-05-29)

A one-off cloud routine (`events-digest-gmail-connector-test`) confirmed:
- The **Gmail connector loads in a cloud routine** (`mcp__Gmail__*`), no errors.
- It reads label `events-digest` (id `Label_5601765329358498879`) and the
  `deliveredto:sarah.fellay+nycevents@gmail.com` query; both return results.
- Results are **multi-page** (nextPageToken present): the real run must paginate.
- Sample senders confirm the subscribe→alias→label pipeline (Architectural League,
  MAD, Tenement, Museum of the Moving Image, The Other Art Fair, etc.).

This removes the main risk; the cloud model is viable.

## Goals

- Run entirely in the cloud (scheduled remote agent). No Mac, launchd, or Chrome.
- Source events only from email (the alias/label stream + legacy `from:` queries).
- Combine staggered-arrival newsletters into one correct, de-duplicated,
  forward-looking list.
- Four buckets: **this week, this weekend, next week, next weekend**.
- Host the page + feedback backend on Vercel.

## Non-goals

- Scrape-only venues (Bar Bayeux, Barbès, Hot House Jazz) — dropped.
- Local `server.js`, `run-digest.sh`, launchd jobs — retired (kept in git history).
- Ranking re-architecture — reuse the existing taste profile.

## Core principle: two clocks

Separate **email arrival time** from **event date**. Read the label by a wide
*arrival* window; decide inclusion by parsed *event* date. An event announced
3 weeks ago but happening next week must still be included.

## Inbox setup (done by user)

Alias `sarah.fellay+nycevents@gmail.com` for all subscriptions; Gmail filter
`To: alias` → apply label `events-digest`, skip inbox. Label confirmed working.

## Architecture (cloud)

```
Scheduled cloud routine (cron, runs as the user)
  1. read Gmail label:events-digest (PAGINATED, newer_than:30d) + 15 legacy from: queries
  2. extract events, parse real dates
  3. bucket by event date, dedupe, suppress already-featured
  4. rank against taste profile, take top N per bucket
  5. render four-section HTML from template
  6. publish: write digest to the repo via GitHub Contents API (scoped token)
  7. update state.json in the repo (seen_events, source_reliability)
        │ commit
        ▼
  GitHub repo ──auto-deploy──▶ Vercel
                                 ├─ serves the digest page (Vercel URL)
                                 └─ /api/feedback, /api/saved-events (serverless = old server.js)
                                          └─ Vercel KV (saves, thumbs)
                                                 ▲
  next routine run reads feedback via GET /api/feedback ──┘  (folds into taste profile)
```

## Reading model

Each run reads two email sources via the Gmail connector (read scope):
1. **Alias stream:** `label:events-digest newer_than:30d`, **paginated to
   exhaustion** (the test proved page 1 is only the first ~10). Generic channel:
   new sources need no config entry.
2. **Legacy sender queries:** the 15 existing `from:` queries in `config.json`
   (these arrive at the plain address, not the alias).

30-day arrival lookback is wider than the farthest bucket (~17 days), since
announcements precede events. Re-reading is idempotent (dedupe + event-date filter).

## Event extraction & normalization

Per email, extract events with: `name, date (absolute upcoming date incl. year),
time, venue, neighborhood, price, url, category, source (organizer), via
(newsletter)`. Resolve relative dates; expand multi-date/recurring listings; drop
non-events, non-NYC, undated items.

## Four-bucket windowing (by event date, relative to run day R)

| Bucket | Window |
|---|---|
| This week | R → this Friday (weekdays) |
| This weekend | nearest upcoming Fri 17:00 → Sun 23:59 |
| Next week | following Mon → Fri |
| Next weekend | the Sat–Sun after "this weekend" |

Buckets auto-shift by run day; the Sunday run finds "this weekend" over, so it
collapses. Events outside all four are parked, not shown.

## Dedupe & seen-suppression

- Dedupe on normalized `(name + date + venue)`; keep richest record; `via[]`
  tracks all mentions (3+ = popularity boost).
- `state.json` (now stored **in the repo**, read/written by the routine via the
  Contents API) records featured events; each surfaces once, earliest in-window.

## Ranking & volume

Reuse taste profile + feedback history. ~10–12 per bucket (≈40–48 total), nearer
buckets weighted slightly heavier. Tunable in `config.json`.

## Template

`template.html` → four sections (This Week / This Weekend / Next Week / Next
Weekend), each with existing collapsible categories, save stars, thumbs. Empty
buckets hidden.

## Deployment, hosting & feedback (Vercel)

- Vercel project linked to the repo; auto-deploys on every commit.
- Routine writes `digests/<date>.html` + index via GitHub Contents API (no
  `git clone`, sidestepping the historical 500 error).
- `server.js` logic ports to serverless functions `api/feedback.js` +
  `api/saved-events.js`; a `vercel.json` configures routing.
- **Storage: Vercel KV** for saved events + feedback (managed, built for this).
- The routine consumes feedback via `GET /api/feedback` at run start to tune the
  taste profile (avoids giving the routine KV credentials).

## Auth & secrets

- **One scoped GitHub token** (fine-grained, contents:write on `events-digest`)
  for the routine's publish step. Exact secret-handling (routine env secret vs.
  routing the repo write through a Vercel `/api/publish` endpoint that holds the
  token) is decided in the implementation plan.
- Vercel KV credentials live in Vercel env (serverless functions only).
- Gmail uses the existing read-only connector. No Gmail API token.

## Schedule

Cloud cron in UTC (min interval 1 hour). Target the existing cadence converted to
UTC: Thursday + Sunday afternoon ET, timed after the big weekly aggregators
publish (NYC for Free Wed AM, City Happenings Mon).

## User setup (prerequisites, not buildable by the agent)

1. Create a Vercel account; link it to the `events-digest` GitHub repo.
2. Enable Vercel KV on the project.
3. Create the scoped GitHub token; store secrets in Vercel env.
4. Confirm whether the routines platform supports per-routine secrets (drives the
   token-handling choice above).

## Remaining risks

1. **Secret handling for the routine's GitHub write** — needs the plan to confirm
   routine secret support or fall back to a Vercel publish endpoint. (MED)
2. **Pagination completeness** — must page through all label results. (LOW, handled)
3. **Coverage gap** — can only include what has arrived; mitigated by 30-day
   lookback + twice-weekly runs + aggregators. (LOW)
4. **Vercel/GitHub setup is user-side** — build is blocked until done. (process)

## Verification / test plan

- Connector availability in routine — **DONE (passed 2026-05-29).**
- Unit (TDD): `bucketFor(eventDate, runDate)` and `dedupeKey(event)` pure helpers,
  failing tests first (run-day edges, Fri-5pm boundary, year rollover).
- Integration: a routine dry-run that reads the label (paginated), extracts, and
  asserts every output event is in-window, no past events, no cross-bucket dupes,
  none already in `state.json`.
- Feedback round-trip: POST a thumbs to `/api/feedback`, confirm KV write, confirm
  the next routine run reads it.
- End-to-end: one full run → confirm the four sections render on Vercel.

## Open decisions for review

1. Retire legacy scrape sources entirely, or keep disabled-but-available?
2. Per-bucket volume (proposed 10–12 each).
3. Sunday run: hide "This Weekend" or show a short wrap-up?
