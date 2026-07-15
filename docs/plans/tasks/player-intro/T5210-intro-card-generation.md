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
- `build_intro_card(info, probe, out_path)` — compose the card with `ffmpeg`:
  - Gold background (`-f lavfi color`), player **name tiled as a faint watermark**, diagonal
    hazard-stripe accents (overlay PNGs or drawbox), the **stats panel** (drawtext, absolute
    `fontfile=` — Fly image has no fontconfig; reuse `app/assets/fonts/DejaVuSans-Bold.ttf`),
    and the **cut-out player photo** (`overlay`), ending on a **white-flash** out.
  - Use `photo_cutout_key` when present, else `photo_key`.
- **Probe-match the target** via `_probe_media` (branded_outro.py:141) so the concat is clean
  (width/height/fps/pix_fmt/sar); cache per (resolution×fps×format×profile-content-hash) like the
  outro card cache.
- **Prepend, not append:** concat `[card][main]` using `_concat_copy` (stream-copy when profiles
  match) / `_concat_reencode` fallback, `_validate_concat`.
- **Non-fatal contract:** any failure -> return without the intro, never sink the export/share.
- Optional `zoompan` Ken Burns on the photo.

### v1 fidelity (EPIC open decision)
**Recommend v1 = static/lightly-animated card** (bg + watermark + hazard accents + stats panel +
cut-out photo + white-flash out). The **animated position-pitch diagram is a fast-follow**
(templated animation is materially heavier); leave a clean seam for it. Confirm scope before build.

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
- [ ] `build_intro_card` produces an MP4 matching the reference card layout from profile data.
- [ ] Prepends `[card][main]` with probe-matched, validated concat; cached per format+content.
- [ ] Uses cut-out photo when available; non-fatal on any failure.
- [ ] Animated-pitch seam left for the fast-follow.
