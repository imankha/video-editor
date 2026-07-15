# T5200: Player cut-out ("player outline") — background removal for the intro photo

**Status:** TODO
**Impact:** 6 | **Complexity:** 5
**Epic:** [Player Intro](EPIC.md) — child 2 of 5
**Requested:** user 2026-07-15 ("offer the option to make the player outline like the one in the video")

> Read [EPIC.md](EPIC.md) for context. This is the OPTIONAL cut-out treatment that makes the
> uploaded photo look like the reference card, where the player is segmented out of their original
> background and composited onto the gold card.

## Problem

In the reference intro the player is a clean **cut-out** (background removed) floating on the card
background with the tiled-name watermark behind them. The user wants to **offer the option** to
auto-produce that look from a normal uploaded photo. No image processing exists in the codebase
today (posters are extracted video frames; Modal only does framing/overlay/upscale on video).

## Scope

- Add an **"Cut out player / remove background"** option in the Add-Player-Intro photo step
  ([T5190](T5190-athlete-profile-fields-photo.md)). When enabled, produce a transparent-background
  PNG of the player and store it as `photo_cutout_key`
  (`{APP_ENV}/users/{uid}/profiles/{pid}/intro/photo_cutout.png`).
- The intro card ([T5210](T5210-intro-card-generation.md)) uses `photo_cutout_key` when present,
  else the raw `photo_key`.

## Approach (recommendation)

- **Server-side segmentation model** (rembg / u2net-class, or an equivalent matting model). Runs
  once per photo, on demand (a gesture), output cached in R2. CPU is acceptable at this frequency;
  if too slow, run on Modal alongside the existing GPU functions
  (`app/modal_functions/`) — but a still-image matte is light, prefer CPU first.
- **Fallback:** let the user upload an already-cut-out transparent PNG directly (power users /
  when auto-matte is poor).
- **Optional polish:** a subtle stroke/outline or drop-shadow around the cut-out edge (the
  reference edge is clean; a thin stroke reads well on busy backgrounds) — via ffmpeg/ImageMagick
  edge compositing. Keep as a v1.1 nicety.

## Compliance guardrail (EPIC decision #4)

This is **image segmentation/matting, NOT face recognition** — it does not build a facial template,
so it stays clear of the 2025 COPPA biometric definition and BIPA-class laws. Do **not** add any
face-detection/recognition step. Document this explicitly in the implementation.

## Relevant files
- `src/backend/app/storage.py` (R2 helpers, per-profile prefix)
- New image service (greenfield) under `src/backend/app/services/`
- `src/backend/app/modal_functions/` (only if matte is moved to GPU)
- Frontend: the Add-Player-Intro photo step from [T5190](T5190-athlete-profile-fields-photo.md)
  (toggle + preview of the cut-out)

## Classification hint
M/L-tier: new dependency (segmentation model), a new image endpoint, frontend toggle+preview.
No schema change beyond `photo_cutout_key` (added in T5190). Depends on T5190's photo pipeline.

## Acceptance criteria
- [ ] User can toggle "cut out player"; a transparent-bg PNG is produced and previewed.
- [ ] Cut-out cached at `photo_cutout_key`; intro card prefers it over the raw photo.
- [ ] Upload-your-own-PNG fallback works.
- [ ] No face-recognition/biometric templating anywhere in the path (documented).
