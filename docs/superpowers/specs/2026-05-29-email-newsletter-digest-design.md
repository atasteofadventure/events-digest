# Email-Newsletter Sourcing & Four-Bucket Windowing — Design Spec

- **Date:** 2026-05-29
- **Project:** NYC Events Digest
- **Status:** Draft for review

## Context & problem

The digest historically pulled events by scraping ~60 sites plus reading 15
newsletters by sender. Scraping is brittle: bot-protected and JS-heavy sites
fail (8 failed in the 2026-05-28 run), and source diversity skews to a few
prolific sites. We are pivoting to an **email-only** model: subscribe broadly to
NYC event newsletters and aggregators using a Gmail alias, and read them from a
single labeled inbox stream.

The hard part is timing. Newsletters arrive on wildly different cadences (daily,
weekly, monthly, sporadic), and each issue covers a different time horizon. We
must assemble a correct, forward-looking event list regardless of when each
newsletter happened to land.

## Goals

- Source events entirely from email (no scraping in the weekly run).
- Combine staggered-arrival newsletters into one correct, de-duplicated,
  forward-looking list.
- Organize output into four buckets: **this week, this weekend, next week,
  next weekend**.
- Never feature the same event twice; never show past or out-of-window events.

## Non-goals

- Scrape-only venues (Bar Bayeux, Barbès, Hot House Jazz) are out of scope.
- No change to the feedback server, save/feedback features, or launchd server job.
- No re-architecture of ranking; we reuse the existing taste profile.

## Core principle: two clocks

Separate **email arrival time** from **event date**.
- Read the label by a wide *arrival* window.
- Decide inclusion by parsed *event* date.

Conflating the two is the central failure mode (an event announced 3 weeks ago
but happening next week must still be included).

## Inbox setup (already done by user)

- Alias `sarah.fellay+nycevents@gmail.com` used for all new subscriptions.
- Gmail filter: `To: sarah.fellay+nycevents@gmail.com` → apply label
  `events-digest`, skip inbox.
- Label `events-digest` confirmed working (auto-labeling new alias mail).

## Reading model

Each run reads two email sources, both via the Gmail connector (read-only):
1. **Alias stream:** everything in `label:events-digest newer_than:30d`. This is
   the generic, subscribe-freely channel; new sources need no config entry.
2. **Legacy sender queries:** the existing 15 `from:` newsletter queries in
   `config.json` (these arrive at the plain address, not the alias, so they are
   not in the label). Kept so we do not lose working sources or force
   re-subscription.

A 30-day arrival lookback is deliberately wider than the farthest bucket
(~17 days out) because announcements precede events. Re-reading prior issues is
harmless: dedupe and event-date filtering make the pipeline idempotent.

## Event extraction & normalization

For each email, extract individual events with normalized fields:
`name, date (resolved to an absolute upcoming calendar date incl. year), time,
venue, neighborhood, price, url, category, source (organizer/venue), via
(newsletter it came from)`.

Rules:
- Resolve relative dates ("Saturday, June 7") to the correct upcoming date.
- Expand multi-date / recurring listings into individual dated instances.
- Drop non-events (promos, merch, "support us"), non-NYC, and undated items.

## Windowing: four buckets (by event date, relative to run day R)

| Bucket | Window |
|---|---|
| This week | R → this Friday (weekday events) |
| This weekend | nearest upcoming Fri 17:00 → Sun 23:59 |
| Next week | following Mon → Fri |
| Next weekend | the Sat–Sun after "this weekend" |

Buckets auto-shift by run day. The Thursday run fills all four. The Sunday run
finds "this weekend" effectively over, so it collapses and that run leans on
this-week / next-week / next-weekend. Events outside all four buckets (e.g., a
festival months out) are parked, not shown.

## Dedupe

Collapse duplicates on normalized `(name + date + venue)`. Keep the richest
record. Track all newsletters that mentioned an event in `via[]`; 3+ mentions is
a popularity signal that boosts ranking.

## Seen-suppression

`state.json` records events featured in prior digests (key = dedupe key). An
in-window event already featured is suppressed, so each event surfaces once, in
its earliest in-window digest. Advance notice is a feature: a great event 12 days
out appears now and is not repeated next week.

## Ranking & volume

Reuse the existing taste profile and feedback history. Per bucket: rank, then
take the top N. Proposed N ≈ 10–12 per bucket (≈40–48 total), nearer buckets
weighted slightly heavier since they are more actionable. Tunable in `config.json`.

## Template change

`template.html` moves from two tabs (Weekday/Weekend) to **four sections** (This
Week / This Weekend / Next Week / Next Weekend), each with the existing
collapsible category groups, save stars, and thumbs feedback. Empty buckets
(e.g., This Weekend on a Sunday run) are hidden.

## File changes

- `prompt.md` — the substantive change: read both email sources, extract, bucket
  by event date, dedupe, suppress seen, rank, emit four sections.
- `template.html` — four sections instead of two tabs.
- `config.json` — disable/retire `type: "scrape"` sources for the weekly run
  (email-only); keep the 15 newsletter `from:` queries; add per-bucket volume
  targets. Optional `newsletter_overrides` to pin a sender to a category.
- `state.json` — unchanged shape; `seen_events` now keyed on the dedupe key.

## Run cadence & scheduling

Keep launchd Thu (hourly 10:07–18:07, first success wins) + Sun 17:03. Email-only
removes the Chrome dependency from sourcing, so runs no longer require Chrome to
be open. Timing the run after the big weekly aggregators publish (NYC for Free
Wed AM, City Happenings Mon) means a Thursday run already has the week's roundups.

## Key risks & assumptions

1. **Gmail connector availability in headless runs (HIGH).** The weekly run is
   `claude -p` under launchd. Interactively-authenticated connectors (the
   claude.ai Gmail connector) may not load in a headless/cron context. The whole
   email-only model depends on the connector being available there. **Must verify
   before relying on it.** Fallback options if unavailable: a Gmail API token, or
   IMAP read.
2. **Read-only scope is sufficient.** Reading needs only read scope (confirmed
   working); no label-writing needed by the digest.
3. **Coverage gap.** The digest can only include what has arrived. A newsletter
   sent after a run is missed until the next run. Mitigated by 30-day lookback,
   twice-weekly runs, and aggregator-heavy sourcing; not zero.

## Verification / test plan

- **Unit (TDD):** a pure date-bucketing helper `bucketFor(eventDate, runDate)` →
  one of {thisWeek, thisWeekend, nextWeek, nextWeekend, out}. Write failing tests
  covering run-day edge cases (Thu run, Sun run, Fri-5pm boundary, year rollover)
  before implementing.
- **Unit (TDD):** dedupe-key normalization `dedupeKey(event)` (case/punctuation/
  venue-abbreviation folding).
- **Integration (live dry-run):** run extraction against the real `events-digest`
  label and assert: every output event has an in-window date, no past events, no
  duplicates across buckets, no event already in `state.json.seen_events`.
- **End-to-end:** one full run, then manually confirm the four sections render and
  the events are plausible and correctly bucketed.

## Open decisions for review

1. Retire legacy scrape sources entirely, or keep them disabled-but-available?
2. Per-bucket volume (proposed 10–12 each).
3. On the Sunday run, hide "This Weekend" entirely or show a "wrap-up" of what's
   left of it?
