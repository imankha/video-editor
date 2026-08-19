# T5498: Crop Before Upload — Full-Screen Client-Side Crop Stage

**Status:** TODO
**Impact:** 6
**Complexity:** 7
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

High-res sports footage (DJI 5.3K/8K class) is mostly sky, ceiling, and empty stands —
the user pays upload time and storage credits for pixels nobody will ever frame. The
T5650 study (docs/plans/research/T5650-dji-8k-ingest-reduction-study.md) sized this:
cropping acquisition waste at ingest is the single biggest cost lever for giant sources.

## Solution

Implement [UX-SPEC.md §5b item 2](UX-SPEC.md) (normative; mock 6b in the session mockups
artifact): a **full-screen, all-client-side crop stage** in the upload flow.

1. **Gate:** picking a **≥4K** source expands into the dedicated full-viewport stage
   (`fixed inset-0 z-50 bg-gray-900`) — a thumbnail-sized crop control on 5.3K footage is
   unusable.
2. **Crop UI:** large preview filling available height; draggable/resizable crop rectangle,
   **16:9-locked**, Framing's crop-handle idiom + dim-outside-crop treatment. ONE static
   crop for the whole upload — acquisition correction, not creative framing (T5750 family).
3. **Filmstrip sanity-scrub:** sampled thumbnails across the recording along the bottom;
   the rectangle stays fixed while the preview scrubs (check kickoff, midfield, the far
   goal before committing).
4. **Why-line** above the savings: *"Cropping out unused pixels — sky, ceiling, empty
   stands — makes the video smaller, which lowers your storage and upload cost."*
5. **Live savings line, recomputed continuously** as the rect changes (estimate ∝
   kept-pixel fraction of source bitrate): `Upload cropped — {newSize} GB · {n} credits
   (was {oldSize} GB · {m} credits)`. Dragging visibly moves the number.
6. **On-device re-encode:** decode → crop → re-encode via **WebCodecs**
   (hardware-accelerated) inside the upload pipeline. No uncropped byte leaves the
   machine; **the CROPPED output is the master** — it is what gets hashed (blake3),
   uploaded, and charged. Audio passes through untouched (alignment artifacts are
   computed on the cropped master and are unaffected — ALIGNMENT.md § Crop-before-upload
   interaction).
7. **Honest fallback:** when the browser can't encode (codec matrix from the T5650
   browser-ceiling spike), the stage says so plainly and offers **upload uncropped with
   the ROI stored** for server-side crop at the first Modal touch — never a silent
   degradation, never a fake "cropped" claim.
8. Footer: `Apply crop & continue` (success) / `Upload uncropped` (ghost) / back — the
   stage never traps (§5b cancel table).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameDetailsModal.jsx` — ≥4K gate + stage entry (post-T5495 modal)
- NEW `src/frontend/src/components/upload/CropBeforeUploadStage.jsx` (+ WebCodecs pipeline module, e.g. `src/frontend/src/services/cropEncode.js`)
- `src/frontend/src/services/uploadManager.js` — pipeline order becomes encode → hash → multipart upload for cropped sources
- `src/frontend/src/utils/videoMetadata.js` — resolution detection for the gate (rides T5495's parser)
- `src/backend/app/routers/games_upload.py` — fallback path: accept `crop_roi` on finalize, stored for server-side crop
- Modal side (fallback only): first-touch crop applied by the existing Modal processing entry — see [modal-gpu.md](../../../../.claude/knowledge/modal-gpu.md); no new Modal app

### Related Tasks
- Depends on: T5495 (reworked Add Game modal + metadata parser)
- Prerequisite validation: **T5650 study's browser-ceiling spike** (docs/plans/research/T5650-dji-8k-ingest-reduction-study.md) governs feasibility limits — codec support matrix, throughput, memory; run/refresh the spike BEFORE committing to the WebCodecs path
- Part of [Game Pools epic](EPIC.md) but pool-independent; prepare-stage epic T5651–T5657 overlap — reconcile scopes when picked up
- ALIGNMENT.md § Crop-before-upload interaction — blake3 and alignment artifact are computed on cropped bytes; no special handling needed there

### Technical Notes
- Knowledge docs: [modal-gpu.md](../../../../.claude/knowledge/modal-gpu.md) (fallback crop), [export-pipeline.md](../../../../.claude/knowledge/export-pipeline.md) (resolve-source invariants)
- Everything before "Apply crop & continue" is local state — crop dragging, scrubbing, and
  the savings recompute write NOTHING. The upload submit remains the single write gesture
  (gesture-based persistence).
- The savings number is an estimate — label it as such in design if the recompute can't be
  honest; never show a precise-looking number derived from a guess (no silent fabrication)
- The fallback ROI must fail loudly if the server-side crop can't apply it at first Modal
  touch (no silent uncropped passthrough after promising a crop)
- Migrations never auto-run; if `crop_roi` needs a column (vs pending-upload payload), the
  Migration agent writes the versioned file, triggered via `POST /api/admin/migrate`
- Greppable names: `cropEncode`, `crop_roi` — one spelling everywhere

## Implementation

### Steps
1. [ ] Refresh/execute the T5650 browser-ceiling spike (codec matrix, 4K/5.3K throughput, memory) — go/no-go + fallback boundary
2. [ ] Architect design gate (pipeline order, ROI fallback storage, savings-estimate model)
3. [ ] Crop stage UI: rect + handles + dim-outside + filmstrip scrub + why-line + live savings
4. [ ] WebCodecs re-encode pipeline wired into uploadManager (cropped bytes → blake3 → multipart)
5. [ ] Honest fallback: capability detect → uncropped upload + `crop_roi` on finalize → server-side crop at first Modal touch
6. [ ] Tests: gate (≥4K only), savings recompute, pipeline unit tests; REAL-BROWSER verification of the encode path (jsdom lies about media)

## Acceptance Criteria

- [ ] A ≥4K pick opens the full-screen stage; sub-4K sources never see it
- [ ] Crop rect drag live-updates the size/cost line; filmstrip scrub verifies the crop at multiple moments
- [ ] Applied crop re-encodes on-device; the uploaded/hashed/charged bytes are the cropped master; audio intact
- [ ] Unsupported browser gets the honest fallback (uncropped upload + stored ROI, cropped at first Modal touch) with the limitation stated in the stage
- [ ] `Upload uncropped` and back navigation work at every point — the stage never traps
- [ ] Spike results recorded in the task log; tests + real-browser verification pass
