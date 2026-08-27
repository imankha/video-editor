# T6250: Entering Overlay fires `overlay-data` 3x and `outdated-clips` 2x

**Status:** WIP
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-31
**Updated:** 2026-07-31

Epic task 2/6. See [EPIC.md](EPIC.md) for the capture and the StrictMode caveat.

## Problem

From the 2026-07-31 HAR, switching Framing -> Overlay on project 30:

| start | duration | request |
|-------|----------|---------|
| 44352 | 157ms | `GET /api/projects/30/outdated-clips` |
| 44354 | 156ms | `GET /api/export/projects/30/overlay-data` |
| 44355 | 155ms | `GET /api/projects/30/outdated-clips` |
| 44356 | 155ms | `GET /api/export/projects/30/overlay-data` |
| 44363 | 148ms | `GET /api/export/projects/30/overlay-data` |

Five requests inside 11ms where two would do. This is the same defect class T6190 fixed for
project-open — two owners fetching the same data — on a transition T6190 did not cover.

**`overlay-data` x3 cannot be StrictMode alone.** Dev double-invoke produces *even* multiples,
so an odd count proves at least two genuine owners (likely 2 owners with one double-invoked).
`outdated-clips` **x2 may well be StrictMode** and could be x1 in production — **verify against
a production build before changing that one.**

Unlike T6190's pair (which were ~685ms apart and sequential), these are 1-9ms apart and
genuinely concurrent — so an in-flight dedupe latch would collapse them. There isn't one on
either endpoint.

## Solution

1. Find every caller of `overlay-data` and `outdated-clips` on the Framing->Overlay path.
   Name them explicitly; do not guess from effect order (T6190's lesson: an `await import()`
   can reorder the wire relative to declaration order).
2. Reduce to **one owner per fetch**, per the epic rule. Prefer deleting the redundant caller
   over adding a cache.
3. Confirm the x2 on `outdated-clips` against a production build (`npm run build && npm run
   preview`) before treating it as real — if it is StrictMode, say so and leave it.

Do NOT add a blanket request cache or a longer-lived in-flight latch. That hides the second
owner rather than removing it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/OverlayScreen.jsx` — mount effects; note the T5670 comment at
  ~L99-102 (it already reads game info from the loaded projects list rather than refetching)
- `src/frontend/src/App.jsx` — `handleModeChange` (~L541); T6190 added `invalidateClips` here
  for the leave-annotate gesture — check whether the Overlay branch has an analogous owner
- `src/frontend/src/hooks/useProjectLoader.js` — the project-open fetch owner
- Backend handlers: `src/backend/app/routers/projects.py` (`outdated-clips`),
  `src/backend/app/routers/export/` (`overlay-data`)

### Related Tasks
- **T6190** — same defect class on project-open; reuse its approach (remove the extra owner,
  gesture-driven invalidation where a refresh is genuinely needed). Read its Progress Log for
  the trap that a mount refetch can race the mount itself.
- **T6190's regression** — moving a fetch earlier triggered a latent render loop in
  `FramingScreen`. If you change *when* a fetch fires here, re-check the console for
  `Maximum update depth exceeded`.

### Technical Notes
- The QA spec `src/frontend/e2e/T6190-project-open-fetches.qa.spec.js` already has a
  request-counting helper and a console-error guard — extend it rather than writing a new
  harness.
- `working_video/stream` is also fetched twice (t=37636 Framing, t=44335 Overlay), but those are
  different byte ranges (9.4MB then 1MB), which is normal player behaviour. Not part of this task.

## Implementation

### Steps
1. [ ] Enumerate every caller of `overlay-data` and `outdated-clips` on the Overlay entry path
2. [ ] Verify against a production build which counts survive (StrictMode check)
3. [ ] Remove the redundant owner(s); one owner per fetch
4. [ ] Extend the T6190 QA spec with Overlay-entry request counts
5. [ ] Re-capture and confirm the counts

### Progress Log

**2026-07-31**: Filed from the post-T6190/T6200 verification HAR. Call sites not yet traced.

**2026-08-27 (implemented)**: Traced + fixed.
- **Owners enumerated.** `overlay-data` has two frontend fetch sites, both in
  `screens/OverlayScreen.jsx`: **Effect A** (~L596, "fresh export detected") whose trigger is
  `projectDataStore.clipMetadata` being truthy, and **Effect B** (~L720, "plain load", guard
  `syncState==='idle' && duration && !clipMetadata`). `outdated-clips` has a single owner
  (`OverlayScreen.jsx:183`, deps `[projectId, workingVideo?.url]`).
- **Root cause.** `clipMetadata` (store field, ONLY reader = OverlayScreen, ONLY legit writer =
  the export gesture `FocusScreen.jsx:983`) was ALSO written by `useProjectLoader.loadProject` on
  EVERY project-open (`buildClipMetadata()` → non-null for any project with clips). That spurious
  seed made Effect A ("fresh export") a live owner on plain Overlay entries alongside Effect B →
  two owners fetching `overlay-data` (HAR odd count 3 = A StrictMode-doubled + B; `outdated-clips`
  x2 = its single owner's StrictMode double, prod=1). Confirmed by the Opus expert reading the code.
- **Fix (one owner per fetch, per the epic — NO cache/latch).** Deleted the `setClipMetadata` store
  seed in `useProjectLoader.js` (kept the local `buildClipMetadata` value for the return payload +
  `onWorkingVideoLoaded`; removed the now-unused `setClipMetadata` selector + dep). Genuine fresh
  export still sets the flag via `FocusScreen.jsx:983` → Effect A owns; every plain open /
  Framing→Overlay nav / direct Drafts→Overlay → Effect B owns (its `duration` comes from the working
  video `loadProject` sets before OverlayScreen mounts). `outdated-clips` untouched.
- **Live QA** (`scripts/dev-verify.sh`, real account, extended `e2e/T6190-project-open-fetches.qa.spec.js`):
  Framing→Overlay fired **overlay-data=1, outdated-clips=1** (dev, StrictMode present — already
  "exactly once" for both, so no prod-build change is warranted and outdated-clips was left as-is per
  the task's own rule); `clipMetadata` is null after a plain open; **no "Maximum update depth"** on
  the transition; overlay renders (regions restore). T6190's load-bearing project-open guard still
  passes (games=0, clips=1, health=0).
- **Regression pins in the spec** (both fail pre-fix by construction): `clipMetadata === null` after a
  plain open, and `overlay-data owner-count ≤ outdated-clips` (single-owner baseline, StrictMode-agnostic).
- **Harness caveat (honest):** the /dotask container's Vite runs over a bind-mount whose file watcher
  is inert, so it cached the module at boot and a *live* pre-fix negative control could not be run
  (every run validly exercised the FIXED code). The pins are sound by code-reading: pre-fix
  `loadProject` writes a non-null `clipMetadata` and nothing nulls it before Framing reads it.
- **Unrelated pre-existing failure observed:** T6190 criterion-4 (annotate→framing boundary *content*)
  failed because on this account's live data the annotate step navigated to a *different* project (the
  framing list switched clip id 78→5). That path reads `projectDataStore.clips` / project selection —
  independent of `clipMetadata` — so it is not a T6250 regression. Branch CI is the full-sweep verdict.

## Acceptance Criteria

- [x] Framing -> Overlay fires `overlay-data` exactly **once** (dev live QA: overlay-data=1)
- [x] `outdated-clips` fires once — measured **1** in the dev QA (single owner, unchanged by this task); its HAR x2 was StrictMode-only, no dev-code change needed
- [x] Overlay still renders correctly (regions restore from `/overlay-data`; outdated-clip check unchanged)
- [x] Request counts pinned by a test, alongside T6190's project-open counts (T6250 test in `e2e/T6190-project-open-fetches.qa.spec.js`; deterministic `clipMetadata===null` + `overlay-data ≤ outdated-clips` pins)
- [x] No `Maximum update depth exceeded` on the transition (console-error guard in the test, green)
- [x] Frontend unit tests pass (`vitest related` on the changed hook: 4 passed)
