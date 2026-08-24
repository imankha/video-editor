# T4350: Re-Export Must Re-Transform Carried-Forward Highlights

**Status:** DONE (deployed 2026-08-24 prod)
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [write-correctness](EPIC.md) · Audit item B7

## Problem

When a framing export creates a new working_videos row, it carries the previous version's `highlights_data` forward **verbatim** (`routers/export/framing.py:234-254`). But a re-export exists precisely because trim/speed/segments changed — highlight region times are expressed in working-video seconds, so after a re-export they point at the wrong moments (or beyond the new duration). The user's carefully placed highlights silently drift off their targets.

Exposure: edit-reel → re-export is the retention loop T4110 hardened; this is the same flow producing subtly-wrong output instead of lost output.

## Solution

Decide, then implement, one of (write the decision + rationale in the Progress Log before coding):

- **(a) Re-transform (preferred if feasible):** map each region's times through the old→new timeline transform. The transform math exists — `transform_all_regions_to_working` is already imported in overlay.py; check whether the framing export has enough information (old segments vs new segments) to compose old-working→raw→new-working. If segments/trim data for BOTH versions is available at carry-forward time, this is deterministic.
- **(b) Drop + notify:** if the mapping is ambiguous (e.g., a highlighted moment was trimmed out), drop affected regions and surface "N highlights need re-placement" in the overlay screen rather than carrying wrong ones. Hybrid allowed: transform what maps cleanly, flag what doesn't.

Never carry verbatim when timing changed — that's the only banned outcome.

## Context

- Files: `src/backend/app/routers/export/framing.py:234-254`, `src/backend/app/services/highlight_transform.py` (read fully first — it owns raw↔working time mapping and has canonicalization history), `routers/export/multi_clip.py:1387-1415` (detection-seed writer, for contrast)
- Depends on understanding T4340's canonical segments format — implement after it if possible (transform math reads boundaries).

## Steps

1. [ ] Read highlight_transform.py + the carry-forward site; write the old→new mapping feasibility analysis in the Progress Log.
2. [ ] Tests first with concrete fixtures: trim moved by 2s → region moves by 2s; region inside a trimmed-out span → dropped/flagged; speed change → time scaling correct.
3. [ ] Implement chosen strategy; verify with a real re-export on dev (drive-app-as-user: place highlight → re-trim → re-export → highlight still on the action).

## Acceptance Criteria

- [ ] Re-export never carries verbatim highlight times across a timing change
- [ ] Mapped regions land on the same visual moment (manual dev verification recorded)
- [ ] Unmappable regions are dropped LOUDLY (user-visible), never silently wrong
- [ ] Fixtures cover trim-shift, trim-removal, and speed-change cases

## Progress Log

### Stage 1 — Code Expert feasibility (2026-08-22)

**PREMISE CORRECTION (task-changing).** The verbatim carry-forward site the task targets
(`routers/export/framing.py` `/framing` endpoint, ~L240-260) is a **DEAD PATH**. Verified:
- Frontend export never calls `/api/export/framing`. It calls `/api/export/multi-clip`
  (multi-clip) and `/api/export/render` (single-clip); overlay burn-in is `/api/export/render-overlay`
  (`ExportButtonContainer.jsx:569,627,684`).
- No backend caller of `export_framing` either (only a quest-step *string* `"export_framing"` and a
  poster comment reference the name).

**The REAL behaviour on the live paths is NOT drift — it is DISCARD.** Both live framing
finalizers run FRESH detection and overwrite highlights:
- `/render` → `_run_render_background` → `services/export_finalize.finalize_export` (:198):
  `run_player_detection_for_highlights` (:289), fallback `generate_default_highlight_regions` (:299),
  then `upsert_working_video(highlights_data=encode_data(regions))` (:305).
- `/multi-clip` local branch: `multi_clip.py:1774-1800` — same fresh-detect-then-upsert shape.
- `upsert_working_video` (`export_finalize.py:98-195`) INSERTs a NEW `working_videos` row (MAX(version)+1)
  with the freshly-detected `highlights_data`. It NEVER reads the prior version's `highlights_data`.

So a framing re-export after the user has edited highlights in Overlay **throws those edits away**
and reseeds auto-detected/default 2s regions — a *different, arguably worse* bug than the timing
drift the task describes.

**Feasibility of option (a) full re-transform against the REAL path:**
- User highlight edits live ONLY in `working_videos.highlights_data`, in working-video seconds.
  `transform_all_regions_to_raw` has **ZERO production callers** (grep) — edits are never written
  back to per-clip raw space, so there is no raw-space source to re-project from.
- OLD highlights ARE readable at finalize time (project.working_video_id still points at the old
  wv before repoint). To transform old-working→raw→new-working you need OLD *and* NEW per-clip
  `segments_data`+`crop_data`+dims. NEW = current latest `working_clips`. OLD = a *previous*
  `working_clips` version row — but there is **no linkage** from a `working_videos` version to the
  set of `working_clips` versions it was rendered from (independent version counters, no snapshot).
- Multi-clip has **no per-clip attribution** on highlight regions (region schema =
  `{id,start_time,end_time,enabled,keyframes,detections,...}`, all times in concatenated
  working-video seconds) and the transform fns are single-clip + concat-offset-unaware. Mapping a
  video-second T through per-clip transforms needs attribution + old/new concat-offset math that
  does not exist today.

**Transform contracts** (`app/highlight_transform.py`, NOT `services/…`):
`transform_all_regions_to_raw(regions, crop_keyframes, segments_data, working_video_dims, framerate=30.0)` (:909),
`transform_all_regions_to_working(raw_regions, crop_keyframes, segments_data, working_video_dims, framerate=30.0)` (:935).
Out-of-range regions are DROPPED (return None); partial start/end clamps to the visible trim boundary.
Neither canonicalizes internally — caller MUST `canonicalize_segments_data(decoded, source_duration)` first.

**Verdict:** Option (a) is NOT feasible as-is on the live path (no old↔new per-clip framing linkage;
no multi-clip attribution). The task must be re-scoped against the live finalizers, and the
product/scope question ("is the intended fix: stop DISCARDING overlay-edited highlights on framing
re-export, and if so transform-or-drop them?") is a user decision. Full report retained by the
Code Expert agent.

### Stages 2-8 — implemented (2026-08-23)

Design approved (L1+L2, single-clip-first; multi-clip loud fallback -> follow-up **T4355**).
Implemented, reviewed (APPROVED, no blocking/major), and tested:

- **`services/highlight_carry.py`** — pure `resolve_carried_highlights` decision + single-clip
  OLD->raw->NEW transform composition; verbatim fast-path; `dropped:N`/`multiclip_reset`/
  `legacy_uncertain` notes; preserves region metadata.
- **`upsert_working_video`** — carry decision on INSERT branch only; UPDATE/resume preserves the
  carry columns (recovery-safe idempotency). `finalize_export` reads the snapshot from job input_data.
- **Framing snapshot** captured at export START in `_export_clips._build_framing_snapshot` (frame-based
  crop + canonical segments + render dims), threaded via job input_data + `_persist_rendered_checkpoint`.
- **profile_db v046** (+ database.py DDL twin): `working_videos.framing_snapshot` + `highlight_carry_note`,
  no backfill.
- **Notice**: export-complete toast + persistent dismissible Overlay banner (`highlight_carry_note`).

**Test evidence:** new `test_t4350_highlight_carry.py` (decision matrix + trim-shift/trim-removal/
speed-change/metadata) + `test_t4350_carry_finalize.py` (carry-through-DB + resume idempotency);
relevant backend set (transform + finalize + recovery + overlay + migration) all green; frontend
`highlightCarryNote.test.js` + `useHighlightRegions` suites green; eslint 0 errors; `from app.main import app` OK.

**QA note:** the live visual-placement acceptance check (place highlight -> re-trim -> re-export ->
confirm the highlight lands on the same action + the notice fires) requires the staging stack (GPU
export + a real account with an exported project) and is NOT runnable in the headless container
worker. Deferred to staging per CLAUDE.md ("staging IS the test phase") — supervisor to verify post-merge.
