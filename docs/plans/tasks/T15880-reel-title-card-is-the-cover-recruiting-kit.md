# T15880: Reel title card and cover

## In plain words

The reel's title card, with the athlete's name, number, position, graduation year and club, is held as the first frames, so it is the picture every platform shows, the card a coach needs, and the first second of the reel. Competitors charge ten to fifteen dollars a month for this. A share link for the reel shows the parent how many times it was viewed.


**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 6, Highlight reels and recruiting kit (see PLAN.md). After T11300.

## How we got here

Owner 2026-11-09: social cover should be redesigned with reel management, since adding a cover to a
reel is the primary case. Research the same day: platforms default the cover to frame 0 (the Social
Cover Image epic's own finding); competitors sell the recruiting card and coach link as the product
(Clipt $9.99 a month, NextPlay $14.99, Trace iD on $180 a year).

## The problem

A reel without a title card opens on a random frame; a recruiting reel without name, number, position
and graduation year is not usable by a coach; and the only cover lever that works everywhere is frame 0.

## What we will do

1. Title card template for reels: athlete name, jersey number, position, graduation year, club or
   team, optional contact line; athlete fields come from the athlete profile (T6660 intro card) and
   are edited in place. Rendered by the existing serve-time compose (`compose_serve_time_dispatched`),
   2.5 s, held as the first frames so it is the default cover on every platform.
2. Cover choice: the title card is the default; the parent may pick any highlight's cover frame instead
   (the existing cover picker), and the chosen still is prepended for the first 0.5 s. One place to
   set it, on the reel's Arrange step.
3. Coach link: a share link for the reel with a view count visible to the parent (shares table already
   records `share_viewed`); no coach account.
4. Download the cover JPEG for platforms whose picker needs it (the one-tap save from T11530, kept
   here as a row in the Share sheet, not a separate panel).

## How we will know it worked

- [ ] A reel exported with the title card shows the card as the default cover when uploaded to Instagram, TikTok and YouTube Shorts and when sent by iMessage and WhatsApp (owner-run check on real phones, recorded in the task file).
- [ ] Name, number, position, grad year and club render legibly at 390 px and 1080p; US spelling and glossary words.
- [ ] The reel share link shows a view count on the Reels tab tile.
- [ ] No "reel" wording for a single highlight; "highlight reel" only in titles.

## For the implementer

### Related Tasks
T11300 (reel MVP), T11510 (share split), T6660 (athlete intro card), T15070 (end-card ref code).

### Relevant Files (REQUIRED)
- `src/backend/app/services/serve_time_video.py`
- `src/backend/app/services/publish_final_video.py`
- `src/frontend/src/components/collections/ReelTile.jsx`
- `src/frontend/src/components/introcards/` (athlete card fields)
- `src/frontend/src/hooks/useWebShare.js`
- `src/backend/app/routers/shares.py`
