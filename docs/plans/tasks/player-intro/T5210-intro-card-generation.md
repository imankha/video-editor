# T5210: Intro card generation engine

**Status:** TODO
**Impact:** 7 | **Complexity:** 6
**Epic:** [Player Intro](EPIC.md) — child 3 of 5

> Read [EPIC.md](EPIC.md) for the visual target and the branded-outro reuse pattern.

## Problem

Generate the intro MP4 from the profile's athlete fields ([T5190](T5190-athlete-profile-fields-photo.md))
+ (cut-out) photo ([T5200](T5200-player-cutout.md)), matching the reference card, to be prepended
to a reel/collection/multiclip output. No image-to-video path exists today — but
`branded_outro._build_outro_card` is a near-complete template.

## Scope

Build `app/services/player_intro.py` (mirroring `branded_outro.py`):
- `build_intro_card(info, probe, out_path)` — compose an **animated** card:
  - Gold background (`-f lavfi color`), player **name tiled as a faint watermark**, diagonal
    hazard-stripe accents (overlay PNGs or drawbox), the **stats panel** (drawtext, absolute
    `fontfile=` — Fly image has no fontconfig; reuse `app/assets/fonts/DejaVuSans-Bold.ttf`),
    the **cut-out player photo as the animated hero**, and a **white-flash** out.
  - Use `photo_cutout_key` when present, else `photo_key`.
- **Motion is the deliverable, not a nicety (user direction):** the photo does a slow push-in /
  Ken Burns / reveal so the kid is up close and central; stats lines **stagger/fade in**; the
  white-flash transitions out. Use ffmpeg `zoompan` (photo), `drawtext` with `enable='between(t,...)'`
  or alpha ramps (staggered text), and `xfade`/fade for the flash. A static frame is NOT
  acceptable — the value is the animation + professionalism.
- **Probe-match the target** via `_probe_media` (branded_outro.py:141) so the concat is clean
  (width/height/fps/pix_fmt/sar); cache per (resolution×fps×format×profile-content-hash) like the
  outro card cache.
- **Prepend, not append:** concat `[card][main]` using `_concat_copy` (stream-copy when profiles
  match) / `_concat_reencode` fallback, `_validate_concat`.
- **Non-fatal contract:** any failure -> return without the intro, never sink the export/share.

### Fidelity / renderer decision
**Pitch/position diagram is OUT** (user direction — dropped entirely). Focus effort on a
photo-forward, animated, premium look. Prototype with pure ffmpeg (`zoompan`+`xfade`+timed
`drawtext`); **if ffmpeg can't reach a premium feel**, evaluate a richer template renderer (headless
browser / Remotion-style HTML-to-video) before committing the card layout. Get a design pass on the
motion (timings, easing) — "looks professional" is the acceptance bar.

## Relevant files
- `src/backend/app/services/branded_outro.py` — copy the structure (`_build_outro_card`:195,
  `_probe_media`:141, `_concat_copy`:265, `_concat_reencode`:288, card cache, non-fatal contract)
- `src/backend/app/assets/fonts/DejaVuSans-Bold.ttf`; new intro accent PNGs under `app/assets/`
- Consumers wired in [T5220](T5220-add-intro-integration.md)

## Classification hint
L-tier: greenfield ffmpeg card composition, asset design, concat/caching. Backend-only. No schema
change. Depends on T5190 (fields+photo) and T5200 (cut-out). Architect + a design pass on the card
layout recommended.

## Acceptance criteria
- [ ] `build_intro_card` produces an **animated** MP4 (photo push-in + staggered text-in +
  white-flash out) from profile data — reviewed as "looks professional," not a static frame.
- [ ] Prepends `[card][main]` with probe-matched, validated concat; cached per format+content.
- [ ] Uses cut-out photo when available; non-fatal on any failure.
- [ ] No pitch/position diagram (dropped).
