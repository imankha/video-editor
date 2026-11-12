# T16090: A deleted reel takes its highlight with it

**Status:** WIP
**Impact:** 9
**Complexity:** 3
**Created:** 2026-11-11

## In plain words

**Today.** When a parent publishes a highlight ("Move to My Reels"), the app archives the highlight's editing project: its plays move out of the database into an archive file on R2. If the parent later deletes that reel, the reel goes but the archived project stays, with its plays still only in the archive. Annotate sees a highlight with no reel, lists it as in progress, and clicking it opens Frame on a project with zero plays. That is the endless "Loading..." the owner hit on 2026-11-11 with "Play 5" on the hello@reelballers.com staging account.

**The problem and how we got here.** T16040 was filed to find this hang. Its first step found the cause (above), but that finding was committed without being pushed when the /dotask group started, so the worker never saw it. The group fixed two other real gaps (a clips request that failed and was never retried, and a reload path) and made Frame show a message instead of spinning when it has nothing to load. All of that shipped in PR #746. This cause did not.

**What we will do.** Follow the owner's ruling (below): deleting a reel also deletes the highlight's project, so the highlight is gone from Annotate. The play it was made from stays, so the parent can make a new highlight from it. A migration removes projects already left in this state.

**Why this and not something else.** Restoring the plays from the archive would bring back a highlight the parent chose to delete. The owner ruled the option should not exist at all. Frame's "nothing to show" message from PR #746 stays as a safety net, not as the fix.

**How we will know it worked.** Publishing a highlight and then deleting its reel leaves no entry for it in Annotate, and the play can be turned into a new highlight. On staging, "Play 5" (project 4) on hello@reelballers.com is gone from Annotate after the migration runs.

## Ruling

**A deleted reel takes its highlight with it** (owner, 2026-11-11): "if it's deleted then the option to go there shouldn't exist." Deleting a reel deletes the project it came from (database row and its `archive/<id>.msgpack` on R2), so Annotate no longer lists that highlight and no route can open Frame on it. The play itself (the raw clip) stays and its link to the deleted project is cleared. Projects already archived with no reel are removed by a profile_db migration.

## Evidence

- Staging, hello@reelballers.com, profile 452b3380 (read 2026-11-11, read-only): project 4 "Play 5" has 0 working clips, `archived_at = 2026-10-29 04:48:32`, `final_video_id = NULL`, `working_video_id = NULL`. Its archive `staging/users/c76ade8d-.../profiles/452b3380/archive/4.msgpack` holds 1 working clip and 1 working video and records `final_video_id: 3`. There is no `final_videos` row 3. Raw clip 6 has `auto_project_id = 4`.
- Projects 1 and 2 on the same account are archived and still have their reels (final videos 1 and 2); they must stay untouched.

## Implementer details

### Mechanism
- Publishing archives: `archive_project` in `src/backend/app/services/project_archive.py` writes the msgpack and deletes the project's `working_clips` rows; `restore_project` (line ~193) is the reverse, used by "Open Reel as Draft".
- Deleting a reel: `delete_download` in `src/backend/app/routers/downloads.py` (~line 1512) sets `projects.final_video_id = NULL` and deletes the `final_videos` row, leaving the archived project behind.
- Moving reels to another profile: `_delete_moved_source_rows` in the same file (~line 1994) does the same in the source profile. Check whether the moved reel's project should also leave the source profile; the same dead highlight appears there if it stays.
- Annotate's highlight list comes from projects linked to the raw clip (`raw_clips.auto_project_id` and project `source_raw_clip_id`); `getClipStage` routes any unpublished project to Frame.
- Migrations: `src/backend/app/migrations/profile_db/` (see CLAUDE.md "Migration System"; JIT per account, no admin step). An R2 archive delete inside a migration must follow the persistence rules in `.claude/knowledge/persistence-sync.md`.

### Acceptance criteria
- [ ] C1: Deleting a reel deletes its project (row and R2 archive) and clears its play's link to that project; the play itself remains. A backend test that fails before the fix publishes a project, deletes its reel, and asserts the project and archive are gone and the raw clip still exists with no project link.
- [ ] C2: A profile_db migration deletes every project that is archived and has no reel, with its R2 archive, and clears the matching raw clip links; archived projects that still have a reel are untouched. Tested on a fixture with both kinds.
- [ ] C3: In the browser, after publishing a highlight and deleting its reel, Annotate no longer lists that highlight for the play, and the play can make a new highlight that opens in Frame with its video.

### Related tasks
T16040 (the hang this causes; its other fixes shipped in PR #746), T15220, T15410, T15490 (earlier routes to the same empty Frame).

### Knowledge docs
`.claude/knowledge/export-pipeline.md` (publish, final videos, archive), `.claude/knowledge/annotate.md`, `.claude/knowledge/persistence-sync.md`
