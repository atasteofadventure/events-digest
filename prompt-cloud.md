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
  "relevance": 0.0-1.0,
  "why": "one-sentence organizer description (not a personalized pitch)"
}
```

Rules:
- **`dateISO`**: resolve relative dates ("this Saturday", "June 7") to the
  correct absolute upcoming date, including the year. Expand recurring or
  multi-date listings into one object per date.
- **Drop**: anything without a real date, non-NYC events, sold-out/waitlisted
  events, and non-event promos (merch, fundraising appeals, "support us").
- **`relevance`**: score against the taste profile and feedback history in
  `config.json` (favor hands-on workshops, tours, tech/AI, talks/salons, local
  Brooklyn, free-to-moderate price; penalize fitness, kids, mixers, multi-day
  commitments, and food/flea markets). Higher = more on-taste.
- **`category`**: art exhibitions are capped downstream, so only tag genuine
  exhibition events as `art_exhibitions`.
- Do not pre-filter by date — extract everything plausibly upcoming. The build
  step buckets, dedupes, and drops out-of-window events.

## 3. Build the digest

Run the deterministic build (it buckets by event date into this/next week +
weekend, dedupes, suppresses already-featured events from `state.json`, ranks by
`relevance`, caps each bucket, renders the four-tab page, and updates
`state.json`):

```bash
RUN_DATE="$(date -u +%Y-%m-%dT%H:%M:%S)" VOLUME_PER_BUCKET=12 node bin/build-digest.js
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
(This Week / This Weekend / Next Week / Next Weekend), and any sources that
returned nothing or errored.

## Notes

- Feedback/taste-learning is deferred — there is no feedback to read. Ranking
  uses only the static taste profile in `config.json`.
- On a Sunday run, "This Weekend" is intentionally emitted empty (it is over);
  the page hides empty buckets automatically.
