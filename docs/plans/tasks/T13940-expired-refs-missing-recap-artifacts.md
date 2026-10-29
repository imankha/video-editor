# T13940: 24 expired game_storage refs kept forever because their recap artifacts are MISSING

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

Prod sweep logs (2026-10-29) show 24 expired refs that the expiry sweep refuses to reclaim on
every run: `[Sweep] hash=<12> recap artifacts MISSING - refusing reclaim, keeping ref to retry
next sweep`. The T10121 gate is correct to refuse (reclaiming would delete a game source whose
recap was never produced), but nothing moves these refs forward: they hold their game videos
in R2 past expiry (storage cost) and, until T13920 lands, drive the sweep hot loop.

Open questions this task answers:
- Which users/games/hashes are they (prod, read-only)? Are any test accounts?
- Why are the recap artifacts missing: export never ran, export failed, artifacts deleted,
  or the presence check (`recap_artifacts_present`) is wrong for some shape of data?
- Does `_abandon_if_exhausted` ever fire for them, and if not, why not?

## Solution

1. Read-only investigation on prod: list the 24 hashes from the sweep logs / `game_storage_refs`,
   map each to (user, profile, game), and check the recap artifacts in R2 and the game's export
   state. Classify each into a root-cause bucket.
2. Per bucket, propose the fix (code fix for a wrong presence check; re-export path; or the
   existing abandon path) in a decision artifact. **No prod data change without the user's
   approval** (CLAUDE.md Data Safety Rules).
3. Implement the approved code fix with a red-to-green test. Any data repair runs through the
   approved tooling (`scripts/edit-user-db.py`, dry-run first).

## Context

### Relevant Files
- `src/backend/app/services/sweep_scheduler.py` - `_reclaim_verdict`, `_abandon_if_exhausted`, `_find_games_for_hash`
- recap artifact check: grep `recap_artifacts_present`
- `scripts/edit-user-db.py` - approved data-change tool

### Knowledge Docs
- `.claude/knowledge/annotate.md` (recap), `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/backend-services.md`

### Related Tasks
- T13920 (sweep hot loop; independent, lands first)
- T10121 (the artifact gate)

## Acceptance Criteria

- [ ] Each of the 24 refs classified with evidence (hash prefix, user, game, artifact state, export state).
- [ ] Decision artifact for the user before any prod data change.
- [ ] Approved code fix (if any) with a regression test, red then green.
- [ ] After the fix/repair, the sweep reports refs=0 kept-for-missing on prod (or each remaining one is explained).

## Progress Log

**2026-10-29**: Filed from the Cloudflare billing-alert investigation (see T13920).
