# T10750: Annotate entry fires a ~32x select+seek storm ("Maximum update depth exceeded")

**Status:** WAITING ON USER
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Problem

Entering Annotate (mode switcher, Focus -> Annotate) intermittently fires a burst of ~32 identical
select+seek round trips and React logs `Warning: Maximum update depth exceeded`. Noticed while
live-verifying T10740; confirmed INDEPENDENT of that change (it reproduces on runs where T10740's
guard never fires, and none of that code appears in the stack).

Reproduces roughly once every 3-6 Focus<->Annotate cycles on the dev stack.

## Evidence (captured live, real browser)

Console, ~32 iterations of exactly this pair, all identical:

```
[DetectionSeek] SEEK requested=181.290090s clamped=181.290090s videoElement=181.290090s requestedFrame=5439 clampedFrame=5439
[SelectClip] Found region: clip_1789932588875_jyz1v7pv8 actual: 181.29009 - 189.29009 seq: null state: NONE
```

Counts across one session: `[SelectClip] Found region` = 65, `[DetectionSeek] SEEK requested` = 67,
`[AutoDeselect] Deselecting` = **1**, `Maximum update depth` = 2. Capture reproducible via the steps in Acceptance Criteria (dev stack, cycle Focus<->Annotate).

Three facts that constrain the cause:

1. **The seek is already satisfied** — `videoElement=181.290090s` equals the requested target every
   time, so the seek is a no-op.
2. **The playhead is inside the region** (181.29 within 181.29-189.29), so the driver's `within`
   test should pass.
3. **`state: NONE` on every iteration** — that is `selectionState.type` logged inside
   `AnnotateContainer.handleSelectRegion` (`AnnotateContainer.jsx:1748`) immediately before it calls
   `selectClip(regionId)`. The selection never sticks.

The driver is the T3960 "re-select the source clip until it sticks" effect
(`AnnotateScreen.jsx:507-564`), bounded at 40 attempts (`L556`) — which is why the storm is
self-limiting rather than a hard hang. It is armed by the `pendingSourceClipId` breadcrumb written
in `App.jsx handleEditInAnnotate`, which every ->Annotate mode switch routes through.

React-internals note: the `Maximum update depth` **console.error** branch (as opposed to the throw)
is `nestedPassiveUpdateCount > 50`, and `checkForNestedUpdates` runs at the top of every
`scheduleUpdateOnFiber` — so the first setState after the counter trips gets blamed. The captured
stack bottomed out at `setIsSeeking` (`videoStore.js:57`) / `handleSeeking` (`useVideo.js:861`),
but that is the MESSENGER, not the culprit: a DOM-event-driven store write cannot be the passive
loop. Do not "fix" `setIsSeeking`.

## Root cause: React LANE STARVATION (expert, 2026-09-20 — verified against source)

The selection update is never **reverted**; it is never **rendered**.

1. `selectClip()` is called from a PASSIVE effect. `flushPassiveEffects` lowers priority, so every
   setState scheduled inside a `useEffect` is **DefaultLane**.
2. In the same effect body `effectiveSeek()` -> `useVideo.seek` (`hooks/useVideo.js:421`) writes
   zustand twice: `setIsSeeking(true); setCurrentTime(validTime)`. zustand always allocates a new
   state object, and `useVideo.js:127` subscribes **selector-less** (`useVideoStore()` destructure,
   VERIFIED), so the snapshot always differs -> `handleStoreChange` -> `forceStoreRerender` ->
   `scheduleUpdateOnFiber(..., SyncLane)` unconditionally, even for a value-identical write.
3. React renders SyncLane first, and `updateReducer` SKIPS any update whose lane is not in
   `renderLanes` — so the DefaultLane `{type:'SELECTED'}` is deferred and the hook renders
   `{type:'NONE'}`. **That is the `state: NONE` in the capture.**
4. That commit re-runs the effect, because `useVideo.seek` is a plain UNMEMOIZED function
   (`useVideo.js:421`, VERIFIED) -> `effectiveSeek` -> `handleSelectRegion` identity churns
   (`AnnotateContainer.jsx:1772`) -> the T3960 effect's dep list churns (`AnnotateScreen.jsx:564`).
5. It reads `annotateSelectedRegionId === null` (skipped, not reverted), selects+seeks again -> a
   new SyncLane update -> SyncLane is always pending and **DefaultLane starves**. It ends only at
   the 40-attempt cap.

Consistent with every observation: the 40-pair burst = the cap; `state: NONE` every time; refs
advance normally (refs are synchronous, lane-immune); no remount (a remount would STOP it).

**Consequence for the fix:** a retry effect CANNOT observe its own success here — the observation
channel (useState -> next render) is exactly what the loop starves. Any "re-issue until it sticks"
shape is unfixable in principle, not just buggy.

## Fix plan

**A (this task).** Delete the retry effect `AnnotateScreen.jsx:507-564` plus
`pendingSourceSelectAttemptsRef` / `pendingSourceClipIdRef`. A one-shot equivalent already exists:
`AnnotateContainer.jsx:1212-1228` (T740), fed by `handleLoadGame`, which nulls its ref
unconditionally so it fires exactly once. If matching by `rawClipId` (rather than seek time) is
required, carry the source clip id into that seam and widen ITS matcher — do NOT add a second path.
Success condition is data-in-hand, not observed-after-the-fact: `importAnnotations` RETURNS the
created regions (`useAnnotate.js:766`), so the target region is known synchronously at the load
seam. Select once, drop the breadcrumb. A later auto-deselect because the playhead is out of range
is CORRECT behavior, not a retry trigger.

**B (separate task — the amplifier, T6190's lesson applied to videoStore).** `useVideo.js:127`
should use selector-scoped reads (`useVideoStore(s => s.x)`), and the returned actions (`seek`,
`play`, `pause`, `togglePlay`, `step*`) should be `useCallback`-wrapped. Unmemoized functions in
published dep lists are what re-arm every effect on this screen each render.

**C (separate task — real, visible in the same log).** `useVideo.js:424`
`const effectiveDuration = duration || (clipDuration ?? videoRef.current.duration) || 0` silently
clamps a legitimate seek to 0 when duration is not yet known. Log line 95:
`SEEK requested=181.290090s clamped=0.000000s` — which caused the single legitimate `[AutoDeselect]`
on line 96. This is the banned silent-fallback-on-internal-data pattern (CLAUDE.md); it should
refuse or defer, not clamp to 0.

## Superseded: earlier open question (kept for the record)

Why does the selection never stick? `selectClip` writes `{type:'SELECTED', clipId}` into
`useClipSelection`'s `useState` (`modes/annotate/hooks/useClipSelection.js:40-42`), yet the next
iteration reads `NONE` — and `AnnotateScreen.jsx:553` (`if (isSelected) return;`) should have ended
the retry after one success. Candidates: the hook is remounted each iteration (state resets to its
`{type:'NONE'}` initial); there are two `useClipSelection` instances so the written state is not the
one `annotateSelectedRegionId` derives from; or an unlogged writer resets to NONE (it is NOT
`AnnotateContainer.jsx:1806` — that path logged once).

Note: a first expert pass proposed "make `selectClip`/`editClip` idempotent" (they allocate a fresh
object every call, unlike `closeOverlay`/`deselectClip` right below them which correctly bail via
the functional form). That is a real latent wart, **but it cannot be the fix here** — if the state
is genuinely `NONE` at every call, NONE -> SELECTED is a real transition and an idempotency guard
would never fire.

## Severity

The **warning** is dev-only (that React branch does not exist in the production build). The **loop**
is real: up to 40 select+seek round trips on entering Annotate, which means selection flicker /
playhead jumps, and on a cold R2 object a burst of range requests. Not an emergency; worth fixing
properly rather than silencing.

## Acceptance Criteria

- [ ] Root cause identified with file:line proof (why selection does not stick)
- [ ] Entering Annotate issues ONE select + ONE seek, verified in a real browser by the console
      signature above
- [ ] No `Maximum update depth exceeded` across 10 consecutive Focus<->Annotate cycles
- [ ] The retry effect is either removed or given a success condition it can actually observe
- [ ] Fix is not a guard that papers over the loop (CLAUDE.md: no defensive fixes for internal bugs)
