# T7360: Multiple game uploads — store and UI handle only one at a time

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

User report (2026-08-19): "UI doesn't handle multiple game uploads, only shows 1 upload at
a time."

The truth is one level deeper than display. `uploadStore.activeUpload` is a SINGLE object,
and `startUpload` hard-rejects a second call while one is in flight
(`src/frontend/src/stores/uploadStore.js` ~L47):

```js
if (state.activeUpload) {
  console.warn('[UploadStore] Upload already in progress, ignoring new upload request');
  return null;
}
```

So a second game upload started while the first is running is **silently dropped** — a
`console.warn` the user never sees, no toast, no queue. The UI showing one upload at a time
is downstream of the store only being able to HOLD one: every consumer
(`UploadProgressIndicator`, `ProjectManager`'s active-upload card, `AnnotateScreen`,
`ProjectsScreen`) renders the singular `activeUpload`.

Do not confuse the existing `isMultiVideo` path with this task: that is ONE game whose
video arrives as multiple files (halves), still one `activeUpload`. This task is about
uploading SEVERAL GAMES concurrently — the "back from the weekend tournament with 3
recordings" flow, which is exactly the shape of the reporting user's library (tournament
weekends, 2 games/day).

## Solution (design gate — Architect decides the concurrency model)

Rework the store from a singular `activeUpload` to a collection, and make every consumer
render the collection. Key decisions for the design doc:

1. **Concurrency model.** Parallel uploads compete for upstream bandwidth (large video
   files); a serial QUEUE (upload 1 runs, 2..n wait as "Queued", auto-advance) gives the
   same UX promise — "drop all your files, walk away" — with more predictable per-upload
   ETAs and no multipart interleaving. Queue-of-one-active is the recommended starting
   point; the design doc should confirm or overturn with reasoning.
2. **Store shape.** `uploads: []` (each entry the current activeUpload shape + `status:
   uploading|queued|error|done`), selectors for active/queued/failed. The existing
   completion-callback and retry-context mechanisms are per-upload and move into the entry.
3. **Gesture rules hold.** Starting an upload is a gesture; queueing more is a gesture;
   nothing persists reactively (uploads are transient client state — pending-upload
   RESUMABILITY across reloads already exists server-side and is out of scope here).
4. **UI.** `UploadProgressIndicator` becomes a stack/list (active first with progress,
   queued rows with a cancel affordance each); ProjectManager's "Pending Uploads" section
   and the active-upload card render N. Rejecting a duplicate file already-in-queue needs
   a visible message, not a console.warn.
5. **Failure isolation.** One failed upload must not block or discard the queue behind it;
   its retry UX stays per-upload.

### Explicitly out of scope

- True parallel multipart upload tuning (unless the design doc picks parallel).
- Server-side changes: the backend already handles per-upload sessions independently.
- The dual-camera/Game Pools multi-CAMERA flows (they layer on top of whatever this
  builds; see the epic's Add Game changes).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/stores/uploadStore.js` — the singular `activeUpload`, the ~L47
  rejection, phase machine, retry context, completion callbacks.
- `src/frontend/src/stores/uploadStore.test.js` — existing store coverage to extend.
- `src/frontend/src/components/UploadProgressIndicator.jsx` (+ its test) — the visible
  progress surface.
- `src/frontend/src/components/ProjectManager.jsx` — `activeUpload` card + "Pending
  Uploads" section (~L1150-1200 area).
- `src/frontend/src/screens/ProjectsScreen.jsx`, `src/frontend/src/screens/AnnotateScreen.jsx`
  — the other `activeUpload` consumers.

### Related Tasks

- **File contention (check before spawning):** T7340/T7350 (concurrent session, in flight
  2026-08-19) touch `AnnotateScreen.jsx` — coordinate or queue behind them.
- Related: T7280 (single-clip upload → Framing) reuses the upload entry point; the Game
  Pools / dual-camera epic's Add Game flow (folder upload, multi-file) will sit on top of
  this store — landing T7360 first simplifies that epic's assumptions.
- **Upload Failure Integrity epic (T7470/T7480/T7490/T7500, filed 2026-08-24, P1 active
  outage): same file, real contention.** T7480's task file already flags this reverse
  reference ("T7360: same surface, sequence deliberately"). Both touch
  `src/frontend/src/services/uploadManager.js` — T7470 patches its failure handlers
  (~795-802, ~903-910) to stop cascade-deleting user content on a failed transfer, and
  T7480 adds a client failure beacon + lifecycle logging on the same paths this task's
  store rework (`activeUpload` → `uploads: []`) will touch from the other side (retry
  context, per-upload failure state). Per the Priority Policy (infra bugs before feature
  rework) and since the epic is an active prod outage, **the epic should land first**; at
  minimum this task's Architect design doc should be written after reading the epic's
  landed failure-state shape so the queue design doesn't have to be reworked around it.

### Technical Notes

- `startUpload` returns the upload id; callers currently treat `null` as "already
  uploading". Every call site must be audited when the rejection is removed — some may
  RELY on the single-upload guarantee (e.g. navigation that assumes "the" upload).
- The store exposes `getUploadProgress()`-style singular selectors; grep all consumers
  (`activeUpload`, `uploadGameId`, `uploadGameName`, `retryContext`) — those globals are
  per-upload state that must move into the entry.
- Upload IDs are `upload_${Date.now()}` — two drops in the same millisecond collide once
  multiple uploads exist; switch to a counter or crypto id.

## Implementation

### Steps

1. [ ] Stage 0 classification (expected L: store redesign + 4-5 consumer surfaces), then
       Architect design doc for the concurrency model + store shape (user approval gate).
2. [ ] Store rework + tests (queue mechanics, failure isolation, per-upload retry).
3. [ ] Consumer surfaces (indicator list, ProjectManager cards, screens).
4. [ ] Duplicate/visible-rejection UX.
5. [ ] Relevant set + reviewer + Branch CI.

### Progress Log

**2026-08-19**: Filed from a direct user report. Root cause located: singular
`activeUpload` + silent rejection in `startUpload` (~L47) — the UI limitation is
downstream of the store shape.

## Acceptance Criteria

- [ ] Starting a second (and third) game upload while one runs is ACCEPTED — visible
      immediately in the upload UI, never silently dropped.
- [ ] Every in-flight/queued upload is visible with its own name, progress/state, and
      cancel affordance.
- [ ] A failed upload surfaces its error and retry without blocking uploads behind it.
- [ ] Completing uploads land their games on the Games tab as they finish.
- [ ] The single-upload flow (today's UX) is visually unchanged when only one upload runs.
- [ ] Relevant test set passes; Branch CI green.
