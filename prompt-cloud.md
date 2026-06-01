# NYC Events Digest — Cloud Routine Curator

You are generating this week's NYC events digest. You are running as a scheduled
cloud routine with the `events-digest` GitHub repo checked out as your working
directory and the **Gmail connector** attached. Work entirely from email — do
not scrape websites. Execute every step in order.

## 1. Read the email sources

All event newsletters land under one Gmail label. Read them with the Gmail
connector:

- **Alias stream:** search `label:events-digest newer_than:30d`. **Paginate to
  exhaustion** — follow `nextPageToken` and keep fetching until there are no more
  results. Do NOT stop at the first page (the first page is only ~10 threads).
- **Legacy senders:** also run each `from:` query listed under `type:"newsletter"`
  in `config.json` (these arrive at the plain address, not the alias).
- Fetch full message bodies for anything that looks like it lists events.

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
  "url": "https://link-to-event",
  "category": "one of: tech_ai, workshops_classes, tours_experiences, film_screenings, art_exhibitions, talks_lectures",
  "source": "organizer/venue name (not the newsletter)",
  "via": ["newsletter it came from"],
  "why": "one-sentence organizer description (not a personalized pitch)"
}
```

Rules:
- **`dateISO`**: resolve relative dates ("this Saturday", "June 7") to the
  correct absolute upcoming date, including the year. Expand recurring or
  multi-date listings into one object per date.
- **Drop only invalid listings**: anything without a real date, non-NYC events,
  sold-out/waitlisted events, and non-event promos (merch, fundraising appeals,
  "support us"). These are validity checks, not taste judgments.
- **No taste filtering or ranking.** Extract EVERY valid upcoming event you find.
  Do not decide what is "interesting", on-taste, or worth keeping — the reader
  does that themselves. There is no relevance score and no cap; whatever you
  extract is what gets shown.
- **`category`**: tag each event with the closest category. Nothing is capped, so
  do not be conservative about `art_exhibitions`.
- Do not pre-filter by date — extract everything plausibly upcoming, however far
  out. The build buckets by date (anything past next weekend lands in a "Later"
  section) and drops only events whose date has already passed.

## 3. Build the digest

Run the deterministic build. It buckets every event by date into five sections
(This Week / This Weekend / Next Week / Next Weekend / Later), de-duplicates
across sources (merging where an event was seen), sorts each section
chronologically, and renders the page. It does NOT rank, filter by taste, cap, or
hide previously-shown events — every event you extract is shown:

```bash
RUN_DATE="$(date -u +%Y-%m-%dT%H:%M:%S)" node bin/build-digest.js
```

This writes `digests/<YYYY-MM-DD>.html`, `digests/index.html`, and an updated
`state.json`.

## 4. Publish

Commit and push so Vercel auto-deploys the static site:

```bash
git add digests/ state.json events.json
git commit -m "digest: <YYYY-MM-DD>"
git push
```

Vercel serves `digests/index.html` at the site root.

## 5. Report

End with a short summary: total events read, count per bucket
(This Week / This Weekend / Next Week / Next Weekend / Later), and any sources
that returned nothing or errored.

## Notes

- This digest does not curate. It shows every valid upcoming event you extract,
  de-duplicated and bucketed by date, so the reader decides what is interesting.
  There is no taste ranking, no per-bucket cap, and no hiding of events shown in
  earlier digests.
- On a Sunday run, "This Weekend" is intentionally emitted empty (it is over);
  the page hides empty buckets automatically (the "Later" tab likewise only
  appears when there are events beyond next weekend).
