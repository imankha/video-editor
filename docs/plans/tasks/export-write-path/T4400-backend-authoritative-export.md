# T4400: Backend-Authoritative Export (mark-exported, No Client Full-State)

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-07-03
**Epic:** [export-write-path](EPIC.md) · Audit items B4 + F8 (persistence audit) · Depends on T4390

## Problem

Every gesture already persists surgically, yet export still trusts CLIENT state as authority — the whole-blob clobber class survives:

1. **Single-clip:** export calls `saveCurrentClipState` → `PUT /clips/.../clips/{id}` (`clips.py:2001-2124`) replacing `crop_data`/`segments_data` with whatever the hooks hold. Two tabs: tab B's surgical edits land in the DB; stale tab A clicks Export → PUT clobbers them (backend has no version check on working_clips). And any call while hooks have reset is exactly T4020's empty shadow-version. Frontend-only guards protect this today (`framingOverlayTransition.js:27-29` — an always-false predicate — and the hook-initialized check `FramingContainer.jsx:214-231`).
2. **Multi-clip:** sends `cropKeyframes`/`segments` built from live hook state (`ExportButtonContainer.jsx:626-663`) with NO save-first; backend renders the payload then stamps the DB rows `exported_at` **without reconciling `crop_data` to what was rendered** (`multi_clip.py:1427-1432`) — DB and rendered video can permanently diverge (and the sweep later re-renders from the DB, producing a third variant).

[DEP] bonus: removing client authority removes the "hooks must be fresh at export time" timing dependence entirely.

## Solution

1. New surgical action `mark_exported` (or extend the actions endpoint): backend snapshots ITS OWN current blobs into the new working-clip version (the versioning logic now lives in T4390's `finalize_export`); client sends no keyframes/segments. The T4020 no-op comparison (`clips.py:2039-2051`) becomes unnecessary — backend state can't disagree with itself.
2. Multi-clip: `/multi-clip` resolves framing from the DB (it already resolves SOURCES from DB per T810 — extend the same approach to crop/segments). The client payload shrinks to clip ids + export options.
3. Retire `PUT /clips/.../clips/{id}` full-state writes: grep every caller; when none remain, delete or 410 the write path (GET stays if it exists).
4. Frontend: `saveCurrentClipState`/`ExportButtonContainer` slim down; the always-false transition guard and its dead code go.

## Context

- **Prerequisite check (do FIRST):** backend-authoritative export is only correct if every gesture truly persisted. T1660 found framing gestures are fire-and-forget with no rollback in places; T4330's serialized client closes ordering gaps. Verify: is there any hook state that reaches export WITHOUT having been persisted by a gesture (e.g., a local-only edit)? Inventory in the Progress Log; any such state needs a persisting gesture first, or this design silently drops it. This is the task's main risk.
- Files: `clips.py`, `multi_clip.py`, `FramingContainer.jsx`, `ExportButtonContainer.jsx`, `projectDataStore.js:198-256`, `screens/framingOverlayTransition.js`
- Tests: T4020's regression tests must be RETARGETED (they pin the old guard), not deleted; add a two-tab test: stale-tab export cannot clobber newer surgical edits.

## Steps

1. [ ] The unpersisted-hook-state inventory (above). Stop and surface if anything is found.
2. [ ] Backend `mark_exported` + tests (snapshot correctness, versioning via T4390).
3. [ ] Single-clip frontend switch; delete dead guards; T4370 snapshots + E2E export flow green.
4. [ ] Multi-clip DB-resolution + payload slim-down; snapshot parity.
5. [ ] Retire the full-state PUT path (grep-proof, then remove).

## Acceptance Criteria

- [ ] No export path accepts client keyframes/segments as authority
- [ ] Stale-tab export test: newer surgical edits survive
- [ ] Rendered output always matches DB state at render time (multi-clip reconciliation gap closed)
- [ ] Full-state PUT write path removed; T4020-class regression impossible by construction
