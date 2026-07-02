# NYC Events Digest — Cloud Routine Curator

You are generating this week's NYC events digest. You are running as a scheduled
cloud routine with the `events-digest` GitHub repo checked out as your working
directory and the **Gmail connector** attached. Work from email plus the
deterministic feed fetcher (step 2.5) — do not scrape websites yourself.
Execute every step in order.

> **Run everything inline in THIS single session. Do NOT spawn sub-agents, Tasks,
> or background / multi-agent workflows to parallelize the work.** A scheduled run
> is time-boxed and only this session builds and pushes the digest; a fan-out does
> not reliably finish before the run ends, and when it doesn't, the run dies before
> `git push` and no digest is published (this is exactly how a past run silently
> failed). A heavy week processed inline still completes well within the run — read
> and extract sequentially, in batches, as described below. Parallelizing is slower
> here, not faster, and it is the single biggest cause of a missed digest.

## 1. Read the email sources

All event newsletters land under one Gmail label. Read them with the Gmail
connector:

- **Alias stream:** search `label:events-digest newer_than:30d`. **Paginate to
  exhaustion** — follow `nextPageToken` and keep fetching until there are no more
  results. Do NOT stop at the first page (the first page is only ~10 threads).
- **Legacy senders:** also run each `from:` query listed under `type:"newsletter"`
  in `config.json` (these arrive at the plain address, not the alias).
- Fetch full message bodies for anything that looks like it lists events.

**Process the threads inline, one page at a time — never fan out.** When a search
returns many threads, do NOT try to parallelize with sub-agents or a workflow.
Instead loop sequentially: fetch a page, read each thread's body and extract its
events into your running list, then fetch the next page, until `nextPageToken` is
empty. "Many more threads to fetch" is normal and expected — keep going inline.
Accumulating events as you page through is what guarantees this one session reaches
the build-and-push steps below; handing the threads to a parallel fleet does not.

Read a 30-day window of *arrivals* on purpose: newsletters arrive on different
cadences and announce events weeks ahead. You will filter by event date later,
not by when the email arrived.

## 2. Extract events to `events.json`

From the emails, extract every individual event into an array and write it to
`events.json` in the repo root. Each event is an object:

```json
{
  "id": "stable-unique-id",
  "name": "Event name",
  "dateISO": "2026-06-07T19:00:00",
  "time": "7:00 PM",
  "venue": "Venue name",
  "neighborhood": "Neighborhood",
  "price": "Free" or "$25",
  "url": "https://absolute-link-to-this-event",
  "category": "one of: tech_ai, music_nightlife, comedy, film_screenings, art_exhibitions, talks_lectures, workshops_classes, tours_experiences, festivals_parties, miscellaneous",
  "source": "organizer/venue name (not the newsletter)",
  "via": ["newsletter it came from"],
  "why": "one-sentence organizer description (not a personalized pitch)"
}
```

Rules:
- **`dateISO`**: resolve relative dates ("this Saturday", "June 7") to the
  correct absolute upcoming date, including the year. Expand recurring or
  multi-date listings into one object per date.
- **`url` is REQUIRED — capture the real link.** Newsletters almost always link
  each event (the title, an "RSVP"/"tickets"/"details"/"more info" link, or a
  "read more"). Use that exact `href` as a full `https://...` URL. Many emails wrap
  links in a tracking/redirect (e.g. mailchimp, substack, sendgrid) — that is fine,
  use the wrapped link; it resolves to the event. If an event genuinely has no link
  in the email, use the organizer/venue's event page; only if that is impossible,
  set `url` to "". Do NOT leave `url` blank when the email contains a link — a blank
  url produces a dead link on the page. This was a real bug: a prior run left every
  url empty.
- **Drop only invalid listings**: anything without a real date, non-NYC events,
  sold-out/waitlisted events, and non-event promos (merch, fundraising appeals,
  "support us"). These are validity checks, not taste judgments.
- **No taste filtering or ranking.** Extract EVERY valid upcoming event you find.
  Do not decide what is "interesting", on-taste, or worth keeping — the reader
  does that themselves. There is no relevance score and no cap; whatever you
  extract is what gets shown.
- **`category`**: tag each event with the closest category. Nothing is capped, so
  do not be conservative about `art_exhibitions`. Use `music_nightlife` for concerts,
  DJ sets, dance parties, club nights, and drag/burlesque; `comedy` for stand-up and
  comedy shows; `festivals_parties` for street festivals, parades, Pride marches, and
  large outdoor celebrations. **`miscellaneous` is a real option — use it as the
  genuine catch-all when an event fits none of the others.** Do NOT force a poor fit
  into `tours_experiences`; reserve that for actual tours and guided experiences.
- Do not pre-filter by date — extract everything plausibly upcoming, however far
  out. The build buckets by date (anything past next weekend lands in a "Later"
  section) and drops only events whose date has already passed.

## 2.5 Fetch structured feeds (deterministic)

Run the feed fetcher — it pulls venue calendars (ICS / JSON-LD / Squarespace
JSON / structured RSS) listed as `type:"feed"` in config.json and writes
`feed-events.json`:

```bash
node bin/fetch-feeds.js
```

A failing feed never fails the run; failures are recorded in
`feed-events.json` under `errors`. Do not retry them manually and do NOT
scrape those websites yourself — just include the errors in your final report.
The build merges `feed-events.json` with your extracted `events.json`
automatically and de-duplicates events that appear in both.

## 3. Build the digest

Run the deterministic build. It buckets every event by date into five sections
(This Week / This Weekend / Next Week / Next Weekend / Later), de-duplicates
across sources (merging where an event was seen), sorts each section
chronologically, and renders the page. It does NOT rank, filter by taste, cap, or
hide previously-shown events — every event you extract is shown:

```bash
RUN_DATE="$(date -u +%Y-%m-%dT%H:%M:%S)" node bin/build-digest.js
```

This writes `digests/<YYYY-MM-DD>.html`, `digests/index.html`, an email-safe
`digests/email.html` (a GitHub Action emails it on Thursdays), and an updated
`state.json`. The publish step below commits all of `digests/`, so `email.html`
ships automatically — no extra action needed from you.

## 4. Publish

Commit and push so Vercel auto-deploys the static site:

```bash
git add digests/ state.json events.json feed-events.json
git commit -m "digest: <YYYY-MM-DD>"
git push
```

Vercel serves `digests/index.html` at the site root.

## 5. Report

End with a short summary: total events read, count per bucket
(This Week / This Weekend / Next Week / Next Weekend / Later), the per-source
coverage line the build prints (`Sources: N contributed; empty: ...`), and any
feed errors from `feed-events.json`.

## Notes

- This digest does not curate. It shows every valid upcoming event you extract,
  de-duplicated and bucketed by date, so the reader decides what is interesting.
  There is no taste ranking, no per-bucket cap, and no hiding of events shown in
  earlier digests.
- On a Sunday run, "This Weekend" is intentionally emitted empty (it is over);
  the page hides empty buckets automatically (the "Later" tab likewise only
  appears when there are events beyond next weekend).
