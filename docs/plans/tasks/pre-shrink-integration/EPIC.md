# Pre-Shrink Integration

**Status:** TODO
**Started:** 2026-09-08
**Impact:** 7 | **Complexity:** 5 (aggregate)

Epic 2 of 2 in the **Video Pre-Shrink** milestone. **Blocked by
[Pre-Shrink Research](../pre-shrink-research/EPIC.md) in full** - no task here starts
until that epic's completion criteria are ticked and its hand-off note is written.

## Goal

Bring the proven standalone shrink pipeline into the app: port `scripts/shrink-tool/
pipeline/` into an in-app worker (T8845), build the offer + crop step UI in the Add Game
flow (T8850), and run the shrink inside the upload queue with an honest fallback (T8860).
The three tasks were originally filed inside the Universal Upload & Angles epic (as its
5/12-7/12 shrink track) and were MOVED here on 2026-09-08 when the research was split out;
their IDs, content and history are unchanged - only their folder, their links, and their
dependencies (now on the research epic) changed.

## Decision record

- **2026-09-07 (user direction, Universal Upload epic):** no shrink integration until the
  whole pipeline works completely as a separate browser tool. T8840 became that tool;
  T8845 was filed as the port.
- **2026-09-08 (this milestone):** the research still open around the tool (real-folder
  acceptance, auto-crop quality, all-source benchmark, cost model, tweening) is finished
  FIRST as its own epic; integration follows as a port of what the research settles.
  Consequences for the three tasks here:
  - T8845 ports whatever `pipeline/` contains at the end of research (possibly a
    `decision.js` from T9050 and `cropPath.js` from T9060), not the T8840 snapshot.
  - T8850's offer gating uses T9050's `decideShrink` rule instead of the two constants
    (`SHRINK_OFFER_MIN_BYTES` / `SHRINK_OFFER_MIN_BITRATE`); its crop step shows
    per-segment automated crops (and a moving rect if T9060 says so), not "one static
    rect".
  - T8860's Modal fallback is bounded by T9050's cost rule.
- Design decisions that still govern the UI and copy live in the Universal Upload epic:
  [../universal-upload/EPIC.md](../universal-upload/EPIC.md) decisions 2, 4, 5, 6 and the
  approved artifact screens E + F. This epic does not restate them.

## Tasks (strict order; each hands to its own agent)

| ID | Task | Impact | Cmplx | Pri | Status |
|----|------|--------|-------|-----|--------|
| T8845 | [Port the approved standalone shrink tool into the app (worker + client API)](T8845-port-shrink-tool-into-app.md) | 7 | 4 | 1.8 | TODO |
| T8850 | [Shrink UI: offer card + crop step + presets](T8850-shrink-ui-crop-step.md) | 7 | 5 | 1.4 | TODO |
| T8860 | [Shrink upload integration + fallback](T8860-shrink-upload-integration.md) | 7 | 5 | 1.4 | TODO |

## Why this order

T8845 -> T8850 -> T8860 is a hard dependency chain: the UI needs the worker's client API;
the upload integration needs the UI's `shrinkPlan` payload. Same order as originally
filed.

## Shared context for every child task

- Read the research epic's hand-off note before starting: it lists what changed under
  `scripts/shrink-tool/pipeline/` after T8840 merged and which numbers (Sharp timing,
  estimator error, decision boundaries) the UI copy must use.
- Moves are mechanical commits; behaviour change never mixes with code motion.
- The shrunk file goes through the UNTOUCHED normal upload path (hash, probe, T1380
  faststart, activate) - the backend sees a plain video file.
- Any shrink error falls back to uploading originals with a toast and loud logging;
  never a dead end, never a double credit charge (credits from ACTUAL uploaded bytes).
- Gesture-based persistence only; the shrink runs inside the upload the user started.
- Knowledge docs to load: `.claude/knowledge/export-pipeline.md` (upload/R2 refs),
  `.claude/knowledge/modal-gpu.md` (fallback), `.claude/knowledge/persistence-sync.md`.

## Completion Criteria

- [ ] T8845, T8850, T8860 merged in order; each with its curated test set green
- [ ] A >3 GB high-bitrate upload on a capable browser gets a working crop + preset
      shrink that uploads (carried from the Universal Upload epic's criteria)
- [ ] Manual e2e on the real DJI folder recorded (T8860)
- [ ] Knowledge docs updated (export-pipeline.md for the upload path change; a shrink
      section or new doc if the worker warrants one)
