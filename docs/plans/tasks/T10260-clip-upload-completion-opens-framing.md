# T10260: Clip upload: 100% means ready, then open the clip in Framing

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17 staging: "there was a few second delay between the progress bar saying 100% and
me seeing the clip under clips. To be honest, we should just open that clip right up when it's
done and not get to 100 until its ready."

Trace: `useClipUpload.js:8-15` maps phases to percent with `COMPLETE = 100` as soon as the R2
finalize returns; the clip only appears after the batch `POST /api/clips/upload` (probe +
raw_clip + auto-project) and then a forced `fetchProjects()` (`useClipUpload.js:74-78`). The row
is hidden from the rail at `pct >= 100` (`ProjectManager.jsx:1061`), so the bar vanishes before
the tile exists. There is no "open when done": `selectProject` only sets selection, never
`editorMode`.

## Solution

1. **Honest progress**: cap the bar at the FINALIZING value until the batch endpoint returns and
   the project is in the store; only then set 100. Label the tail "Creating your clip..." (copy in
   `displayNames.js`, reuse T9900's "Preparing your clip..." pattern).
2. **Open on completion** (gesture: the user started the upload, so navigating on its completion
   is the completion of that gesture, not a reactive side effect): for a single-file upload,
   after `fetchProjects` resolves, call the same path the Clips tile uses,
   `onSelectProjectWithMode(projectId, { mode: 'framing' })` (`ProjectsScreen.jsx:257-302`).
   `useClipUpload` is a hook with no access to that screen-level handler; thread a completion
   callback from `ProjectsScreen` -> `ProjectManager` -> `useClipUpload` rather than reaching
   into `editorStore` from the hook. For a multi-file batch, open the first created clip and
   toast the count (existing toast at `ProjectManager.jsx:1026-1031`).
3. If the user navigated away mid-upload, do NOT yank them into Framing: only auto-open when the
   Clips tab (or the upload origin screen) is still mounted; otherwise fall back to the toast
   with an "Open" action (pattern: `announceReelCreated`'s toast action).

## Context

### Relevant Files
- `src/frontend/src/hooks/useClipUpload.js`
- `src/frontend/src/components/ProjectManager.jsx:1007-1068,1534-1583`
- `src/frontend/src/screens/ProjectsScreen.jsx:257-302,438-439`
- `src/frontend/src/services/uploadManager.js` (`UPLOAD_PHASE`)
- `src/backend/app/routers/clips.py:1908-2090` (batch endpoint timing)

### Related Tasks
- Depends on: T10230 (Framing must be known-good before auto-opening into it)
- Pairs with T10250

## Acceptance Criteria

- [ ] The bar never reads 100% before the clip tile exists in the store
- [ ] A single uploaded clip opens straight into Framing when the upload finishes on the Clips tab
- [ ] Navigating away mid-upload yields a toast with Open, not a forced navigation
- [ ] Unit test for the phase mapping; e2e for upload -> Framing
