# Source Audit — 2026-07-02

Access-route classification for the 64 disabled scrape sources plus the 8 never-arriving
newsletter queries. Every "verified" row was probed live on 2026-07-02 (HTTP fetch + parse,
event count confirmed). Method meanings:

- **ics / squarespace-json / jsonld** — deterministic feed, fetched by `bin/fetch-feeds.js` (plan Task 4/5)
- **rss** — deterministic fetch; date extraction varies per feed (see notes) — second fetcher tier
- **newsletter** — subscribe via `docs/SUBSCRIBE-CHECKLIST.md` (alias auto-labels into `events-digest`)
- **drop** — dead, defunct, or redundant with another source

## 1. Ready feeds — add to config.json as `type:"feed"` (plan Task 7)

| Source | Format | Feed URL | Verified | Notes |
|---|---|---|---|---|
| Fort Greene Park Conservancy | squarespace-json | `https://www.fortgreenepark.org/calendar/?format=json` | 53 events | incl. yoga/fitness classes — the user's canonical missing source |
| Green-Wood Cemetery | ics | `https://www.green-wood.com/calendar/?ical=1` | 30 VEVENTs | WP Events Calendar |
| Gowanus Dredgers | ics | `https://gowanusdredgers.org/?ical=1` | 30 VEVENTs | site root `?ical=1` (WP tribe) |
| NY Mycological Society | ics | `https://www.newyorkmyc.org/events/?ical=1` | 21 VEVENTs | |
| Makeville Studio | ics | `https://calendar.google.com/calendar/ical/makeville.com_r8os53m99cg005fpqu036h3lc0%40group.calendar.google.com/public/basic.ics` | 2717 VEVENTs | public Google Calendar; includes years of history — fetcher must drop past events and cap horizon (e.g. next 60 days) |
| Gotham Center | squarespace-json | `https://www.gothamcenter.org/upcoming-events?format=json` | 3 events | low volume but clean |
| Club Free Time | jsonld | `https://www.clubfreetime.com/new-york-city-nyc/free-talks-lectures` | 45 events | other category pages (`/free-music`, `/free-film`, etc.) follow the same jsonld pattern — add as separate feed entries if wanted |
| Creative Coding NYC | ics | `https://www.meetup.com/creative-coding-nyc/events/ical/` | 0 upcoming | valid Meetup ICS, group currently dormant; harmless to include |

## 2. RSS tier — deterministic fetch, needs per-feed date handling (plan Task 4/5 amendment)

| Source | Feed URL | Verified | Date location |
|---|---|---|---|
| NYC Parks (citywide — supersedes "NYC Parks Movies") | `https://www.nycgovparks.org/xml/events_300_rss.xml` | 1,565 items | Inspect item structure at implementation; MUST filter (e.g. Brooklyn parks / relevant categories) or it swamps the digest. Covers park fitness, movies, tours citywide. |
| ~~NYC Resistor~~ | superseded 2026-07-02 | — | switched to the richer `eventbrite-organizer` feed (section 1a) |
| Secret Science Club | `http://secretscienceclub.blogspot.com/feeds/posts/default?alt=rss` | 25 items | dates in body prose, not structured — routine-LLM extraction tier or rely on The Skint coverage |
| City Reliquary | `https://www.cityreliquary.org/feed/` | 10 items | mixed blog/event posts; marginal — newsletter fallback also fine |

## 1a. Eventbrite organizer feeds (added 2026-07-02, format `eventbrite-organizer`)

Organizer pages embed a server-rendered `upcomingEvents` JSON blob (undocumented page
structure — fails loudly via the coverage report if Eventbrite redesigns).

| Source | Organizer URL | Verified |
|---|---|---|
| NYC Resistor | `https://www.eventbrite.com/o/nyc-resistor-52408308` | 7 upcoming (replaces its RSS feed) |
| Greenlight Bookstore | `https://www.eventbrite.com/o/greenlight-bookstore-13064382976` | 11 upcoming, with prices |
| Photoville | `https://www.eventbrite.com/o/photoville-47122000073` | 2 upcoming (year-round walks, not just the June festival) |

Probed and ruled out (no Eventbrite links on their sites): Turnstile Tours, Craftsman Ave,
Artshack, Bushwick Jewelry Casting, Secret Science Club, Betaworks, Death of Classical,
Culinary Historians, City Reliquary, Edible History, Brooklyn Grange, Gowanus Print Lab,
Genspace, Center for Book Arts, Smack Mellon.

## 3. Newsletter fallback — no usable feed found (subscribe checklist)

**Blocked to bots (403/429 — cloud fetch will also fail):** Brooklyn Museum (429), Prospect Park Conservancy, Atlas Obscura NYC, Explorers Club, Choplet, MoCADA, Art in DUMBO, Center for Brooklyn History*, United Photo Industries†.

**JS-rendered or no feed in HTML:** BAM, Brooklyn Botanic Garden (`/classes` is now 404; `/events` is JS), Books Are Magic, Greenlight Bookstore, Nitehawk Cinema (RSS = blog recaps only, not showtimes), Rooftop Films, Movies With A View (Brooklyn Bridge Park; WP-tribe signal but no working ical export), POWERHOUSE Arena (RSS ≈ empty), Center for Book Arts (RSS = journal, `/events/?ical=1` not supported), Pratt Institute, NYC Noise, Turnstile Tours, Interintellect, Smack Mellon, Death of Classical, Betaworks Studios, Craftsman Ave, Gowanus Print Lab, Artshack Brooklyn, Bushwick Jewelry Casting, Genspace (Squarespace collections exist but return 0 items), A.I.R. Gallery, The Invisible Dog (`/all?format=json` returns 1 stale item), Brooklyn Grange, Maison Clay (class collections return 0 items — booking platform), Bien Hecho Academy, Edible History, Mmuseumm, Culinary Historians of NY, Open House New York (seasonal — October), Photoville (seasonal — June; RSS = blog), FOMO NYC (is itself a newsletter), QU Fermentation (Substack — subscribing is simpler than RSS).

\* Center for Brooklyn History is part of Brooklyn Public Library — covered once the BPL newsletter subscription exists.
† United Photo Industries appears inactive; verify before bothering.

## 4. Drop — dead or redundant

| Source | Reason |
|---|---|
| Find The Thread | 404 (dead since April) |
| S.A.S.S. (history.wtf) | empty 114-byte page — domain husk |
| SummerScreen | 404 — defunct |
| Brooklyn Kitchen | site alive but business repurposed; no classes listed |
| Eventbrite Brooklyn | generic JS search page; individual venues covered directly |
| BRIC Events (scrape) | redundant — BRIC newsletter already enabled and arriving |
| Gary's Guide (scrape) | redundant — enabled newsletter arrives |
| Cerebral Valley (scrape) | redundant — enabled newsletter arrives |
| NYC Parks Movies | superseded by the citywide NYC Parks RSS feed (section 2) |
| Luma NYC | discover page has no single feed; per-calendar ICS possible later if a specific Luma calendar matters; tech already covered by Gary's Guide + Cerebral Valley |

## 5. The 8 never-arriving newsletter queries (verified zero emails in 30 days)

All go on the subscribe checklist: NY Adventure Club, Brooklyn Public Library, Nonsense NYC,
BKReader, Built In NYC, Patch Fort Greene, Patch Bed-Stuy, Patch BK Heights-DUMBO.
Keep their config entries quarantined (`enabled:false` + note) until subscribed.

## Bonus suggestions (not in config today)

- **Pioneer Works** — prolific producer (appeared repeatedly in old scrape runs); has a newsletter → checklist.
- **Brooklyn Bridge Park newsletter** — covers Movies With A View + waterfront events → checklist.
- **Screen Slate** — daily NYC repertory/indie screening listings newsletter; single best replacement for Nitehawk/Rooftop/film coverage → checklist.
