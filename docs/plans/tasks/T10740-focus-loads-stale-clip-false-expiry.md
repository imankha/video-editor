# T10740: Focus loads the previous project's clip and reports it as an expired video

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 3
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Problem

Reported live by the user. In Annotate: select a play with no project, click **Frame Later**, get the
"... is now in Clips" toast, then immediately click **Frame** on a play. Focus opens and shows
*"This video is no longer available. Its source storage may have expired."* The source had NOT
expired — retrying the same play minutes later worked.

The user's read was that the UI promised readiness before the clip was ready. That is not what
happened: nothing about the clip was un-ready. Focus asked the backend for **the wrong clip**.

## Root Cause

A client-side project-id/clip-id mismatch during the Annotate -> Focus navigation window.

1. Project creation is fully synchronous (`_create_auto_project_for_clip`, `clips.py:1073`) and
   `durable_sync` lands it in R2 before the 200. The toast (`announceReelCreated`,
   `AnnotateContainer.jsx:89`) is honest — the clip really is in Clips.
2. `App.handleModeChange` (`App.jsx:715-728`) fires `invalidateClips(activeProjectId)`
   **fire-and-forget** and switches editor mode immediately.
3. `invalidateClips` -> `fetchClips` (`projectDataStore.js:140-185`) only writes `clips` when the
   response lands, and nothing calls the existing `clearClips` on this path. For that window the
   store still holds the **previous** project's `clips` and `selectedClipId`, and the clips list
   carries no project identity at the store level.
4. `FocusScreen`'s mount loader (`FocusScreen.jsx:578-597`) has `[]` deps, so it fires immediately
   against that stale list: `targetClip = clips.find(selectedClipId) || clips[0]`.
5. `getClipVideoConfig` requests `/api/clips/projects/{NEW_project_id}/clips/{OLD_clip_id}/playback-url`
   (`FocusScreen.jsx:484`). The backend matches on `WHERE wc.id = ? AND wc.project_id = ?`
   (`clips.py:2459`), so it correctly answers **404 Clip not found**.
6. The catch at `FocusScreen.jsx:507-518` **silently falls back to the `/stream` proxy with the same
   mismatched pair**, which 404s identically, and hands that dead URL to `<video>`.
7. `useVideo` probes the dead src, sees 404, and `videoErrorClassifier.js:76` maps it to
   `VIDEO_UNAVAILABLE` -> the expiry copy at `useVideo.js:1216`.

**Proof it was never a real expiry:** a genuinely reclaimed source returns 410, and
`FocusScreen.jsx:489-496` returns `{url: null, sourceExpired: true}` and renders the T8310 expired
panel — no `<video>` is ever mounted. The user saw `useVideo`'s player error, which proves the
response was a 404, not a 410.

**Why it healed on retry:** the 60s per-clip config cache (`FocusScreen.jsx:460`) pins the bad
`/stream` URL for that visit; by the next visit the store already holds the correct project's clips,
so the ids match.

## Fix

Two source-level changes. No UI readiness gate, and no toast/CTA copy change — there is no readiness
gap to wait for.

1. **Identity guard (root cause).** `FocusScreen`'s clip loaders refuse to act on any clip whose
   `clip.project_id` does not match the screen's `projectId`. `project_id` is a required field on
   every clip row (`WorkingClipResponse`, `clips.py:207`), so this needs no new state and no new
   store field (no-redundant-state: the identity is already in the data).
2. **Kill the silent fallback (what masked it).** A 4xx from our own `playback-url` no longer
   re-routes to the `/stream` proxy — it logs loudly and resolves to no URL. The proxy fallback is
   retained only for transport failures and 5xx, which is what it was actually for. Per CLAUDE.md
   *No silent fallbacks for internal data*: a 404 from our own endpoint is an internal bug, not a
   condition to route around.

## Tests

Red-green unit coverage in `src/frontend/src/screens/clipVideoResolution.test.js` (13 assertions).
Verified red by temporarily reverting the module to the behavior under test: 3 failed against the
pre-fix behavior, and 4 more against the pre-review behavior (see Review outcome). 74/74 green
across the relevant set (this file + `focusOverlayTransition`, `focusCompletionPreview`,
`focusBackToPreview`, `FocusModeView.clipIdentity`, `AnnotateModeView.frameClip`,
`AnnotateContainer.createAtTap`, `AnnotateContainer.reelCreated`).

## Review outcome (Reviewer agent, fresh context, 2026-09-20)

Verdict NEEDS REVISION on the first commit; all three findings verified against source and fixed in
the follow-up commit.

1. **BLOCKING — strict `!==` failed CLOSED on a type mismatch.** `selectedProjectId` is a STRING on
   the auth-return and payment-return paths: both stash it in `sessionStorage`
   (`authStore.js`, `BuyCreditsModal.jsx`) and `projectsStore.selectProject` stores the argument
   verbatim. Clip rows carry a numeric `project_id`, so `41 !== "41"` would have called EVERY clip
   foreign and left Focus permanently blank there — worse than the bug being fixed, because nothing
   heals it, and the payment path auto-fires an export whose `saveCurrentClipState` would then
   persist EMPTY crop keyframes (the T4020 empty-shadow class). Fixed by comparing as strings (fails
   OPEN on a type mismatch), plus a `Number()` coercion at both `sessionStorage` read sites so the
   store stops holding a string at all.
2. **MAJOR — the blanket "no fallback on any 4xx" rule broke legacy videos.** Only 404 is provably
   shared by the two endpoints (identical `WHERE wc.id = ? AND wc.project_id = ?` row query). 422 is
   NOT: `get_clip_playback_url` raises it when the game video has no blake3 hash, before presigning,
   while `/stream` has no such check and `get_game_video_url` presigns the pre-T80 per-user
   `{user}/games/{filename}` object. The clips list still populates `game_video_url` for those rows,
   so for a blake3-less legacy game the proxy is the path that works. Narrowed to 404 only.
3. **MAJOR — doc named a test file that was never written** (`FocusScreen.staleClipGuard.test.jsx`).
   Corrected above.

Accepted-with-pushback: the Reviewer also asked for a render-level test pinning that the clip-switch
effect's bail precedes `restoreSegmentState`/`restoreCropState`. `FocusScreen` is ~1600 lines and
has no existing render harness (every test on this screen targets extracted pure modules), so a
mount test would be a large, flake-prone lift for one ordering assertion the Reviewer verified by
reading. Real-browser verification of the actual reported flow is the stronger evidence and is the
open item below.

## Live verification (real browser, dev stack, 2026-09-20)

Drove the REPORTED flow as the real account (`dev-login` as imankh@gmail.com, Playwright), by
clicking only — no store manipulation:

1. Home -> clip tile "adf" -> Focus opens on project 1 (this is the ordinary gesture that leaves
   project 1's clips in the store).
2. Mode switcher -> Annotate.
3. Select the project-less play "Play 2" -> both "Frame Now" and "Frame Later" render (the
   reported starting state).
4. "Frame Later" -> toast `Play 2 is now in Clips` (verbatim the reported notification).
5. "Frame" stage CTA -> Focus.

The stale condition REPRODUCED, and the guard caught it — console, 4x:

```
[Framing] Ignoring stale clip 1 from project 1 while this screen is project 6 - waiting for the fresh clips list
```

Result: clip-video requests were `projects/1/clips/1/playback-url -> 200` and
`projects/6/clips/6/playback-url -> 200`. **No mismatched pair, no 404** — pre-fix this is exactly
where `projects/6/clips/1/...` would have gone out, 404'd, silently retried `/stream`, and surfaced
as the false expiry. On screen: no expiry copy, correct clip ("Play 2"), `<video>` at
`readyState 4` off R2.

Unrelated observation, NOT caused by this change and NOT fixed here: a React
`Maximum update depth exceeded` warning fires intermittently on the Focus -> Annotate transition
(seen on 2 of 3 runs, including runs where this task's guard never fired at all — same code path,
different outcomes, so it is a pre-existing flaky condition in that transition, likely the T6190
hazard class). Worth its own ticket.

Dev data created for this check (a probe play, and the project "Frame Later" made) was deleted
afterwards; dev is back to its prior state (2 plays, 1 project).

## Acceptance Criteria

- [x] Focus never requests a clip id against a project id it does not belong to
- [x] A 404 from `playback-url` does not silently retry `/stream` and does not surface as "expired"
- [x] A 422 (legacy blake3-less video) still falls back to the proxy
- [x] A string `projectId` never causes a legitimate clip to be rejected
- [x] New tests fail without the fix, pass with it; existing Focus/annotate specs stay green
- [x] Real-browser check of the reported flow: Frame Later -> Frame loads the correct clip
      (stale condition reproduced live, guard fired, no mismatched request, no false expiry)
