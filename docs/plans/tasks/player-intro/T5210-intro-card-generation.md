# T5210: Intro card render engine

**Status:** TODO
**Impact:** 7 | **Complexity:** 6
**Epic:** [Player Intro + Rich Text](EPIC.md) — depends on [T5195](T5195-intro-card-library.md) (+ [T5180](T5180-rich-text-engine.md))

> Read [EPIC.md](EPIC.md) (decisions 5, 9, 10). Knowledge doc: `.claude/knowledge/export-pipeline.md`
> § branded outro + § T5240 — it records the exact ffmpeg landmines this task will otherwise rediscover.

## Reworked 2026-08-03

Previously: render one card from the profile's athlete fields with `drawtext`. Now: render **any
card document** from the library — an image plus N TextSpec elements placed in a template's slots —
with text rasterised by [T5180](T5180-rich-text-engine.md), not by `drawtext`.

## Problem

Turn an `intro_cards` row into an animated MP4 that can be prepended to a reel of any resolution,
fps and pixel format, cheaply enough to run on a download request.

## Scope

Build `app/services/player_intro.py`, mirroring `branded_outro.py`'s structure and contracts.

### A. Card composition

- `build_intro_card(card: dict, info: dict, out_path: str)` where `info` is the probe of the target
  reel (`_probe_media`, `branded_outro.py:177`) — width, height, fps, pix_fmt, sar.
- **Text is a pre-rendered RGBA PNG layer per element**, produced by
  `text_render.render_text_layer` (T5180). ffmpeg composites and animates the PNGs; it never draws
  a glyph. This is what makes the export match the editor preview.
- Templates: `hero-left`, `full-bleed`, `title-only` — background treatment, photo placement and
  slot geometry per template, defined in ONE place shared with the frontend's stage geometry.
- Photo: use `image_cutout_key` when present ([T5200](T5200-player-cutout.md)), else `image_key`.

### B. Motion (the deliverable, not a nicety — epic decision 10)

- Photo hero: slow push-in / Ken Burns (`zoompan`) so the kid is up close and central.
- Text: staggered fade / fade-up per element (alpha ramps on the PNG overlays).
- Exit: white flash into the footage.
- Timing constants live in one module and are the SAME numbers the browser motion preview
  ([T5205](T5205-card-editor-ui.md)) animates with. Two copies of these numbers will drift.
- Follow T5240's animated-outro vocabulary so intro, spotlight and outro feel like one system.

**Known ffmpeg landmines (from T5240 — do not rediscover):**
- `overlay` cannot composite an input whose size changes per frame — `scale=...:eval=frame` feeding
  it freezes on frame 0's size. PAD each scaled frame onto a constant-size canvas first.
- Filtergraph expression values are single-quoted, so do NOT also backslash-escape their commas.
- Apply the flash LAST so frame 0 is deterministic across ffmpeg builds.
- A luma-over-time test harness must read the FIRST `metadata=print` line, not the last.

### C. Concat and cache

- **Prepend**, not append: `[card][main]` via `_concat_copy` (stream-copy when profiles match) with
  `_concat_reencode` fallback, then `_validate_concat`.
- Cache the built card per **(card content hash x width x height x fps x pix_fmt x audio layout)**,
  atomic-rename into a temp dir, exactly like `_CARD_CACHE_DIR`. The content hash must cover every
  field that affects pixels — image key, template, every TextSpec, duration — so an edit invalidates
  the cache and nothing else does.
- Include a `_CARD_VERSION` constant and bump it whenever the renderer changes.
- The card is encoded ONCE per cache key, so animation is free at serve time.

### D. Contract

- **Non-fatal, always** (epic decision 9): any failure returns "no card" and logs loudly. It never
  raises into a download, share or export.
- Pure function of (card row, probe, R2 image) -> file. No DB writes, no R2 writes, no job rows.
  [T5220](T5220-add-intro-integration.md) owns the callers.

## Relevant files
- `src/backend/app/services/branded_outro.py` — copy the structure: `_probe_media`:177,
  `_build_outro_card`:241, `_concat_copy`:390, `_concat_reencode`:413, `_validate_concat`:435,
  the card cache and the non-fatal contract
- `src/backend/app/services/text_render.py` — from T5180
- `src/backend/app/assets/` — template background/accent assets

## Classification hint
L-tier, backend-only. No schema change. Architect gate on the template geometry contract (shared
with the frontend stage). Reviewer required. A visual pass on the motion is part of acceptance —
"looks professional" is the bar, and a static-looking card fails it.

## Acceptance criteria
- [ ] `build_intro_card` renders any library card into an MP4 that matches the editor preview's
      layout, fonts and colours.
- [ ] All 3 templates render correctly at 9:16 and 16:9.
- [ ] The card is animated (photo push-in + staggered text + white flash), reviewed as professional.
- [ ] Prepend concat is probe-matched and validated; stream-copy is used when profiles match.
- [ ] Cache key covers every pixel-affecting field; editing a card invalidates it.
- [ ] Cut-out image is used when present.
- [ ] Every failure path is non-fatal and logged.
- [ ] Motion timing constants are shared with the frontend preview, not duplicated.
