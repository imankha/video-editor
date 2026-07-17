# Epic: Clearest-Frame Posters

Make every link-preview image (og:image) the reel's/game's money shot, and roll it out to
prod across all share surfaces. The preview IS the pitch to a not-yet-user parent — a blurry
unfurl card weakens the share -> signup funnel.

## Background — what is ALREADY SHIPPED (merged 2026-07-12, commit 175f6253; do not rebuild)

- `extract_clearest_frame_jpeg` in [poster.py](../../../src/backend/app/services/poster.py):
  samples one frame at 15/30/50/70/85% of the clip (`CANDIDATE_POSITIONS`, skips fade
  extremes), JPEG-encodes each, keeps the **LARGEST** encoding. **Rationale: JPEG size tracks
  detail — motion blur and defocus compress away high-frequency content, so the biggest
  encoding is the crispest candidate.** ~5 fast ranged seeks + 5 single-frame encodes per
  reel; no ML, sub-second, runs ONCE per reel at publish. Falls back to first-frame on ffprobe
  failure.
- `generate_and_store_poster` uses it — all NEW reels get clearest-frame posters.
- `backfill_posters(limit, dry_run, force)` — `force=True` REGENERATES posters for all
  published reels in place (deterministic key, overwrite; no schema change). Admin endpoint:
  `POST /api/admin/backfill-share-posters?limit=N&force=true`.
- og:image mechanism + unfurl hardening from **T4890** (v024 `poster_filename` migration).
- STAGING: force regeneration run 2026-07-12 (~32 published reels) with the whole-clip heuristic.

## Shared design decisions (children reference these — do NOT duplicate)

1. **Poster policy by artifact type:**
   - **Reels** (have per-clip `segmentSpeeds`): clearest frame within the **first half of the
     first slow-mo section** in the FINAL (stretched) timeline; **no slow-mo anywhere -> plain
     first frame** (NOT whole-clip sampling). [T5090]
   - **Game/teammate recaps** (`recaps/{game_id}.mp4`, a stitched artifact with no per-segment
     slow-mo data): **whole-clip clearest-frame** (the already-shipped 5-sample heuristic).
     Do NOT attempt slow-mo reconstruction for recaps. [T5180]
2. **poster.py is the single home** for frame selection; reuse the source->final time mapping in
   [highlight_transform.py](../../../src/backend/app/highlight_transform.py)
   (`get_segment_speed`, `canonicalize_segments_data`, segment-walk / effective-duration) — do
   not reinvent it.
3. **No silent wrong data** (project rule): missing/unparseable `segments_data`, empty window ->
   first frame, logged at info; never fabricate a slow-mo region. Poster failure NEVER fails the
   export (existing invariant).
4. **One prod force-regen, final policy.** The regen (T4950) runs AFTER the slow-mo-first
   heuristic (T5090) lands, so prod posters reflect the final policy and the two regens never
   fight. Re-run staging regen with the final policy before prod.
5. **Never presigned URLs in og:image** (T4890 cache-poisoning lesson): share posters are served
   through stable token-gated proxies (`_serve_poster_jpeg` in shares.py), not signed R2 URLs.

## Optional tuning (only if staging visual QA shows misses)

`CANDIDATE_POSITIONS` and JPEG `-q:v` are module constants in poster.py. If the size heuristic
picks a busy-but-irrelevant frame (e.g. crowd pan), candidates: center-crop weighting, or bias
toward frames where the spotlight-overlay region has motion. Do NOT reach for scene-detection/ML
— cost is not justified at this image size.

## Child tasks (implement in order)

| Order | Task | What it does |
|-------|------|--------------|
| 1 | T5090 — Slow-mo-first reel poster | DONE (deployed 2026-07-16 prod). Rescope reel poster selection to the first half of the first slow-mo section (final timeline); no slow-mo -> first frame. Multi-clip offsets + trimRange + backfill reconstruction. |
| 2 | T5180 — Game/teammate recap footage on links | DONE (deployed 2026-07-16 prod). Poster game recaps with the whole-clip clearest-frame helper; new token-gated `/poster.jpg` endpoint + teammate edge function; branded card as no-recap fallback. |
| 3 | T5270 — Warm recap poster at share creation | DONE (deployed 2026-07-16 prod). Warm `ensure_recap_poster` at teammate-share creation (gesture) so the first crawler hit is never cold; on-demand GET stays as self-heal fallback. |
| 4 | T5280 — Capture share poster at Move to My Reels | DONE (deployed 2026-07-16 prod). Move poster JPEG capture from render (finalize) to the publish gesture; render keeps only the v025 slow-mo-section freeze. |
| 5 | T4950 — Prod rollout + verify | TODO — now unblocked (T5090+T5180+T5270+T5280 all deployed 2026-07-16). Single prod force-regen of reel posters, verify all surfaces (reel, collection, teammate) with `verify_share_unfurl.py`, confirm `og-card.jpg` serves image/jpeg. |

Sequencing: T5090 first (defines the final reel policy). T5180 reuses the shipped whole-clip
helper and is independent of the reel-heuristic change. T5270/T5280 (added 2026-07-16, capture
timing refinements) landed after both. T4950 remains the terminal deploy+regen+verify pass --
deliberately NOT auto-run by the deploy reconciliation (it force-regenerates prod data and needs
its own explicit go-ahead).

## Epic completion criteria

- [x] Reels WITH slow-mo -> poster is the clearest frame in the first half of the first slow-mo
      section (correct multi-clip offset + trimRange); reels WITHOUT slow-mo -> first frame.
- [x] Game/teammate links unfurl with a real recap frame (whole-clip clearest) when a recap
      exists, branded card when not.
- [x] Live publish and admin backfill/force-regen apply the SAME policy; missing data -> first
      frame (logged, no fabrication).
- [ ] Prod posters regenerated once with the final policy (0 failed); `verify_share_unfurl.py`
      passes 3/3 on a prod reel, collection, and teammate link; `og-card.jpg` serves image/jpeg.
      (T4950 -- not yet run.)
- [x] Poster failure never fails export. Tests pass.
