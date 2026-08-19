# T5530: Feed Alignment — Autosync Cascade + Line-Up View

**Status:** TODO
**Impact:** 7
**Complexity:** 8
**Created:** 2026-07-19
**Updated:** 2026-08-19

## Problem

Every feed (full camera or short phone clip) must land on the pool's shared game clock —
`wall_offset` per video — with an **honest confidence, never a fabricated offset**. Audio
is sometimes missing, `creation_time` is sometimes missing or lies (export-render stamps),
and device clocks drift. The algorithm, evidence, and verdict rules are fully specified in
[ALIGNMENT.md](ALIGNMENT.md) — that document is normative; this file is the task wrapper.
The manual/confirm UI is [UX-SPEC.md §7](UX-SPEC.md) + §6's line-up mode.

## Solution

### A. Auto-alignment (Modal, per ALIGNMENT.md — implement the cascade, don't re-derive it)

1. **Per-source artifacts** (`alignment/{blake3}.msgpack` in R2, computed ONCE per blake3
   at feed activation, content-addressed like movement profiles): onset envelope (100 Hz,
   band-passed 300–3000 Hz), Shazam-family fingerprints, `audio_present`, normalized
   `creation_time` (Apple-atom preference, tz heuristics, file-open/close detection),
   duration. The envelope is also what §7's waveform strips render.
2. **Metadata candidate window** — cheap prior, never a verdict: ±10 min when both sides
   have recording-time stamps; full-duration search otherwise. **The export-time-vs-
   recording-time classifier is load-bearing**: stamps implying an impossible timeline vs
   durations (overlap, or inter-file gap < file duration) are usable for ORDERING only,
   never to seed windows or offsets (ALIGNMENT § Half-order evidence — every prod
   half-pair had export-render stamps).
3. **Coarse match:** fingerprint hash-join restricted to the window; modal 0.1s offset
   bin; confidence gates `matched ≥ 8` AND `modal/second ≥ 3×`.
4. **Fine:** GCC-PHAT on the envelopes, ±2 s window, parabolic interpolation.
5. **Cross-validation/transitivity:** match against every already-aligned feed; agreement
   ≤1 s upgrades confidence, disagreement caps at `medium` and logs the pair matrix.
6. **Verdict ladder (what gets written)** — implement ALIGNMENT §6 exactly: auto /
   auto-low (badged, excluded from Main) / metadata / explicit low-prior 0 for no-signal
   full feeds / **NULL for no-signal clips (parked unplaced — never fabricated)** /
   `manual` is authoritative and NEVER overwritten by auto re-runs.
7. **Compute placement:** Modal CPU fn `align_feed(pool_id, feed_id)`, **colocated with
   the upcoming mov-atom probe app** (future merged probe+analyze is a refactor, not a
   re-architecture), dispatched from feed activation (T5520). Failure marks the job and
   falls to the metadata/no-signal rows — alignment never blocks upload/activation.
8. **Folder segments:** only segment 1 aligns; the chain is arithmetic
   (`offset(N+1) = offset(N) + duration(N)`); a detected recording gap splits into
   separately-aligned parts, never silently bridged.

### B. Line-up view (§7) + timeline line-up mode (§6)

- Modal `max-w-3xl`: side-by-side players (RIGHT = the feed being lined up; LEFT = **any
  already-lined-up camera via a selector chip** — offsets compose transitively, the
  comparison choice is never persisted), shared lockstep scrub, **waveform strips** under
  both players drawn from the cached envelope (sliding live with the nudge; hidden when
  EITHER side lacks audio — never one strip alone), nudge row (±1s/±0.1s + monospace
  readout + `Play 1s` simultaneous-audio test), banners per state (auto-success
  "Auto-synced by sound…" — the ONE permitted "sync" string / failed / running /
  no-audio "line it up by eye").
- **Short-clip variant:** reference scrubs freely; the clip is a fixed strip looping its
  own duration; nudge clamped to ±(clip length + margin).
- Mobile: A/B toggle over one player (portrait); side-by-side only in landscape (T4933).
- Entries: ONLY the §6 unaligned badge and Manage cameras → "Line up this camera…" (§10).
- §6 line-up mode (desktop drag with floating confirm bar) is entered exclusively from
  §7's "Adjust on the timeline" link.
- Concurrency: last write wins; the superseded members get the derived on-load toast
  (§6 states); no conflict UI.

### C. Persistence

The ONLY offset write is the confirm gesture — "They're lined up" (modal or line-up-mode
bar): `POST /api/pools/{id}/feeds/{feed_id}/offset {wall_offset}` → `offset_source =
'manual'`, stamping `offset_updated_by/at` (drives the derived toast). Nudges, scrubs,
drags, and comparison-side choice write nothing. Auto verdicts are written by the Modal
job with `offset_source`/confidence per the ladder. Validation protocol = ALIGNMENT §8
(synthetic truth ±0.2 s, ≥3 real hand-labeled pairs, negative controls must produce NO
offset, wind/silence stress lands ≤ medium) — acceptance-gating, not optional.

## Context

### Relevant Files (REQUIRED)
- NEW Modal app/fn `align_feed` (colocated with the mov-atom probe app — see [modal-gpu.md](../../../../.claude/knowledge/modal-gpu.md)); artifact read/write in R2
- NEW `src/backend/app/services/audio_fingerprint.py` — envelope + constellation fingerprints + GCC-PHAT (~200 lines numpy/scipy, pure functions, unit-testable without media)
- `src/backend/app/routers/pools.py` — offset confirm endpoint + verdict fields on `GET /{id}`
- `src/backend/app/routers/games_upload.py` — activation dispatch (T5520 seam)
- NEW `src/frontend/src/components/LineUpModal.jsx` (§7, incl. short-clip variant + waveform strips)
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` — §6 line-up mode (drag + confirm bar) and unaligned-badge entry
- `src/backend/tests/test_audio_fingerprint.py`, `tests/test_alignment_verdicts.py` — NEW

### Related Tasks
- Depends on: T5520 (registered feeds + activation dispatch), T5495 (`creation_time` parse feeds the metadata prior)
- Blocks: T5540 (lanes need offsets + badges), T5550, T5560
- References: [ALIGNMENT.md](ALIGNMENT.md) (normative — cascade, ladder, evidence, validation), UX-SPEC §7 (all copy/states), §6 advanced interactions, [EPIC.md](EPIC.md) decision 4

### Technical Notes
- Knowledge docs: [modal-gpu.md](../../../../.claude/knowledge/modal-gpu.md), [backend-services.md](../../../../.claude/knowledge/backend-services.md)
- L-tier → Architect design gate: artifact schema versioning, Modal app placement vs the
  probe app's timeline, offset endpoint granularity (**flag: UX-SPEC §7 writes per-FEED;
  the registry stores `wall_offset` per-VIDEO (`sequence`) — the confirm for a multi-video
  half-pair feed must define which videos move; see epic reconciliation notes**)
- Probe/backfill jobs must tolerate registry rows whose R2 object is gone (expired 404s —
  observed on half the prod multi-video games)
- Gesture-based persistence: confirm gestures named above are the only human writes;
  no reactive writes from players/scrub/drag. Migrations never auto-run
- Real-browser verification required for §7 (players, waveforms, nudge) and §6 drag —
  jsdom false-confidence rule

## Implementation

### Steps
1. [ ] Architect design gate (artifact schema, endpoint granularity, Modal placement)
2. [ ] `audio_fingerprint.py` + unit tests on synthetic known-offset fixtures (±0.2 s; excerpt ±0.3 s; negative controls)
3. [ ] Modal `align_feed`: artifact build + cascade + verdict writes; activation dispatch
4. [ ] Verdict ladder end-to-end (badges/exclusion data on `GET /{id}`; NULL clips park unplaced)
5. [ ] §7 LineUpModal (+ short-clip variant, waveform strips, comparison selector) + §6 line-up mode + confirm write
6. [ ] ALIGNMENT §8 validation run — publish the pair matrix in the task log
7. [ ] Tests: verdict rows, manual-never-overwritten, transitive composition, segment chaining, concurrency LWW

## Acceptance Criteria

- [ ] Synthetic truth recovered within ±0.2 s (excerpts ±0.3 s); ≥3 real hand-labeled pairs pass; two different games produce NO offset; wind/silence lands ≤ medium (ALIGNMENT §8, evidence in task log)
- [ ] Verdict ladder written exactly: low-confidence badged + excluded from Main; no-signal clips NULL/unplaced; no-signal full feeds explicit low-prior 0; `manual` never overwritten by auto
- [ ] Per-source artifacts computed once per blake3 and reused (12th feed = one decode + hash joins); alignment failure never blocks activation
- [ ] §7 works per spec: transitive comparison against any lined-up camera, waveform strips from the cached envelope, short-clip clamped variant, no-audio state; the confirm click is the only write
- [ ] Line-up entries are exactly the unaligned badge + Manage cameras row; LWW concurrency with the derived stale-view toast
- [ ] Unit + verdict tests pass; real-browser verification done
