# T10120: A game can be storage-reclaimed before its recap succeeds, stranding its clips with no video and no way back except Delete

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

Bug 52 (`bug_reports`, sarkarati@gmail.com, 2026-09-02, build `d9621161`): "No option to watch
annotation replay for Game Vs LA Breakers Belmar May 2. Should have 17 clips viewable but only
option is to delete game." Action breadcrumbs show him repeatedly opening/closing the game
(annotate <-> project-manager) without ever reaching framing/overlay — consistent with the game
genuinely offering no way to view its clips, only delete.

This is potentially worse than a missing button: per the root-cause below, the underlying clips'
video source may be genuinely gone, not just inaccessible through the UI.

## Root Cause (investigated 2026-09-14, not yet expert-verified)

"Watch annotation replay" is `GameTile`'s "Watch recap" action
(`src/frontend/src/components/GameTile.jsx:180`):

```js
hasRecap && { key: 'play', label: 'Watch recap', icon: Play, onClick: onPlayRecap },
```

where `hasRecap = Boolean(game.recap_video_url)` (`:63`). The tile's action list (`:179-188`) also
gates "Add video"/"Share" on `!isExpired` and "Extend" on `canExtend`. When a game is `isExpired`,
has no `recap_video_url`, and `can_extend === false`, **every conditional action evaluates false**
— the tile falls through to only the unconditional Delete button (`:193-213`), and tapping the
tile (`activatePrimary()`, `:138-148`) is a no-op since neither `canExtend` nor `hasRecap` hold.
This exactly matches "only option is to delete game."

**Why `recap_video_url` can end up NULL on an expired game:** `recap_video_url` is set only by
`auto_export_game`/`ensure_recap` (`src/backend/app/services/auto_export.py`), whose own module
docstring says it generates recap videos **before game-video deletion during the cleanup/reclaim
sweep**. If that auto-export fails or exhausts `MAX_AUTO_EXPORT_ATTEMPTS` (3, `auto_export.py:47`)
before the sweep reclaims the source video's storage, the source gets deleted with
`recap_video_url` still NULL. `_compute_storage_status` (`games.py:2433-2458`, from T8320) then
reports `'expired'` for any hash-backed game with no surviving `game_storage` row (documented as
"the safe direction" in its own docstring), and `can_extend` (`games.py:1535`) is false once no
ref/grace window remains. Net effect: a game with real annotated clips (17, in this report) whose
auto-export step failed before reclaim lands in a zero-action dead end.

**Potential real data loss, not just a UI gap:** per `auto_export.py:49-54`, the recap video is
also used as the clips' fallback video source AFTER the original is reclaimed
(`resolve_clip_source`). If the recap was never generated, the clips may have **no playable video
source left at all**, not merely a hidden replay button. This needs confirming (see Investigation
below) before assuming the fix is UI-only.

**Ruled out as the same bug:** T8150 (fixed 2026-09-13) was a *freshly created* game vanishing from
missing `durable_sync` on `activate_game`/`create_game` — unrelated, this game is old/expired, not
newly created. T6770 (deployed 2026-08-26, predates this report) fixed `game_storage_refs` drift
that `can_extend` now correctly reads — it doesn't touch auto-export reliability or the
sweep-vs-recap race. **Not provably fixed by any of the 136 tasks in the 2026-09-13 deploy** — none
of T8200/T8210/T8220/etc. touch `auto_export.py`'s retry/failure path. Treat as still live on
current master pending the investigation below.

## Investigation needed before implementing

1. Confirm via prod logs (or a live repro against a game near its reclaim window) whether
   `auto_export_game` actually failed/exhausted retries for this specific game before reclaim, or
   whether there's a different gap (e.g. a race between the sweep's delete step and the auto-export
   step that isn't just "auto-export failed N times").
2. Confirm whether this game's clips currently have ANY playable video source, or whether the
   footage is genuinely gone. This determines severity: if clips are truly unrecoverable, this is a
   data-loss bug (`feedback_no_fallbacks_correct_data`, infrastructure-depth tier 1-2) needing
   different urgency/communication than a pure UI dead-end.
3. Per CLAUDE.md's model policy, this is a root-cause investigation whose mechanism spans
   async/sweep timing — **spawn the expert agent** with this task file plus `auto_export.py`,
   `games.py`'s `_compute_storage_status`/`can_extend`, and `.claude/knowledge/modal-gpu.md` +
   `annotate.md` before designing the fix.

## Design questions for the fix (once root cause confirmed)

1. Should the reclaim sweep be hardened so it CANNOT delete a game's source video until its recap
   has successfully generated (i.e. make recap-before-delete an invariant the sweep enforces, not
   just an intended ordering) — this is the structural fix.
2. Should `GameTile` show a distinct "recap unavailable" / "needs attention" state instead of
   silently collapsing to Delete-only when a game is expired with no recap? This is a UX safety net
   regardless of (1) — a user should never see a dead end that looks identical to "nothing here,
   just delete it" for a game that has real annotated clip data.
3. For sarkarati's specific game (and any others found in the same state): is recovery possible
   (re-run auto-export against surviving source data, if any), or does this need direct remediation
   per data-safety rules (confirm scope + exact accounts before any write, per CLAUDE.md's Data
   Safety Rules)?

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameTile.jsx:63,138-148,179-213` — action-gating logic, the
  UI-visible symptom
- `src/backend/app/services/auto_export.py` — `auto_export_game`/`ensure_recap`,
  `MAX_AUTO_EXPORT_ATTEMPTS`, the recap-before-reclaim ordering and its failure path
- `src/backend/app/routers/games.py:1535` (`can_extend`), `:2433-2458` (`_compute_storage_status`,
  T8320's "safe direction" expiry logic)
- `.claude/knowledge/modal-gpu.md` — auto-export/GPU pipeline context
- `.claude/knowledge/annotate.md` — games/clips/recap invariants

### Related Tasks
- Not the same as T8150 (fixed) or T6770 (fixed, predates this report) — see Root Cause above for
  why both are ruled out
- Filed alongside T10070/T10080/T10090/T10110 from the same full bug-report triage pass
  (2026-09-14)

### Technical Notes
- No silent fallback / no defensive self-repair per coding standards — if the sweep's ordering
  invariant is violated, fail loud (log CRITICAL, don't let reclaim silently proceed), don't paper
  over it with a UI state change alone.

## Implementation

### Steps
1. [ ] Spawn expert agent for root-cause confirmation + fix design (see Investigation above).
2. [ ] Confirm sarkarati's specific game's clip-recovery status.
3. [ ] Implement the sweep-ordering hardening (recap-before-reclaim as an enforced invariant).
4. [ ] Implement the `GameTile` "recap unavailable" state as a UX safety net.
5. [ ] Backend tests: sweep must not reclaim a game whose auto-export hasn't succeeded (or has
   permanently failed in a way that's surfaced, not silently swallowed).
6. [ ] Remediate sarkarati's specific game per whatever the investigation finds is recoverable.

### Progress Log

**2026-09-14**: Task filed from `bug_reports` #52 + root-cause investigation during a full
bug-report triage pass. Not yet expert-reviewed or started.

## Acceptance Criteria

- [ ] The reclaim sweep cannot delete a game's source video before its recap has either succeeded
      or been surfaced as a definitive, logged failure (not just silently retried-and-abandoned).
- [ ] A game with real annotated clips never presents as "only option is to delete" without a
      clear explanation of what happened.
- [ ] sarkarati's specific game is resolved (recap recovered, or clips confirmed genuinely lost and
      handled per data-safety rules) — never left in its current stuck state.
- [ ] Backend tests cover the sweep-ordering invariant.
