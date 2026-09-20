# T10740: Focus loads the previous project's clip and reports it as an expired video

**Status:** WIP
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

Red-green unit coverage in `src/frontend/src/screens/FocusScreen.staleClipGuard.test.jsx`.

## Acceptance Criteria

- [ ] Focus never requests a clip id against a project id it does not belong to
- [ ] A 4xx from `playback-url` does not silently retry `/stream` and does not surface as "expired"
- [ ] The Annotate -> Frame navigation still loads the correct clip once the fresh list lands
- [ ] New tests fail without the fix, pass with it; existing Focus/annotate specs stay green
