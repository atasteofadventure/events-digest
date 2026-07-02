# Subscribe Checklist

Sign up with **sarah.fellay+nycevents@gmail.com** — the existing Gmail filter auto-labels
alias mail into `events-digest`, which the cloud routine reads. No config change needed for
alias-stream newsletters; the 8 quarantined `from:` queries get re-enabled after subscribing.

Signup is usually a footer form on the venue's homepage; URLs below are the page to start from.

## Tier A — do these first (high event volume, no feed possible)

The 8 dead config queries:
- [ ] NY Adventure Club — https://www.nyadventureclub.com/
- [ ] Brooklyn Public Library — https://www.bklynlibrary.org/ (footer signup; /enews is 404 — also covers Center for Brooklyn History)
- [ ] Nonsense NYC — https://www.nonsensenyc.com/
- [ ] BKReader — https://www.bkreader.com/
- [ ] Built In NYC — https://builtin.com/ (account/newsletter settings; /newsletter is 404)
- [ ] Patch Fort Greene — https://patch.com/new-york/fort-greene-clinton-hill (newsletter signup)
- [ ] Patch Bed-Stuy — https://patch.com/new-york/bed-stuy
- [ ] Patch Brooklyn Heights–DUMBO — https://patch.com/new-york/heights-dumbo

Blocked-to-bots or JS-only venues:
- [ ] Brooklyn Museum — https://www.brooklynmuseum.org/ (footer email signup)
- [ ] BAM — https://www.bam.org/
- [ ] Prospect Park Conservancy — https://www.prospectpark.org/
- [ ] Brooklyn Botanic Garden — https://www.bbg.org/
- [ ] Nitehawk Cinema — https://nitehawkcinema.com/
- [ ] Rooftop Films — https://rooftopfilms.com/
- [ ] Books Are Magic — https://www.booksaremagic.net/
- [ ] Greenlight Bookstore — https://www.greenlightbookstore.com/
- [ ] Atlas Obscura — https://www.atlasobscura.com/newsletters
- [ ] Brooklyn Bridge Park — https://www.brooklynbridgepark.org/ (covers Movies With A View)

New suggestions (not in config, high signal):
- [ ] Pioneer Works — https://pioneerworks.org/
- [ ] Screen Slate — https://www.screenslate.com/ (daily NYC screening listings — best film coverage available)

## Tier B — smaller venues, subscribe if you care about them

- [ ] POWERHOUSE Arena — https://powerhousearena.com/
- [ ] Center for Book Arts — https://centerforbookarts.org/
- [ ] Explorers Club — https://www.explorers.org/
- [ ] Interintellect — https://interintellect.com/
- [ ] Turnstile Tours — https://turnstiletours.com/
- [ ] Brooklyn Grange — https://www.brooklyngrangefarm.com/
- [ ] A.I.R. Gallery — https://airgallery.org/
- [ ] The Invisible Dog — https://www.theinvisibledog.org/
- [ ] Smack Mellon — https://smackmellon.org/
- [ ] MoCADA — https://mocada.org/
- [ ] City Reliquary — https://www.cityreliquary.org/
- [ ] Death of Classical — https://www.deathofclassical.com/
- [ ] Craftsman Ave — https://craftsmanave.com/
- [ ] Genspace — https://www.genspace.org/
- [ ] Artshack Brooklyn — https://www.artshackbrooklyn.org/
- [ ] Maison Clay — https://www.maisonclay.com/
- [ ] Choplet — https://choplet.com/
- [ ] Bushwick Jewelry Casting — https://www.bushwickjewelrycasting.com/
- [ ] Gowanus Print Lab — https://www.gowanusprintlab.com/
- [ ] Bien Hecho Academy — http://www.bienhechoacademy.com/
- [ ] Edible History — https://www.ediblehistorynyc.com/
- [ ] Mmuseumm — https://www.mmuseumm.com/
- [ ] Culinary Historians of NY — https://culinaryhistoriansny.org/
- [ ] QU Fermentation — https://qufermentation.substack.com/ (Substack subscribe)
- [ ] Open House New York — https://ohny.org/ (seasonal — October)
- [ ] Photoville — https://photoville.com/ (seasonal — June)
- [ ] FOMO NYC — https://fomo.nyc/
- [ ] NYC Noise — https://nyc-noise.com/
- [ ] Pratt Institute — https://www.pratt.edu/events/
- [ ] Betaworks Studios — https://www.betaworks.com/

## After subscribing

1. Confirm the first issue of each lands with the `events-digest` label (alias filter).
2. For the 8 quarantined config queries: flip `enabled:true` and remove the `note` in
   `config.json` (plan Task 12 step 5).
