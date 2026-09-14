# T10070: Reels exported from Team-layer clips never appear in Gallery/My Reels

**Status:** TODO
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
2026-09-14 and says he also submitted an in-app error report the night before (2026-09-13). That
in-app report could not be located while writing this task — see Blocked below.

Reporter's own words:

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

## Blocked: locate the actual `bug_reports` entry

Could not fetch sarkarati's original in-app report — both `prod_session` and `staging_session` in
`scripts/.task-manager-config.json` returned 401 (expired, see T10090). Once a fresh `prod_session`
is in place, find it via:

```
GET {prod_url}/api/admin/bugs?status=new&page_size=50
```

filtered to `reporter_email == sarkarati@gmail.com` and a `created_at` around 2026-09-13 evening.
Load it with `/bug {id}p` once found — it may carry a screenshot, console logs, or action
breadcrumbs this task doesn't have. Cross-reference; the title in his own in-app report is known
wrong (see Reporter section above), so match on reporter + timestamp, not title.

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
3. [ ] Locate sarkarati's original `bug_reports` entry once T10090 restores connectivity;
   pull any additional context (screenshot, console logs).
4. [ ] Implement the corrected filter per the expert's design.
5. [ ] Verify sarkarati's two specific reels ("Lielle amazing free kick goal",
   "Lily scores a banger to open the half") become visible and downloadable.
6. [ ] Backend tests for the corrected query predicate (both the "my own Team clip" case that
   should now show, and the original bug-22 "someone else's shared reel" case that must stay
   hidden).

### Progress Log

**2026-09-14**: Task filed from reporter's email + root-cause investigation. Not yet
expert-reviewed or started.

## Acceptance Criteria

- [ ] Reels sarkarati already exported and published from Team-layer clips appear in his Gallery
      and are downloadable/shareable, without any credit refund or re-export.
- [ ] The original bug-22 case (a reel someone else shared with this athlete) still does NOT
      appear in this athlete's own Gallery.
- [ ] All other affected users found in the Scope query are confirmed fixed (or a follow-up task
      filed if any need individual remediation).
- [ ] Backend tests cover both cases above.
