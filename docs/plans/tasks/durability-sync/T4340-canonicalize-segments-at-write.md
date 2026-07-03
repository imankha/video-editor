# T4340: Canonicalize segments_data at Write Time

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-03
**Epic:** [durability-sync](EPIC.md) · Audit item B5

## Problem

`segments_data.boundaries` persists in TWO formats depending on which path wrote it: splits-only (gesture actions — acknowledged at `clips.py:466-472`) vs full-list `[0, ...splits, duration]` (export PUT). Every consumer must call `canonicalize_segments_data` or its `segmentSpeeds` indices misalign — this exact class already caused the inverted-clip/recap bugs (see memory "segments_data dual format", `highlight_transform.py`). The audit found a reader that walks boundaries RAW: `overlay.py:1307-1320` (before/after tracking).

Rule violated: one canonical format at the source; readers shouldn't defensively normalize [DRY][SYNC].

## Solution

Canonicalize **at write time** in the single save helper (`_save_clip_framing_data`, `clips.py:289-309`) so every stored blob is full-list:

1. The PUT path knows clip duration already. The actions path doesn't always — store duration on the working_clips row (check: `width/height/fps` were added to working_clips in T1500; add `duration` the same way if absent → Migration agent, new profile_db version, memory "Running Migrations").
2. Migration to rewrite existing rows to canonical format (tuple row-factory gotcha — memory "Migration runner row factory"; test with DATA, not just empty DBs).
3. After the migration is deployed AND run on all envs: remove `canonicalize_segments_data` calls from readers in a follow-up commit (keep the function with an assertion/log if it ever sees non-canonical data — that's a visible-bug signal, not a fallback).

## Context

- Files: `src/backend/app/routers/clips.py`, `src/backend/app/services/` (find every `canonicalize_segments_data` caller: grep), migration in `src/backend/app/migrations/profile_db/`
- **Frontend check:** `useSegments.js` produces/consumes boundaries — confirm what shape the frontend sends in gestures and receives in restores; the API contract must state full-list explicitly after this task.
- Sequencing trap: code that writes canonical must deploy BEFORE/WITH the migration; readers keep canonicalizing until the migration has run everywhere (migrations don't auto-run — memory "Migrations not auto-run").

## Steps

1. [ ] Inventory: grep every reader/writer of `segments_data`; table them in the Progress Log (writer → format today).
2. [ ] Tests: write-time canonicalization for both entry paths; migration test with splits-only fixtures including speeds (indices must survive).
3. [ ] Implement write-time canonical + row duration if needed + migration (vNNN — check current latest, never collide).
4. [ ] Deploy + run migration all envs → then the reader-cleanup commit.

## Acceptance Criteria

- [ ] Every new write stores full-list boundaries
- [ ] Migration converts existing rows; speeds indices verified against known fixtures
- [ ] Readers no longer canonicalize (post-migration commit); non-canonical data triggers a loud log, not a normalize
- [ ] `overlay.py:1307-1320` reads correctly for both pre/post-migration data during the transition
