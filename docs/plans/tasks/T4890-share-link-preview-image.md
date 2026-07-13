# T4890: Shared reel links: first-frame preview image with play button

**Status:** DONE
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-11
**Updated:** 2026-07-11

## Problem

Any link to a shared video (e.g. `https://app.reelballers.com/shared/{token}`) should unfurl with a preview image of the **first frame of the video** plus a **play button overlay**, so recipients in iMessage/WhatsApp/social see the reel before clicking and the link reads as "a video" rather than a bare URL.

Today the edge share page ([functions/shared/[token].js](../../src/frontend/functions/shared/%5Btoken%5D.js), shipped in T4840) emits `og:video`, `og:title`, `og:description`, and `twitter:card=player` — but **no `og:image` / `twitter:image`**. Most chat apps require an og:image to render a visual card; without it the unfurl is text-only (or nothing).

## Solution

1. **Generate a poster/thumbnail at publish time** — extract the first frame of the final video during the export pipeline (FFmpeg frame grab is already available server-side; see the export pipeline knowledge doc), store it in R2 next to the final video (e.g. `{final_video_key}.jpg` or a `posters/` prefix), and record the reference with the final video row so it's frozen at publish (per the "explicit names after archive" principle — no re-derivation later).
2. **Serve it in the share page meta tags** — add `og:image`, `og:image:width/height`, and `twitter:image` to the edge function's HTML. `twitter:card=player` + og:video already signal "playable", and major platforms render their own play affordance over the og:image when og:video is present; only bake a play-button glyph into the generated JPEG if real-world unfurl testing (iMessage, WhatsApp) shows no platform-rendered play button.
3. **Use it on the page itself** — set `poster=` on the share page `<video>` so first paint shows the frame instantly (complements T4840's ~550ms video start).

Backfill decision: existing published reels have no poster. Either lazily generate on first share-page hit, or a one-off backfill script over published finals. Decide in design; do NOT add a read-time fallback that hides missing posters silently (log/omit the tag instead).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/functions/shared/[token].js` — edge share page; meta tags at lines ~66-79, `<video>` at ~103
- `src/frontend/functions/shared/share-page.test.js` — existing tests for the edge function
- `src/backend/app/routers/export/overlay.py` (and the export pipeline it belongs to) — where the final video is produced; add frame extraction here
- `src/backend/app/routers/shares.py` — share resolution (`get_shared_video`); poster ref must flow into the payload the edge function reads
- Profile DB `final_videos` table (+ migration for a poster/thumbnail column) — schema change, Migration agent required

### Related Tasks
- Builds on: T4840 (edge-rendered share page, DONE)
- Overlaps with: T4910 (game share links also need a preview image + title — share the poster-generation/OG-tag approach; T4890 lands the mechanism first)

### Technical Notes
- Knowledge docs: [export-pipeline.md](../../.claude/knowledge/export-pipeline.md), [persistence-sync.md](../../.claude/knowledge/persistence-sync.md)
- Poster must be publicly fetchable by unfurl crawlers with zero auth (same access model as the shared video URL).
- og:image should be an absolute URL; crawlers don't execute JS, which is why this must stay in the edge-rendered HTML, not the SPA.
- Verify with real unfurl testing: iMessage, WhatsApp, and one of Slack/Twitter.

## Implementation

### Steps
1. [ ] Design: poster key scheme, final_videos schema addition, backfill strategy (design doc if L-tier gates trigger)
2. [ ] Export pipeline: extract first frame → JPEG → R2 at publish; persist ref on final video
3. [ ] Migration: profile_db column + (chosen) backfill
4. [ ] Edge function: og:image/twitter:image + `<video poster>`
5. [ ] Test unfurls on real platforms; bake-in play glyph only if needed

### Progress Log

**2026-07-11**: Task created from user request.

## Acceptance Criteria

- [ ] Pasting a `/shared/{token}` link into iMessage/WhatsApp shows a card with the video's first frame and a play affordance
- [ ] Share page `<video>` uses the poster (no black frame before playback)
- [ ] Newly published reels always get a poster; pre-existing reels handled per chosen backfill strategy (no silent fallback)
- [ ] Tests pass (share-page.test.js updated)
