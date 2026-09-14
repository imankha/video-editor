# T10120: GameTile gates annotation playback on the wrong signal, hiding fully-annotated team-layer games behind a Delete-only dead end

**Status:** WIP
**Impact:** 8
**Complexity:** 3
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

Bug 52 (`bug_reports`, sarkarati@gmail.com, 2026-09-02, build `d9621161`): "No option to watch
annotation replay for Game Vs LA Breakers Belmar May 2. Should have 17 clips viewable but only
option is to delete game." Action breadcrumbs show him repeatedly opening/closing the game without
ever reaching framing/overlay — the game genuinely offered no way to view its clips.

## Root Cause (expert-confirmed 2026-09-14 — see T10121 for the sibling backend investigation)

This is the child of a wider investigation (`docs/plans/tasks/T10121-reclaim-sweep-can-permanently-destroy-unrecapped-footage.md`)
that found **four distinct** ways a game can end up expired with `recap_video_url IS NULL`. This
task is specifically the fix for the one that most likely explains sarkarati's report, is the
**actual reported bug** (not a hypothetical), is small, and **loses no data**:

**`recap_video_url` is an athlete-layer-only pointer that the frontend misreads as "any recap
exists."** `src/backend/app/services/auto_export.py:131-149`:

```python
team_clips = _get_annotated_clips(game_id, RecapLayer.TEAM)
if team_clips:
    _generate_recap(..., layer=RecapLayer.TEAM)      # writes recaps/{id}_team.mp4 to R2

athlete_clips = _get_annotated_clips(game_id, RecapLayer.ATHLETE)
if athlete_clips:
    recap_url = _generate_recap(..., layer=RecapLayer.ATHLETE)
else:
    recap_url = None                                  # <-- team-only game
...
"UPDATE games SET auto_export_status = 'complete', recap_video_url = ? WHERE id = ?", (recap_url, game_id)
```

A game whose rated clips are **all Team-layer** (`my_athlete = 0`) finishes auto-export with
`auto_export_status='complete'` and `recap_video_url = NULL`, **while a perfectly good team recap
sits in R2** at `recaps/{game_id}_team.mp4`. T5710 deliberately kept the column pointing at the
unsuffixed athlete key (`.claude/knowledge/export-pipeline.md:815-821`) and nobody revisited the
consumers that read it as a boolean.

**All-team-layer is not an edge case — it is the guaranteed shape of every claimed/shared game**:
`materialization.py:728` — "Incoming share clips are always Team layer (my_athlete=0)";
`materialization.py:475-479` — a materialized game starts with `recap_video_url=None`. The ONLY
place such a game's recap is ever reachable today is right after claiming it
(`ProjectManager.jsx:1144-1153` opens `RecapPlayerModal` directly with `initialTab:'team'`) — once
that moment passes, `GameTile` has no way back in.

The collapse itself, exactly matching the bug report (`GameTile.jsx:63, 142-148, 179-188`):
`hasRecap = Boolean(game.recap_video_url)` → false; `!isExpired` kills Add video/Share;
`can_extend` is false once the grace window is gone; `activatePrimary()` (tap-to-open) is inert.
The poster also 404s (`games.py:3801-3836` only derives a poster from `recap_video_url`), so the
tile renders as a grey "No poster" box with one Delete button.

**The backend already fully supports this case — only the tile's gate is wrong.**
`GET /api/games/{id}/recap-data?layer=team` (`games.py:1704-1826`) already resolves the stitched
team recap, or falls back to the live game video, a legacy recap, or a clip-names-only list — and
`RecapPlayerModal.jsx:180-188, 593-601` already renders the honest "This game's video is no longer
available (storage expired). The annotation details are still listed." state with the clip rail.
Nothing needs to be built server-side for this fix; the frontend is just asking the wrong question.

## Fix

**Do NOT overload `recap_video_url`** — it's a real pointer used by `/recap-url`
(`games.py:1631-1646`) and the poster path (`games.py:3801`); making it also mean "some recap
exists somewhere" repeats the same one-field-two-meanings mistake. Surface the truth instead:

1. `games.py:1274-1296` (`_compute_athlete_stats`) already reads `my_athlete` per row in the same
   pass that builds `clip_count` — add `athlete_clip_count`/`team_clip_count` to the per-game dict
   (free, no N+1) and include them in the list payload (`games.py:1549`).
2. `GameTile.jsx:63` — replace `const hasRecap = Boolean(game.recap_video_url);` with
   `const hasAnnotations = (game.clip_count || 0) > 0;`.
3. `GameTile.jsx:180` — relabel the action from **"Watch recap"** to **"Watch annotations"** (the
   reporter's own words were "watch annotation replay") and gate it on `hasAnnotations`.
4. `GameTile.jsx:142-148` (`activatePrimary`) — on an expired game: `canExtend → onExtend`, else
   `hasAnnotations → onPlayRecap` (was `hasRecap`).
5. `ProjectManager.jsx:1791` — `onPlayRecap` already accepts a tab; pass
   `game.athlete_clip_count > 0 ? 'athlete' : 'team'` so a team-only game opens on the tab that has
   content (`RecapPlayerModal.jsx:53` currently defaults to `'athlete'`, which would open empty for
   this exact case).
6. Update `.claude/knowledge/annotate.md:1944-1946` — it currently documents the broken gate as
   intentional; fix the doc in the same commit per the knowledge-doc rule (docs are claims, code is
   truth).

This single change makes every case honest, because `recap-data` already implements all the
resolution routes — it was never reachable through the tile.

## Does sarkarati's specific game need separate recovery?

Likely not, but unconfirmed. Per T10121's investigation, this mechanism (all-team-layer) is
estimated ~60% likely to be his exact case (17 clips, no athlete layer) — if so, the team recap
already exists in R2 and this UI fix alone restores his game, no data remediation needed. See
T10121's "sarkarati's game" section for the diagnostic query and why it must run against his
**per-user SQLite** (profile_db, R2-synced — NOT shared Postgres; `games`/`raw_clips` live in
`src/backend/app/database.py`'s schema, not `pg.py`'s). If the diagnostic instead shows `pending`/
`failed` status, his case is T10121's territory, not this task's.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/GameTile.jsx:63,142-148,179-213` — the gate to fix
- `src/backend/app/routers/games.py:1274-1296` (add per-layer counts), `:1549` (list payload),
  `:1631-1646` (`/recap-url`), `:1704-1826` (`/recap-data`, already correct), `:3801-3836` (poster)
- `src/frontend/src/screens/ProjectManager.jsx:1791` — `onPlayRecap` tab selection
- `src/frontend/src/components/RecapPlayerModal.jsx:53,180-188,593-601` — already handles the
  expired/team-only cases correctly, just needs to be reachable
- `.claude/knowledge/annotate.md:1944-1946` — fix the stale doc note in the same commit

### Related Tasks
- Sibling backend investigation: T10121 (reclaim sweep can permanently destroy footage — a
  different, more severe set of mechanisms; this task's fix does not require T10121 or vice versa,
  they can ship independently and in either order)
- T10130 (storage-expiry banner reassurance copy) depends on **T10121**, not this task — this fix
  doesn't change reclaim reliability, only read-path correctness
- Filed alongside T10070/T10080/T10090/T10110 from the 2026-09-14 bug-report triage pass

### Technical Notes
- `athlete_clip_count`/`team_clip_count` are derived on read from `my_athlete`, never stored
  (`feedback_no_redundant_state`) — same pattern `_compute_athlete_stats` already uses for
  `clip_count`.

## Implementation

### Steps
1. [ ] Add `athlete_clip_count`/`team_clip_count` to the games list payload.
2. [ ] `GameTile.jsx`: replace `hasRecap` with `hasAnnotations`, relabel the action, fix
   `activatePrimary`.
3. [ ] `ProjectManager.jsx`: pass the correct initial tab to `onPlayRecap`.
4. [ ] Fix the stale note in `.claude/knowledge/annotate.md`.
5. [ ] Frontend tests: `GameTile.test.jsx` currently pins the OLD (broken) behavior at `:153-160`
   ("Extend storage" test) — rewrite the case for an expired, non-extendable, team-only game
   (`clip_count>0`, `recap_video_url:null`) to expect "Watch annotations" and a working tap.
6. [ ] Run the diagnostic query from T10121 against sarkarati's profile DB; if it confirms
   all-team-layer, tell him once this ships (per `feedback_post_deploy_user_notification`).

### Progress Log

**2026-09-14**: Task filed from `bug_reports` #52. Expert investigation (docs/plans/tasks/T10121)
confirmed root cause and full fix design; this task file rewritten to carry just the frontend fix
after the investigation found 3 additional, more severe backend mechanisms — split out to T10121
so this small, safe, high-confidence fix isn't blocked on the harder backend design work.

## Acceptance Criteria

- [ ] A game with real annotated clips (any layer) never presents as "only option is to delete"
      when a recap actually exists for its clips.
- [ ] An all-team-layer game's tile correctly offers "Watch annotations" and opens the team tab.
- [ ] `GameTile.test.jsx` covers the fixed case.
- [ ] sarkarati's specific game confirmed resolved (or handed to T10121 if the diagnostic shows a
      different mechanism).
