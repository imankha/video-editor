# T4540: frameMath Module + One Canonical Framerate Source

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-03
**Source:** Audit items C7 + frontend-sync #19 ([audit doc](../audit-2026-07-03-code-quality.md))

## Problem

[DRY][DEP] Frame↔time math is scattered and the framerate that feeds it is fiction in places:

- `utils/videoUtils.js` `getFramerate()` (:81-85) is a stub that **always returns 30**.
- `framerate || 30` silent fallbacks in 8+ files: `useClipManager.js:46`, `projectDataStore.js:402`, `FramingContainer.jsx:238`, `videoStore.js:114`, `FramingScreen.jsx:219/541/623`, `useCrop.js:66`; hardcoded `fps = 30` twice in `useMultiVideoScrub.js:126-157` and in `useHighlightRegions.js:40`; backend twin at `projects.py:1256`.
- Frame-step logic (round-to-frame, ±1, clamp) implemented in `useVideo.js:443-474` AND `useMultiVideoScrub.js:126-157`; `timeFormat.js` `seekToFrame` (:144-149) re-composes timeToFrame+frameToTime.

Why it matters: keyframes are frame-based; wrong fps silently shifts every frame↔time conversion — the exact class of the near-duplicate-keyframe prod bugs (T3800 family). One clock source is also a [DEP] win: no consumer depends on WHICH code path computed its frames. `useProjectLoader.js:150-164` already does the correct boundary pattern (warn + probe on missing fps) — downstream `|| 30` re-hides what it surfaces.

## Solution

1. **`utils/frameMath.js`** — pure: `timeToFrame(t, fps)`, `frameToTime(f, fps)`, `stepFrame(t, fps, ±1)`, `snapToFrame(t, fps)`. All step/seek call sites use it; delete the copies (incl. the stub `getFramerate`).
2. **One canonical framerate selector** — clip-scoped: fps lives on working_clips (T1500) and reaches the frontend via `clipMetadataCache`/video metadata. Find where the guarded value lands (useProjectLoader's probe) and expose ONE accessor (e.g., selector on projectDataStore or `videoStore.getFramerate` — pick whichever is already closest to owning it; record the decision). It may return null; per the no-silent-fallback rule, consumers `console.warn` and handle null — they do NOT default to 30.
3. Sweep the `|| 30` sites to the accessor. Backend `projects.py:1256` gets a `# audit C7` note only (backend fps handling belongs to the migration that put fps on working_clips — check whether the rescale path can read the row's real fps; if trivially yes, fix it here too).

## Steps

1. [ ] frameMath + unit tests (incl. fractional fps like 29.97 — rounding decisions documented).
2. [ ] Framerate ownership decision (Progress Log) + accessor + warn-on-null.
3. [ ] Mechanical sweep, one commit per area (framing / overlay / annotate / stores); frontend tests + editor E2E after each.

## Acceptance Criteria

- [ ] `grep -rn "|| 30\|= 30" src/frontend/src` shows no framerate fallbacks (test constants excepted)
- [ ] One frame-step implementation; one framerate accessor
- [ ] Missing fps warns and is handled, never defaulted
- [ ] 29.97-style fps covered by tests
