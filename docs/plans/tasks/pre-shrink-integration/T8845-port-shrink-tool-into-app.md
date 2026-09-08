# T8845: Port the approved standalone shrink tool into the app (worker + client API)

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-07
**Updated:** 2026-09-08

## Problem

T8840 builds and proves the whole shrink pipeline as a standalone tool the user tests
directly (user direction 2026-09-07: no integration until it works completely on its
own). Once the user signs off, the app needs the same pipeline as an in-app Web Worker
with a small main-thread API, so T8850 (crop UI) and T8860 (upload integration) can
build on it. This is the mechanical port, not a redesign.

## Solution

Move `scripts/shrink-tool/pipeline/*.js` (already DOM-free ESM by T8840's design) into
`src/frontend/src/services/shrink/`, wrap them in `shrinkWorker.js` behind the message
protocol, expose `shrinkClient.js`, and add `mp4box` + `mp4-muxer` to the app's
`package.json`. Behaviour must be identical to the tool the user approved - the tool's
own smoke fixture + frame-count equivalence check run against the ported modules.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/services/shrink/shrinkWorker.js` - NEW: worker entry; message
  protocol `{cmd:'start', file, crop, preset}` / `{cmd:'cancel'}` in;
  `{type:'progress', framesDone, framesTotal, fps}` (throttled ~2/s), `{type:'done',
  file}` (`{orig-stem}.shrunk.mp4` from the OPFS output), `{type:'error', stage,
  message}` out
- `src/frontend/src/services/shrink/shrinkClient.js` - NEW: `shrinkFile(file, crop,
  preset, {onProgress, signal})` -> Promise<File>, one worker per call, AbortSignal ->
  cancel
- `src/frontend/src/services/shrink/{demux,decode,cropScale,encode,mux,checkpoint,probe,presets,autoCrop,shrinkSegment}.js`
  - MOVED from `scripts/shrink-tool/pipeline/` (git mv; no behaviour change in the move
  commit, per the refactoring rules). Plus whatever the research epic added there
  (`decision.js` from T9040, `cropPath.js` from T9050) - port the folder as it stands at
  the end of research, per its hand-off note
- `src/frontend/src/services/shrink/capability.js` - `canShrink(codec, w, h)` memoized
  per codec string + the runtime speed probe -> Modal fallback decision (the tool's
  "too slow" verdict becomes "use server-side" here; T9040's `decideShrink` supplies the
  rule if it landed)
- `src/frontend/package.json` - add `mp4box` (2.4.1 exact) + `mp4-muxer`
- `scripts/shrink-tool/` - re-pointed at the app modules or deleted (decide: keeping the
  tool alive as a dev harness is useful for future regressions; if kept, it imports
  from `src/frontend/src/services/shrink/`, never the reverse)

### Related Tasks
- Depends on: **the Pre-Shrink Research epic complete**
  ([../pre-shrink-research/EPIC.md](../pre-shrink-research/EPIC.md)) - in particular
  T9000 (the user's real-folder sign-off on T8840, the hard gate this task always had),
  T9040 (decision rule, if it changes `pipeline/`), T9050 (crop path shape, if
  adopted); T8838 (share the probe module)
- Blocks: T8850, T8860

### Technical Notes
- Moves are mechanical commits; the worker/client wrapper is the only new code.
- The output file goes through the EXISTING upload path (hash, dedupe, probe, T1380
  relocation) untouched - from the backend's perspective it is just a video file.
- Keyframe cadence for output: force a key frame every 2 s (`keyFrame: true` at
  interval) so later seek/annotate behaviour on the uploaded file is sane (carry from
  the tool if T8840 already did it; add here if not).
- All T8840 caveats remain binding.
- Per-segment crops (and a crop PATH if T9050 adopted one) travel in the worker
  protocol's `crop` field; the message shape above is the minimum, extend it in the
  same commit as the port if the pipeline's `crop` type changed.

## Implementation

### Steps
1. [ ] `git mv` the pipeline modules; app build green with no behaviour change.
2. [ ] `shrinkWorker.js` + `shrinkClient.js` around them; `capability.js` with the
   Modal-fallback decision.
3. [ ] Tests: worker-protocol test with a mocked worker (sequencing, cancel, error
   propagation); the tool's synthetic-fixture smoke re-run against the ported modules
   (frame-count equivalence); presets/checkpoint unit tests move with their modules.
4. [ ] Manual: shrink the real 3.3 GB segment through `shrinkClient` on the local stack
   and upload the result through the normal path; it lands fast-start on R2 and plays.

### Progress Log

**2026-09-07**: Filed when T8840 was re-scoped to a standalone tool (user direction).

**2026-09-08**: Moved from `docs/plans/tasks/universal-upload/` into the new Video
Pre-Shrink milestone (Pre-Shrink Integration epic). Content unchanged except: links,
dependency on the Pre-Shrink Research epic, and the note that the port covers
`pipeline/` as it stands after research (not the T8840 snapshot).

## Acceptance Criteria

- [ ] Ported modules are byte-identical in behaviour (smoke fixture frame counts match
      the tool's)
- [ ] `shrinkClient.shrinkFile` on the real 3.3 GB segment produces a playable output
      that uploads through the untouched normal path
- [ ] Cancel and error paths covered by the protocol test
- [ ] No app code imports anything under `scripts/`
