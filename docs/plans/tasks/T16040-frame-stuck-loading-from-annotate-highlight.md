# T16040: Frame stuck on Loading from an Annotate highlight

**Status:** STAGING
**Impact:** 9
**Complexity:** 4
**Created:** 2026-11-11

## In plain words

**Today.** In Annotate (the screen where a parent marks plays in a game), each play lists the highlights made from it. Clicking an in-progress highlight is supposed to open it in Frame, the step where the parent crops around their athlete. On staging on 2026-11-11 the owner clicked the in-progress landscape highlight "Play 5" and Frame showed a spinner reading "Loading..." forever.

**The problem and how we got here.** Frame only loads its video once it has the highlight's plays in memory. When that list is empty, nothing loads, nothing is logged and the spinner never ends. This is the fourth way into the same dead end: returning from payment (T15220), reopening the app at the last screen (T15410) and a direct Spotlight link (T15490) each hit it and were each patched on their own. Two details in the owner's screenshot match T15410's description exactly. The breadcrumb shows no game name, which only happens when Frame has no plays loaded. The console shows two "editor mode with no selected project" warnings, which only print when the page itself is loaded fresh on a Frame address. We could not reproduce it on the owner's main account: opening an in-progress landscape highlight from Annotate worked three times in a row, including going back and forth between Annotate and Frame.

**What we will do.**
1. Find which of two things happened.
   - (a) The "Play 5" highlight on the hello@reelballers.com staging account has no plays saved, so Frame has nothing to show.
   - (b) The highlight is fine, but this route into Frame (or a page reload on it) never asked for its plays.
2. Fix that cause.
3. Make Frame itself refuse to sit silently. If a highlight is open, nothing is loading and there is still no video, Frame says what is missing, offers a way back to Annotate and logs the reason.

**Why this and not something else.** Patching each entry point has failed three times. The screen that shows the spinner is the one place that can always tell "still loading" apart from "nothing will ever load". Fixing only the data, or only the entry point, would leave the next route to the same blank spinner.

**How we will know it worked.** Clicking every in-progress highlight in Annotate opens Frame with the video within 10 seconds. A highlight with no plays shows a message and a way back, never an endless "Loading...".

## Evidence

- Owner screenshot 2026-11-11: Frame, breadcrumb "Plays > Play 5" with no game line, Landscape picked, spinner "Loading..." (the generic text Frame shows when it is not loading anything; while really loading it says "Loading video..." or "Loading your plays...").
- Console from that session, build 1fa1e7f05 (#7520): `[Build]` line, then `[App] editor mode with no selected project; routing home` twice. No `[Framing] Ignoring stale clip`, no `fetchClips error`, no `playback-url` error. Production builds keep warn and error and strip log, so those paths did not fire.
- Staging data (hello@reelballers.com, profile 452b3380): "Play 5" is raw clip 6 on game 2, linked to project 4.
- **Step 1 is answered (2026-11-11, owner-authorized read, read-only): cause (a), the plays are missing from the database.** Project 4 has 0 working clips, `archived_at = 2026-10-29 04:48:32`, `final_video_id = NULL`, `working_video_id = NULL`, `restored_at = NULL`. Its one working clip and working video sit in R2 at `staging/users/c76ade8d-.../profiles/452b3380/archive/4.msgpack` (v2, 14,774 bytes), which records `final_video_id: 3`. There is no `final_videos` row 3 any more (rows 1, 2 and 4 remain). What happened: the parent published "Play 5" (publishing archives the project: its plays move to R2 and leave the database), then deleted that reel. Deleting a reel (`delete_download`, `src/backend/app/routers/downloads.py` ~line 1512, and `_delete_moved_source_rows` ~line 1994 for moves) clears `projects.final_video_id` but leaves the project archived with its plays still in R2. Annotate then sees a highlight with no reel, lists it as in progress, and opens Frame on a project with zero plays. Projects 1 and 2 on this account are archived but still have their reels; project 5 is the same shape as 4 only if its reel is deleted later.
- So the fix for C1 is about the archived-project-without-a-reel state: either deleting a reel restores (or deletes) its archived project, or opening an archived project in Frame restores it first (`restore_project`, `src/backend/app/services/project_archive.py:193`). It also needs a repair for accounts already in this state (project 4 here). Pick the one that keeps a single owner of the data (CLAUDE.md "Correct data, not workarounds": a migration makes existing data correct). A regression test: publish a project, delete its reel, then open the highlight from Annotate, and Frame gets its plays.
- Non-repro on imankh@gmail.com: game 2, project 71 (in-progress landscape, one working clip). Annotate, then the highlight row, then Frame loaded clips, project and playback URL in about 1.4 s, three times, including via Mark Plays and back. Script: `C:\Users\imank\AppData\Local\Temp\claude\1ca763295c075470\1978523e-bc3a-4474-88f7-5eff8c282168\scratchpad\repro\repro.mjs` (args: gameId projectId outDir).

## Ruling

**A deleted reel takes its highlight with it** (owner, 2026-11-11): "if it's deleted then the option to go there shouldn't exist." Deleting a reel deletes the project it came from (database row and its `archive/<id>.msgpack` on R2), so Annotate no longer lists that highlight and no route can open Frame on it. The play itself (the raw clip) stays, and its link to the deleted project is cleared, so the parent can make a new highlight from it. Projects already in this state (archived, no reel; e.g. hello@ staging project 4) are removed by a profile_db migration. Restoring the plays into Frame is not the fix.

The first round of this group (PR #746) fixed two other real gaps (a clips fetch that failed and never retried, and a reload path) plus Frame's stuck-empty message; keep those. They did not address this cause, because this task file's finding was committed but not pushed when the group started.

## Implementer details

### Mechanism
- `FocusScreen.jsx` loads the video from two effects (the mount `useLayoutEffect` and the `[clips]` `useEffect`). Both `return` when `clips.length === 0`, and `getClipVideoConfig` can return `url: null` silently for an uploaded clip with no file URL.
- `FocusModeView.jsx` passes `isLoading || isProjectLoading || !videoUrl` to the player and picks `FRAME_COPY.LOADING` when the stage is null or 'loading' or 'complete', so "Loading..." is shown both while waiting and after a load that produced nothing.
- Annotate open path: `AnnotateModeView.handleOpenInstance` calls `AnnotateScreen.openClipInEditorMode`, which runs `prefetchClipsForOpen`, then `selectProject`, then `onModeChange(FRAMING)`. `App.handleModeChange` takes the prefetch only when App's closure `editorMode === ANNOTATE`.
- Since T6190 nothing fetches clips on Frame mount. `useProjectLoader.loadProject` (ProjectsScreen pending project, payment return, resume restore) is the only other owner.
- `getClipStage` falls through to `action: 'focus'` for any project that is not published, so a project with a final video but no working clips can still route to Frame.

### Candidate causes to check, in order
1. CONFIRMED (see Evidence): project 4 has no working clips because it was archived on publish and its reel was deleted afterwards; the plays are in `archive/4.msgpack` on R2.
2. Reload on `/focus/p/4`: ProjectsScreen pending-project path runs `loadProject` and still ends with empty clips (consistent with 1).
3. An entry where App's `editorMode` closure is not ANNOTATE when `onModeChange` fires, so neither prefetch nor invalidate runs.

### Acceptance criteria
- [ ] C1: Deleting a reel deletes its project (row and R2 archive) and clears the play's link to it, so the highlight is gone from Annotate; a migration removes projects already archived with no reel. A regression test that fails before the fix publishes a highlight, deletes its reel, and shows the highlight no longer listed in Annotate.
- [ ] C2: Frame with a selected project, no load in flight and no video URL (empty clips, or a clip whose URL resolves to nothing) shows an explicit message with a way back to Annotate, and logs `console.error` naming the project id and which input is missing. It never shows the plain "Loading..." in that state.
- [ ] C3: Opening an in-progress highlight from Annotate's highlight list opens Frame with the video within 10 s (browser check against staging).

### Related tasks
T15220 (payment return), T15410 (resume restore), T15490 (Spotlight deep link), T6190 (no Frame mount refetch), T16050 (loading screens log what they wait for), T16060 (cold staging backend vs real bugs).

### Knowledge docs
`.claude/knowledge/keyframes-framing.md`, `.claude/knowledge/annotate.md`
