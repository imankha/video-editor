# T5240: Animated branded outro

**Status:** TODO
**Impact:** 6 | **Complexity:** 3
**Related:** [Player Intro epic](player-intro/EPIC.md) (shared motion language) · animation-polish direction (2026-07-15)

## Problem

The "Made with Reel Ballers" branded outro (T3950, shipped/deployed) is a near-**static** card:
`branded_outro._build_outro_card` ([branded_outro.py:195](../../src/backend/app/services/branded_outro.py#L195))
composes a dark bg + logo `overlay` + two `drawtext` lines, and the only motion is a single
`fade=t=in:st=0:d={OUTRO_FADE_IN}:color=black`. Per the user's direction (intros, outros, and
spotlights should **animate and look premium**), the outro should feel produced, not a still frame
that fades up.

## Scope

Animate the outro card — all inside `_build_outro_card`'s `filter_complex` (the card is encoded
ONCE and cached per resolution×fps×format, so animating it is effectively free at export time):
- **Logo/wordmark reveal** — scale-up / slide-in / mask reveal rather than a hard cut (ffmpeg
  `zoompan`, timed `overlay` y-expression, or `xfade`).
- **Staggered captions** — "Made with" then the URL fade/slide in on an offset, not both at once
  (timed `drawtext` `alpha='if(...)'` / `enable='between(t,...)'`).
- **Optional subtle motion background** (slow gradient/particle drift) if it reads premium.
- Keep the same brand assets/colors (`_LOGO_PATH`, `_BG_COLOR`, `_CAPTION_COLOR`) and duration
  envelope (`OUTRO_DURATION`); tune `OUTRO_FADE_IN`/add timing constants as needed.

**Shared motion language with the intro:** coordinate with [T5210](player-intro/T5210-intro-card-generation.md)
so intro and outro feel like one system (same easing/flash vocabulary) — a reel that opens with an
animated intro and closes with an animated outro should look cohesive.

## Constraints (unchanged from T3950)
- **Probe-match** the main video (`_probe_media`) — the animated card must still concat cleanly
  (`_concat_copy` / `_concat_reencode`, `_validate_concat`).
- **Non-fatal:** card failure still ships the video outro-less (existing contract).
- **No pipeline change** — this is entirely within the card builder; the download-time burn seam
  (`downloads.py`) and playback `BrandedEndCard.jsx` are untouched (though the playback end-card
  component could get a matching CSS animation as a nicety).

## Relevant files
- `src/backend/app/services/branded_outro.py` — `_build_outro_card` (:195), constants
  (`OUTRO_DURATION`, `OUTRO_FADE_IN`, `_BG_COLOR`, `_LOGO_PATH`, `_CAPTION_COLOR`), `_probe_media`,
  concat/cache helpers
- `src/frontend/src/components/BrandedEndCard.jsx` — optional matching playback animation
- `src/frontend/src/constants/brandedOutro.js` — flag

## Classification hint
M-tier, backend-only ffmpeg filter work + a design pass on timing/easing ("looks professional" is
the bar). No schema, no pipeline change. Cache is ephemeral (`/tmp`), so a card-code change
regenerates on next export automatically.

## Acceptance criteria
- [ ] The outro card visibly animates (logo reveal + staggered captions), not just a fade-up.
- [ ] Motion vocabulary is cohesive with the intro (T5210).
- [ ] Concat stays clean across 9:16 / 1:1 / 16:9; non-fatal on failure; no double-outro.
- [ ] Reviewed as "looks professional."
