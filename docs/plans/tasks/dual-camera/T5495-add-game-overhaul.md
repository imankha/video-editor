# T5495: Add Game Overhaul — Optional Video, Folder Upload, Metadata-Ordered Role Chips

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

Add Game today (a) requires a video file, so a game can't exist before footage does
(share-first pools need exactly that — UX-SPEC §1.3), (b) asks a format quiz ("Video
Format: Full Game / Per Half") and then trusts the user's slot order blindly
(`uploadManager.js` ~L838: `sequence = i + 1`, no metadata check), and (c) can't ingest a
DJI/GoPro folder of split segments. The 2026-08-19 probe of every findable real multi-file
upload (ALIGNMENT.md § Half-order evidence) proves metadata orders these files correctly:
16/16 files had embedded `creation_time`, 8/8 ordered sets (all prod half-pairs + a DJI
4-segment chain) ordered right. The format question is answerable by the files themselves.

## Solution

Implement [UX-SPEC.md §5b](UX-SPEC.md) (normative — items 1, 4, and the cancel table) plus
the §1.3 share-first door. These are general upload features for everyone, deliberately
outside the pools' "zero new chrome" claim.

1. **Video optional at create.** Field label `Game Video (optional — add now or later)`;
   **"Add Game" enables once metadata fields are valid, with or without a file.** Without
   a file the game is created `awaiting video` and opens straight into §4b's no-video
   Annotate state (video area renders a setup panel — bug-27p expired-panel precedent in
   `AnnotateModeView.jsx` — with Upload video / Copy game link actions). Backend: the
   T1180 zero-video rejection (`games.py` ~L285) gets an awaiting-video exception —
   coordinate the exact shape with T5500 (§1.3 flags the pool case; §5b item 4 makes
   no-video creation general, so the exception cannot be pool-scoped only).
2. **Folder upload.** Dropzone accepts a folder (drag via `webkitGetAsEntry`; picker link
   `or pick a folder` via a `webkitdirectory` input). Companion `.LRF` files are detected
   per §5b item 1 (the preview-rendition slot itself lands with T7310 — see Technical Notes).
3. **Client-side mvhd `creation_time` parse** in `videoMetadata.js` — the upload path
   already reads every byte for hashing, so parsing the moov/mvhd atom is free.
   **`File.lastModified` is BANNED as a fallback** (it ordered a real half-pair wrong).
4. **The shipped ordering heuristic (evidence-backed, verbatim from ALIGNMENT.md):**
   sort files by creation-time stamp; contiguity (end N ≈ start N+1 within **±5s**) →
   `one recording — part i` (only camera-original stamps abut; export-time stamps fail
   closed into the halves branch); exactly **2 groups each >20 min** → `1st half` /
   `2nd half` in creation order (do NOT require similar durations — a real prod pair was
   33 vs 44 min; do NOT use gap size as a halftime check — export stamps carry artificial
   ~14-min gaps); missing/equal stamps → selection order, chips shown, no blocking
   question. Export-time-semantics classifier: a stamp set implying an impossible timeline
   vs durations (overlap, or inter-file gap < file duration) is usable for ORDERING only.
5. **Editable role chips.** Any multi-file selection renders as an ordered list — drag `≡`
   reorder, per-row role chip (`one recording — part {i}` / `1st half` / `2nd half` /
   `full game` / `clip` / `unassigned` with selector), X to remove. Files >20 min infer
   full/half; short files infer `clip`. **Metadata proposes, the user disposes** — never
   silent concatenation of different recordings.
6. **"Video Format" segmented control REMOVED outright.** A folder is an input method,
   not a format; Per Half is rolled into role inference.
7. **Cancel at every stage** per the §5b table: pre-upload row X / `Clear selection`;
   mid-upload `Cancel upload` two-tap riding the existing `DELETE /api/games/upload/{sid}`
   pending-uploads rail (no charge — charge happens at activation); post-activation =
   existing delete flow.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameDetailsModal.jsx` — optional-video validity, folder dropzone, role-chip list, Video Format removal
- `src/frontend/src/services/uploadManager.js` — `uploadMultiVideoGame` (~L838 `sequence = i + 1`): sequence now comes from the ordered role list
- `src/frontend/src/utils/videoMetadata.js` — NEW mvhd `creation_time` parser + ordering/contiguity heuristic (pure, unit-tested)
- `src/frontend/src/screens/ProjectsScreen.jsx` — awaiting-video tile state entry (§4 "No video yet" tile row)
- `src/frontend/src/modes/AnnotateModeView.jsx` — §4b no-video setup panel (bug-27p panel precedent; see `AnnotateModeView.expired.test.jsx`)
- `src/backend/app/routers/games.py` — `create_game` T1180 exception (~L285)
- `src/backend/app/routers/games_upload.py` — finalize accepts role/sequence from the ordered list; cancel rail unchanged

### Related Tasks
- Part of [Game Pools epic](EPIC.md) but pool-independent; must land **before T5510** (the pool "Add your camera" modal is a trimmed variant of this reworked modal — UX-SPEC §5)
- Coordinate: T5500 (T1180 awaiting-video exception shape), T5498 (crop stage inserts into this modal's flow), T7310 (`.LRF` rendition slot), prepare-stage epic T5651–T5657 (reconcile scopes — §5b pulls its locked decisions forward)
- Orthogonal: T7280 (single short clip → Framing) is unchanged

### Technical Notes
- Knowledge docs: [annotate.md](../../../../.claude/knowledge/annotate.md), [backend-services.md](../../../../.claude/knowledge/backend-services.md)
- Evidence basis: [ALIGNMENT.md § Half-order & creation-time evidence](ALIGNMENT.md) — read before touching the heuristic; the two stamp-semantics classes are load-bearing
- `.LRF` handling: detect + surface the quiet confirm line per §5b; whether the bytes upload now or wait for T7310's rendition slot is an architect call at design — do not build a parallel proxy store here
- Gesture-based persistence: "Add Game" click is the ONLY write gesture; folder pick, ordering, chip edits are local state; cancel-mid-upload's confirm tap is the abort gesture
- Migrations never auto-run (admin endpoint); this task should need none — awaiting-video is an absence of `game_videos` rows, not new schema (architect confirms)
- Greppable names: role constants live in one `constants/` module, string literals near use

## Implementation

### Steps
1. [ ] Architect design gate (L-tier: T1180 exception shape, awaiting-video state representation, heuristic module API)
2. [ ] `videoMetadata.js` parser + ordering heuristic with exhaustive unit tests (contiguity, halves, export-stamp classifier, missing stamps — use the ALIGNMENT.md evidence cases as vectors)
3. [ ] Modal: optional video + folder input + ordered role-chip list + Video Format removal
4. [ ] Backend: T1180 exception + finalize role/sequence wiring
5. [ ] §4b no-video Annotate setup panel + awaiting-video tile state
6. [ ] Cancel-at-every-stage verification against the §5b table
7. [ ] Tests: heuristic unit vectors, modal validity states, upload-order e2e, awaiting-video create → later upload

## Acceptance Criteria

- [ ] Add Game creates a game with valid metadata and no file; it opens into the §4b setup panel and accepts video later
- [ ] A folder of DJI-style splits uploads as one ordered recording (parts chained); two >20-min files upload as 1st/2nd half in creation order with editable chips
- [ ] Video Format control is gone; no format question is ever asked
- [ ] `File.lastModified` is never consulted (grep proves it); export-time stamps never produce a halves/parts claim beyond ordering
- [ ] Every role is user-editable before upload; wrong picks are cancellable at all three stages per the §5b table
- [ ] Heuristic unit tests + relevant e2e pass
