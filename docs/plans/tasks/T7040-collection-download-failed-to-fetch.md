# T7040: Collection download fails with "TypeError: Failed to fetch"

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-08-14
**Updated:** 2026-08-14

## Problem

User report 2026-08-14 on staging: clicking Download on a collection shows "Could not download
collection," console: `[DownloadsPanel] collection download failed: TypeError: Failed to fetch`.
This is T4945's new endpoint (merged to master/staging today) — genuinely broken on first real
use, not yet field-proven.

`TypeError: Failed to fetch` is fetch()'s generic network-level failure — it means the browser
never received a usable HTTP response at all (as opposed to a 4xx/5xx, which `useDownloads.js
::downloadCollection` would report as `Collection download failed: <status> <statusText>`, a
different message). Something is failing BEFORE or DURING the response, not after.

## Evidence gathered so far

**HAR** (`Downloads/downcollection.har`, user-provided): only **one** entry captured —
```
OPTIONS /api/collections/download?scope_type=game&aspect_ratio=9:16&game_id=6  -> 200, 20.5ms
```
The CORS preflight succeeds cleanly and fast. The actual `GET` that should follow is **not in
the HAR at all** — either the capture was stopped before it resolved, or the request never
completed in a way DevTools captured. This doesn't yet distinguish between the hypotheses below;
the preflight succeeding does rule out a blanket CORS misconfiguration for this route+origin.

**Backend logs** (`fly logs -a reel-ballers-api-staging`): no `/api/collections/download` line
found in the windows captured (~100 lines each, multiple captures) — inconclusive, staging has
enough concurrent traffic that a short capture can easily miss the exact moment; this should NOT
be read as proof the request never reached the backend.

**Ruled out**: the new `stitch_members` Modal function (T4945's `MODAL_ENABLED=true` path,
CPU-only `gpu=None`) genuinely exists and hydrates successfully against the live
`reel-ballers-video-v2` Modal app right now — confirmed directly via
`modal.Function.from_name('reel-ballers-video-v2', 'stitch_members').hydrate()`. This is NOT a
"function was never deployed" problem.

## Hypotheses (unconfirmed — need live investigation with proper server-side error capture)

- **A — mid-stream failure after headers are already sent.** T4945's endpoint builds a
  `StreamingResponse` after resolving members/card/keys up front (the T5220 closed-connection
  gotcha it was explicitly built to avoid) — but if an exception occurs INSIDE the generator
  itself (during the member concat, the Modal call, or `compose_serve_time`) AFTER the response
  has already started streaming with a 200 and headers, the connection drops abnormally. The
  browser reports exactly `TypeError: Failed to fetch` in this case (not a clean error status),
  because CORS/response headers were already committed to a 200 that never completes. This is
  the leading hypothesis — it explains BOTH the generic client error AND why a short log capture
  might miss the actual exception (buried mid-stream, easy to scroll past without an obvious
  "ERROR" marker if it's logged at a lower level or inside a broad except).
- **B — the specific collection (`game_id=6`, scope=game) has zero or unstitchable members** —
  worth checking directly: does `evaluate_collection_members` return anything for this scope on
  the account that hit this? An empty or degenerate member list feeding into `concat_segments`
  could hang or throw in a way that isn't handled as a clean 4xx.
- **C — Modal cold start exceeds an intermediate proxy timeout.** `stitch_members` existing
  doesn't mean it's been invoked recently on staging; a cold Modal container plus multiple R2
  member fetches plus concat could take longer than a proxy timeout (Fly's reverse proxy or any
  intermediate hop) tolerates for a still-100%-server-side phase (nothing streamed to the client
  yet), causing the connection to be killed before the app can even finish resolving members.

## Next steps for whoever picks this up

1. **Get real server-side visibility on this exact failure** — either reproduce live while
   tailing `fly logs -a reel-ballers-api-staging` in real time (don't rely on short retrospective
   captures like this investigation did), or temporarily add explicit try/except logging around
   the generator body in `collections.py::download_collection` if none exists.
2. Reproduce with the SAME collection (`game_id=6`, `aspect_ratio=9:16`) to control for
   Hypothesis B.
3. Time the reproduction end-to-end to test Hypothesis C (a Modal cold start + cold concat can
   reasonably take 10-30s+; if the failure happens right around a known proxy timeout window,
   that's a strong signal).

## Context

### Relevant Files
- `src/backend/app/routers/collections.py` — `download_collection` (T4945), the streaming
  generator this task needs to instrument/harden
- `src/backend/app/services/modal_client.py` — `call_modal_stitch_members`
- `src/backend/app/modal_functions/video_processing.py` — `stitch_members` (~line 3180)
- `src/frontend/src/hooks/useDownloads.js:221` — `downloadCollection`, the fetch() call that
  surfaces the generic error
- `src/frontend/src/components/collections/DownloadsPanel.jsx` — where the console error line
  the user saw is logged
- HAR evidence: `Downloads/downcollection.har` (user-provided, not committed)

### Related Tasks
- Follows: T4945 (core stitch + owner download, merged 2026-08-14) — this is that endpoint's
  first real-world failure
- Blocks: real confidence in T4945 before T4946 (access control) exposes this endpoint further

### Technical Notes
- Not a T4946 scope question (access/credits) — this is the T4945 mechanism itself failing.
- Since collection downloads are free (Decision 4, resolved 2026-08-14), there's no credit-loss
  risk from a failed attempt, but a broken first impression on a just-shipped feature is worth
  prioritizing.

## Acceptance Criteria
- [ ] Root cause confirmed with real evidence (not just the three hypotheses above)
- [ ] A collection download succeeds end-to-end on staging for the reported scope
- [ ] If the fix is generator error-handling: a failure now surfaces as a clean HTTP error status
      the frontend can report meaningfully, never a bare "Failed to fetch"
- [ ] Regression test covering whatever the actual root cause turns out to be
- [ ] Tests pass
