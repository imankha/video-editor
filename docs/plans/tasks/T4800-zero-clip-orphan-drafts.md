# T4800: Reel Drafts shows 0-clip orphan drafts after a clip is deleted

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Priority:** P1
**Created:** 2026-07-06
**Updated:** 2026-07-06

## Problem (reported by imankh, 2026-07-06)

The user saw a reel **draft with 0 clips** in My Reels → Reel Drafts (they recalled the
name as "Best Assists"; the live example is actually the draft named **"Brilliant Assist"**,
project id 34). Their instinct is correct on two counts:
1. **A 0-clip reel draft is broken** — a draft reel should always have ≥1 clip.
2. **Reel Drafts should only contain draft reels.** Auto-assembled *collections* (e.g. the
   smart collection for the Assist tag, named "Top Assists") belong in My Reels collections,
   never in Reel Drafts. (Confirmed: smart collections are named "Top Plays" / "Top {Tag}s"
   via `collections.py _smart_base_name` and are a separate concept from projects/drafts —
   the confusion was the similar-sounding orphan draft name, not an actual collection leaking
   into drafts. Still worth a guard, see AC.)

## Root cause (investigation done)

Deleting a raw clip whose **auto-created reel draft already has a final (exported) video**
leaves that project behind as a **0-clip orphan draft**:

- `DELETE /api/clips/raw/{clip_id}` → `_delete_auto_project(cursor, auto_project_id, clip_id)`
  in `src/backend/app/routers/clips.py` (~1207).
- `_delete_auto_project` **keeps** the project when
  `working_video_id OR final_video_id OR clip_count > 1` ("keep modified auto-project"),
  and only deletes it when it's pristine.
- So once the auto-reel has been framed/overlaid/exported (has a `final_video_id`), deleting
  the source raw clip removes the clip but **keeps the project** → the project now has a
  final video but **0 source clips**, and it still lists in `GET /api/projects` (the Reel
  Drafts feed).

Live evidence: project 34 "Brilliant Assist" — `clip_count=0`, `has_final_video=True`,
`is_auto_created=False`, and **no raw clip links to it** (`auto_project_id=34` matches none).
(Note: this specific orphan was produced by the tutorial-video pipeline deleting a clip to
re-demo Add Clip — but the code path is general and any user hitting delete can create one.)

## Reproduce fresh

1. In Annotate, add a clip with **Create Reel** toggled on (creates an auto-project).
2. Open that reel in Framing or Overlay and **Export** it (gives the auto-project a
   `final_video_id`).
3. Back in Annotate, **delete that clip** from the clip list.
4. Home → Reel Drafts: a **0-clip draft** with the clip's name remains.

## Fix (decide with user)

Pick one (or both):
- **(a) Delete the orphan on clip-delete.** When deleting a raw clip, if its auto-project has
  no other clips, delete the project too (it can no longer be edited — its source is gone).
  Cleanest, but destroys an exported video the user may have published. Check: is the reel
  already published (`downloads`)? If published, keep the *published reel* but still drop the
  now-uneditable *draft*.
- **(b) Filter 0-clip drafts out of the Reel Drafts feed.** In the `GET /api/projects`
  consumer (or the query), exclude `clip_count == 0` projects from the drafts list. Safer
  (non-destructive) but leaves orphans in the DB.
- Recommended: **(b) now** (stops the user-visible bug immediately) **+ (a)** as the durable
  fix so orphans don't accumulate.

## Acceptance criteria

- [ ] Deleting a clip whose auto-reel was exported no longer leaves a 0-clip draft visible
      in Reel Drafts (verify with the repro above).
- [ ] No project with `clip_count == 0` ever renders in the Reel Drafts list.
- [ ] If the orphan's reel was already published to My Reels, the published reel is
      unaffected (only the dead draft is removed/hidden).
- [ ] Confirm (add a guard/test) that smart/tag collections ("Top Plays", "Top Assists", …)
      can never appear in the Reel Drafts feed — drafts are projects only.
- [ ] Clean up the existing orphan project 34 for imankh's dev account (one-off).

## Context

### Relevant files
- `src/backend/app/routers/clips.py` — `delete_raw_clip` (~1184), `_delete_auto_project`
  (~880, the "keep modified auto-project" branch).
- `src/backend/app/routers/projects.py` — `GET /api/projects` list (the Reel Drafts feed);
  `ProjectListItem.clip_count`.
- `src/frontend/src/components/ProjectManager.jsx` — renders the drafts list (could also
  filter client-side as a belt-and-suspenders).
