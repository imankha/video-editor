# T10070: Reels exported from Team-layer clips never appear in Gallery/My Reels

**Status:** STAGING
**Impact:** 9
**Complexity:** 5
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

A reel exported from a **Team**-layer clip (`raw_clips.my_athlete = 0`) finishes normally — it
shows as complete on Reel Drafts and the export credits are spent — but after the user publishes
it, the reel never appears in Gallery/My Reels, even after a reload. The published reel cannot be
downloaded or shared. Reels exported from **My Athlete**-layer clips are unaffected.

This is a P1: the credits are already spent (real money-equivalent cost to the user) and the
deliverable the user paid for is unreachable. It is very likely NOT isolated to one account — see
Scope below.

### Reporter

sarkarati@gmail.com (a known real user, friend of the product owner) reported this by email on
2026-09-14 and says he also submitted an in-app error report the night before (2026-09-13). Found
2026-09-14 (T10090 restored task-board connectivity) — three related `bug_reports` entries, all
`status=new`, all build `d9621161`:

- **Bug 57** (primary, 06:45 UTC): "I'm not able to find reels that I've created of Team clips in
  My Reels. The reel has been focused, overlay added, and previewed, but after I move it to My
  Reels, it disappears... The commonality between the 3 reels I just created that aren't showing up
  is that they are all Team reels, not My Athlete reels." `editor_context.game`: id 12, "Strikers FC
  Summer Classic: Vs Pateadores IRV U9 Aug 15". Action breadcrumbs confirm the full repro: clip 76
  (project 47, game 13 "Mission Viejo Classic: Vs Downey United Blue Aug 29", 16:9) framing-exported
  05:39-05:48 UTC then overlay-exported at 05:36 UTC (same session also covers clip 74, project
  unset, same game 13), and clip 77 (project 48, game 12 "Strikers FC...", 9:16) framing-exported
  06:36-06:40 UTC then overlay-exported 06:41 UTC — these are the exact two reels his email
  describes.
- **Bug 55** (likely duplicate of 57, 06:14 UTC): "It's not clear where the reel I just published to
  My Reels from Reel Drafts can be found. It was a team reel (not a my athlete reel) in 16:9 format
  titled \"Lielle free kick follow through\"" — his own in-app title differs slightly from the
  email's "Lielle amazing free kick goal" (he flagged in the email that he wrote the in-app report
  from memory without checking back — use the email's title, not this one). `editor_context.game`:
  id 13 "Mission Viejo Classic: Vs Downey United Blue Aug 29", matching clip 74/76 above.
- **Bug 56** (related, ADDS_VARIANCE, 06:28 UTC): "Unable to access Overlay options for 16:9
  exported reel. Video covers up the part of the screen where the overlay options are located." —
  this is the separate lower-priority issue already filed as T10080, not this task's scope.

Reporter's own words (from his later email, same content as bug 57/55 above but with corrected
names):

> It seems that Reels exported from Team clips do not appear in Gallery when published to My
> Reels. As a result, the published reels are unable to be downloaded or shared. I tried to create
> a few reels from clips that were labeled from the Team layer rather than My Athlete. One was
> 16:9 titled "Lielle amazing free kick goal" from the game Mission Viejo Classic: Vs Downey United
> Blue Aug 29. The other was 9:16 titled "Lily scores a banger to open the half" from the game
> Strikers FC Summer Classic: Vs Pateadores IRV U9 Aug 15. After focus/exporting these clips, they
> showed up as finished on the Reel Drafts screen, but when I went to publish them to My Reels,
> they didn't appear there, even after reloading the page. This is after credits were spent to
> export the clip, and the credits were still missing from the account indicating that they had
> been spent as expected. Just the published reel is missing. [...] I was able to export and
> publish clips from the My Athlete layer without any issues last night, which is why I think this
> bug is isolated to Team clips.

His original in-app error report used an incorrect clip/reel name for the 16:9 case (he wrote it
from memory without checking back) — use the details above, not whatever title the in-app report
contains, to identify the exact rows.

### Corroborating evidence found 2026-09-14

`scripts/verify_t9680_credits.py` (read-only, run against prod via `fly proxy`) shows reporter's
user_id `aee3e218-c01c-47a6-9d50-cd02ba02e088` has five `framing_usage` debits with no matching
`framing_refund` on 2026-09-13 between 05:10 and 06:36 UTC (amounts -11, -11, -10, -8, -13
credits) — consistent with him spending credits on exports that evening. Not proof by itself (a
successful render also has no refund), but timing and account match his report.

## Root Cause (found 2026-09-14, not yet expert-verified)

`exclude_teammate_reels_clause()` in `src/backend/app/queries.py:173-193` appends:

```sql
AND NOT EXISTS (
    SELECT 1 FROM raw_clips rc
    WHERE rc.id = fv.source_clip_id AND rc.my_athlete = 0
)
```

to every query that surfaces a user's own reels:
- `list_downloads` (Gallery/My Reels) — `src/backend/app/routers/downloads.py:257`, clause applied
  at `:332`
- `src/backend/app/bootstrap.py:148` (bootstrap counts)
- `src/backend/app/routers/collections.py:38+` (Collections)
- `src/backend/app/routers/rank.py:120` (Rankings)
- `src/backend/app/routers/games.py:1347` (per-game reel counts)

`my_athlete = 0` is the **Team layer** bit (`.claude/knowledge/keyframes-framing.md:1324`), not an
ownership bit. The clause's docstring says it exists "to fix bug 22" — keeping a teammate's
*shared* reels out of another athlete's own Gallery. That's the right goal, but `my_athlete = 0` is
the wrong signal for it: it also hides reels the athlete exported **themselves** from Team-layer
footage they have every right to publish (e.g. a teammate's goal clipped during their own athlete's
game). The export/publish write path itself is fine — `publish` just sets
`final_videos.published_at` — the Gallery **read** path is what silently drops the row.

**This needs the expert agent before implementation.** Distinguishing "reel a teammate shared with
me" from "reel I made myself from Team-layer footage in my own account" is a real ownership-model
question (what's the correct predicate — an explicit shared/imported flag instead of the layer bit?
does `raw_clips` already carry a shared-by/owner field that bug 22's fix should have used instead?
`sarkarati-prod` memory shows `teammate_shares`/`clip_teammates`/`shared_by` columns already exist),
not an obvious one-line fix. Per CLAUDE.md's model policy this is a "root-causing a bug whose
mechanism isn't obvious" + "design decision has real tradeoffs" case — spawn the expert agent with
this task file and `.claude/knowledge/keyframes-framing.md` before writing the fix.

## Scope — check before fixing

This is very likely NOT specific to sarkarati's account. Any user who has ever published a reel
from a Team-layer clip would hit the same filter. Before/alongside the fix:
1. Query prod for all `final_videos` rows where `source_clip_id` resolves to `my_athlete = 0` and
   `published_at IS NOT NULL` — these are the currently-invisible-but-paid-for reels across all
   users, not just sarkarati's two.
2. Once the query-side fix ships, those existing rows should just start appearing (no backend data
   is missing or corrupted — this is a read-side filter bug, not a data-loss bug), but confirm this
   with a dry run before telling affected users their reels are fixed.

**Second candidate-affected account found 2026-09-14** (`bug_reports` #53, drewsoccerati@gmail.com,
2026-09-02, profile `e5f4f253`): "Reel missing from My Reels from Game at FRAM2 May 9. Reel was
created from Clip titled 'Romy goes on safari, dribbles 4'. I'm pretty sure this Reel was exported
because I have a download of it saved to my computer with that name." Same symptom shape (export +
download succeeded, Gallery entry missing) during the same `d9621161` build window. Investigation
(2026-09-14) ruled out the other known orphaned-`final_videos` landmines (T4010/T4020/T4110, all
fixed well before this build) and confirmed `my_athlete` is a real per-family-account layer field
("My player" vs "Team" in the Play-category control — see `.claude/knowledge/annotate.md`), so a
Team-layer source clip is plausible for any account, not just sarkarati's. **Not yet confirmed** —
his `raw_clips.my_athlete` value lives in his per-user SQLite (R2-synced), not shared Postgres, so
it wasn't directly checkable without downloading that profile's DB. Include profile `e5f4f253` /
this clip in the Scope query above; if it comes back `my_athlete=0`, his reel is fixed by the same
change and he should be told once verified — otherwise this is a second, still-unexplained bug and
needs its own investigation.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/queries.py:173-193` — `exclude_teammate_reels_clause()`, the filter to fix
- `src/backend/app/routers/downloads.py:257,332` — `list_downloads` (Gallery/My Reels), primary
  symptom surface
- `src/backend/app/bootstrap.py:148` — bootstrap counts, same filter
- `src/backend/app/routers/collections.py:38+` — Collections, same filter
- `src/backend/app/routers/rank.py:120` — Rankings, same filter
- `src/backend/app/routers/games.py:1347` — per-game reel counts, same filter
- `raw_clips.my_athlete`, `raw_clips.shared_by`, `teammate_shares`, `clip_teammates` — schema
  context for the correct ownership signal (see `[[project_sarkarati_prod_migration]]` memory)

### Related Tasks
- T10090 — task board bug-report connectivity (expired session blocking lookup of the original
  report)

### Technical Notes
- No credit refund needed if the fix makes the existing rows visible again (nothing was deleted).
  If investigation finds the underlying `final_videos` row itself is missing for either of
  sarkarati's two reels (not just filtered), that changes this from a filter bug to a data-loss bug
  and the credit/refund question reopens — check that first.
- Gesture-based persistence rule applies to any fix: don't add a reactive backfill; if existing
  rows need touching, that's an explicit one-time migration/script, not a `useEffect`.

## Implementation

### Steps
1. [ ] Spawn the expert agent: root-cause the correct ownership predicate (layer bit vs.
   shared/owner field) and confirm whether any existing rows need real data migration vs. a
   pure read-filter fix.
2. [ ] Confirm scope: query prod for all currently-hidden published Team-layer reels (see Scope
   above).
3. [x] Locate sarkarati's original `bug_reports` entries (57 primary, 55 duplicate, 56 related/
   T10080) — done 2026-09-14, see Reporter section for exact game/project/clip IDs.
4. [ ] Implement the corrected filter per the expert's design.
5. [ ] Verify sarkarati's two specific reels — clip 76/project 47/game 13 (16:9, "Lielle amazing
   free kick goal") and clip 77/project 48/game 12 (9:16, "Lily scores a banger to open the half")
   — become visible and downloadable.
6. [ ] Backend tests for the corrected query predicate (both the "my own Team clip" case that
   should now show, and the original bug-22 "someone else's shared reel" case that must stay
   hidden).
7. [ ] Once fixed, mark bug 55 `duplicate_of` 57 and both `status=testing` via the task board
   (AI does not change bug statuses — user's call per bug-triage skill).

### Progress Log

**2026-09-14**: Task filed from reporter's email + root-cause investigation. Cross-referenced
against the actual `bug_reports` entries (57/55/56) once T10090 restored task-board connectivity —
confirms the exact repro data (game/project/clip IDs) above. Not yet expert-reviewed or started.

**2026-09-14 (later)**: Expert agent confirmed the exact ownership predicate
(`my_athlete = 0 AND shared_by IS NOT NULL`), fixed and renamed to `exclude_shared_in_reels_clause`
across all 8 call sites, reviewed (0 BLOCKING/MAJOR), supervisor-verified red/green independently
(6 tests, exact diagnosed symptom), Branch CI green, merged (PR #437). **Still open**: (1) confirm
sarkarati's specific two reels (clip 76/game 13, clip 77/game 12) now visible — the scope query
from this task's Steps needs to run against his profile DB, not reachable from a container; (2)
the second candidate account (drewsoccerati@gmail.com, bug 53) also needs the scope query run
against his profile before confirming; (3) once confirmed, mark bug 55 `duplicate_of` 57 and both
`status=testing` is the user's call, not AI's, per the bug-triage skill.

## Acceptance Criteria

- [ ] Reels sarkarati already exported and published from Team-layer clips appear in his Gallery
      and are downloadable/shareable, without any credit refund or re-export.
- [ ] The original bug-22 case (a reel someone else shared with this athlete) still does NOT
      appear in this athlete's own Gallery.
- [ ] All other affected users found in the Scope query are confirmed fixed (or a follow-up task
      filed if any need individual remediation).
- [ ] Backend tests cover both cases above.
