# T8530: Done means done: one-tap publish on completion (remove the manual Move step)

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source; publish semantics surfaced)

## Problem

After the overlay export completes, the finished video sits in a "Ready" phase on the
Your Clips board until the user clicks "Move to Highlight Reels". The system's
definition of done lags the user's by one undisclosed click - which is also why the
Highlight Reels drawer said "No reels yet" to a user who considered themselves finished
(walkthrough 2026-09-02, cliff 4).

## What "Move" actually is (verified in source) - READ FIRST

"Move to Highlight Reels" is not a move. It is PUBLISH:

- `src/frontend/src/components/DraftTile.jsx` line 127: `publishProject` ->
  `POST /api/downloads/publish/{project.id}` (apiFetch at line 135), with the T4050
  durable-sync failure UX (503 sync_failed -> card kept + Retry, lines 138-158).
- Backend: `src/backend/app/routers/downloads.py` line 2088
  `@router.post("/publish/{project_id}")` / `publish_to_my_reels`.
- DraftTile.test.jsx line 163: 'verb ("Move to Highlight Reels") and publishes on click'.

Publishing has real consequences: the reel becomes shareable, appears in the published
collections (CollectionsTab), and its derived name freezes (explicit-names-after-archive
rule). So "auto-advance" = AUTO-PUBLISH, which is a genuine product decision, not a UI
tweak.

## Decision to confirm with the user at task start (one question)

- **Option A - auto-publish:** overlay-export completion publishes immediately (the
  "Add Overlay" click becomes the publishing gesture; its completion commits). One
  less tap; but an accidental/experimental export self-publishes, and name freezing
  happens without an explicit look.
- **Option B - one-tap publish from the completion surface (RECOMMENDED):** completion
  toast/landing carries a primary "Publish to Highlight Reels" button; the Ready board
  stays as the fallback. Keeps publish a deliberate gesture (gesture-persistence
  philosophy), removes the hunt (the walkthrough's actual failure was FINDING the
  step, not tapping it).

T8400 (approved tutorial-redesign R4: "publish lands the user ON the reel") assumes an
explicit publish gesture, which fits Option B. Spec below implements B; if the user
picks A, the same wiring applies with the confirmation surface removed.

## What to build (Option B)

### Step 1 - shared helper

Create `src/frontend/src/utils/finishedReelNav.js` (co-owned with T8520):
`navigateToFinishedReel(projectId)` - opens the reel's location (pre-T8400: the
Highlight Reels drawer scrolled to the project's game group; post-T8400: the published
reel itself). One implementation, imported by T8520's Skip button and this task's
toast/CTA.

### Step 2 - completion surface gains Publish

The overlay-export completion currently fires the toast "Export Complete - {name} -
overlay export finished successfully" and lands on /home/reels (walkthrough
observation; find the completion handler - same ExportButtonContainer completion sites
as T8520 but for `editorMode === OVERLAY`, plus wherever the navigation to /home/reels
happens - grep the toast string "overlay export finished"). Change:
- Toast copy: "Export complete - {reelName} is ready to publish." with action button
  "Publish" -> runs the SAME publish call DraftTile uses.
- EXTRACT `publishProject` out of DraftTile.jsx into a shared hook
  `usePublishProject(project)` (src/frontend/src/hooks/) carrying the whole T4050
  contract: POST -> on 503 sync_failed set retry state -> `fetchProjects` re-read
  (NEVER optimistic removal - see DraftTile.jsx comments at lines 129-133). DraftTile
  and the completion surface both consume the hook. Do not duplicate the fetch logic.
- On publish success from the toast: `navigateToFinishedReel(projectId)` + success
  toast "Published - ready to share." (T8540's Share button is on that surface).
- On 503 sync_failed from the toast path: fall back to the Ready board with the
  existing Retry card visible (the hook's retry state renders there) + error toast
  telling the user where it is.

### Step 3 - the Ready board demotes to fallback

DraftTile keeps its primary "Move to Highlight Reels" button but RENAME the label to
"Publish to Highlight Reels" (it publishes; say so - one string, update
DraftTile.test.jsx line 170/185 and ProjectManager.publishRetry.test.jsx). The board
remains the home for retry-after-sync-failure and for users who exported without
publishing.

### Step 4 - status coherence

With T8470's labels, a completed-but-unpublished draft shows "Ready to share"
everywhere (stage READY), and the drawer's count-aware empty states (T8470 Part C)
acknowledge it. After publish it leaves the drafts population entirely (existing
behavior: fetchProjects re-read drops it; published list gains it).

### Step 5 - tests

- Hook test for usePublishProject: success path, 503-sync_failed path (retry state,
  no optimistic removal), generic-failure path. Port the assertions from
  ProjectManager.publishRetry.test.jsx (lines ~102-123) so coverage is not lost by
  the extraction.
- Toast action test: completion toast renders Publish; success navigates via the
  shared helper.
- e2e: overlay export completes -> tap Publish on the toast -> reel visible in the
  drawer/published list -> Share reachable (with T8540). And the fallback: ignore the
  toast, publish from the board via the renamed button.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DraftTile.jsx` (48-160) - extract publishProject
- `src/frontend/src/components/ProjectManager.jsx` - Ready board, fetchProjects
- `src/frontend/src/containers/ExportButtonContainer.jsx` - overlay completion sites
- Completion toast source (grep "overlay export finished")
- `src/backend/app/routers/downloads.py:2088` - read-only (contract unchanged)
- New: `src/frontend/src/hooks/usePublishProject.js`, `src/frontend/src/utils/finishedReelNav.js`
- Tests: DraftTile.test.jsx (163-194), ProjectManager.publishRetry.test.jsx

### Related Tasks
- T8400 (publish lands on the reel): owns the eventual landing surface -
  navigateToFinishedReel is the seam; whichever lands second rebases the helper only
- T8520: consumes the same helper for Skip
- T8540: the Share button at the destination
- T4050 durable-publish contract: MUST survive the extraction verbatim (503 handling,
  no optimistic removal)

## Acceptance Criteria

- [ ] User decision recorded (A or B) before implementation
- [ ] Publish reachable in one tap from the completion moment; zero hunting
- [ ] publishProject logic exists once (hook); DraftTile + completion surface share it
- [ ] T4050 sync-failure behavior intact on BOTH paths (test-proven)
- [ ] Board button renamed to "Publish to Highlight Reels"; tests updated
- [ ] e2e both paths green; 390x844 verified (toast action tappable)
