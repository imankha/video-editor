# T10230: Re-verify the three React #185 crash paths on redeployed staging

**Status:** WAITING ON USER
**Impact:** 10
**Complexity:** 2
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

The user's 2026-09-17 staging run hit `Minified React error #185` (Maximum update depth exceeded)
three times on the `hello@reelballers.com` staging account:

1. clicking the stage CTA on the only marked play in the only game (rendered as "View Final");
2. opening a freshly uploaded clip from the Clips tab;
3. going to Framing directly.

Code trace (2026-09-17) shows **all three converge on one surface**: `openClipInFocus` /
`DraftTile.handleCardClick` / `useProjectLoader` (`targetMode = mode || 'framing'`) all land in
`FocusScreen` -> `FocusModeView` -> `useVideoDisplayRect`. That is exactly the surface T10200
fixed (commit `2fefc85a`, a fresh `panOffset` literal per render). The staging frontend deploy
carrying T10200 completed **2026-09-17 10:49 UTC**; the user's run may have pre-dated it or hit a
service-worker-cached bundle (the Fast App Update epic documents that a waiting bundle can sit
for a long time).

## Solution

Verification first, then root-cause only if it still reproduces:

1. Hard-reload staging (bypass the SW: DevTools > Application > Service Workers > Update, or an
   incognito window) and confirm the bundle hash differs from `vendor-react-CGAGbR8z.js` /
   `index-VfqkVJmd.js` quoted in the report.
2. Drive the three paths on `hello@reelballers.com` via the drive-app-as-user skill with the
   console captured. Also re-run T7170's real-browser flicker check while there (its pending
   staging step).
3. If any path still throws #185 on the current bundle: capture the component stack with the
   non-minified build (dev stack against the same account data), then escalate to the expert
   agent with `useVideoDisplayRect`'s remaining reference-typed deps (`metadata`, the
   `videoRef`/container path) as the starting hypothesis. Do not guess-fix.
4. Record the verdict on T10200's PLAN.md row and on T9950's flag.

## Context

### Relevant Files
- `src/frontend/src/modes/FocusModeView.jsx:144,338` (T10200 fix, `PREVIEW_ZERO_PAN`)
- `src/frontend/src/hooks/useVideoDisplayRect.js:165` (reference-typed effect deps)
- `src/frontend/src/screens/AnnotateScreen.jsx:230-243` (`openClipInEditorMode`)
- `src/frontend/src/components/DraftTile.jsx:212-246`, `src/frontend/src/hooks/useProjectLoader.js:120`
- `src/frontend/src/modes/FocusModeView.outputPreview.test.jsx` (T10200 regression test)

### Related Tasks
- Depends on: T10200 (STAGING)
- Related: T10240 (the CTA should not have said "View Final" at all), T7170 flicker check

## Acceptance Criteria

- [x] All three paths open Framing without a console error on the current staging bundle
- [x] Bundle hash recorded in the progress log, with the account and timestamps
- [x] If reproduced: root cause identified by the expert agent and fixed with a regression test — N/A, not reproduced

## Progress Log

**2026-09-17**: Verified live on staging via dev-login as `hello@reelballers.com`
(`POST /api/auth/dev-login` + `X-Test-Mode` header — staging allows this gated path, real R2
data, no password needed). Deployed bundle confirmed different from the reported one before
even opening a browser: `curl` against `reel-ballers-staging.pages.dev` showed
`index-BcKA4cM1.js` (report quoted `vendor-react-CGAGbR8z.js` / `index-VfqkVJmd.js`). Backend
`x-app-version: db822c59...` (past T10200's fix commit).

Drove all three paths with Playwright, console captured throughout:
1. **View Final stage CTA** — Annotate -> "Great Control Pass" play -> Clip Details -> "View
   Final" button -> navigated to `/focus`, 0 console errors, clip list rendered correctly.
2. **Freshly uploaded clip from Clips tab** — clicked the Draft tile `VID_20260905_094101` on
   the home screen -> navigated straight to `/focus` in Framing (no working video, no
   clips-in-progress, so `useProjectLoader`'s `targetMode` default fired), 0 console errors.
   This is the same `DraftTile.handleCardClick` -> `useProjectLoader(mode=null)` code path as
   "go to Framing directly", confirmed by reading `DraftTile.jsx:239-245` and
   `useProjectLoader.js:120` — both user-facing scenarios converge on one click in this
   account's current data shape.
3. **Framing tab from Focus** — clicked the Framing tab directly from a loaded project, 0
   console errors.

Full console across the whole run: 11 messages total, 0 errors except one benign pre-login 401
on `/api/auth/me` (expected — that request fired before the dev-login cookie existed). No #185,
no infinite-render warnings. **Verdict: not reproducible on the current staging bundle** — the
2026-09-17 user report predated the 10:49 UTC deploy or hit a stale service-worker bundle, per
the original hypothesis. No expert escalation needed.

**T7170 flicker check**: attempted on the same account, but its Clips grid only has 2 tiles
(one Draft, one Ready-to-watch) — too sparse for a real "fast mouse pass across a grid"
strobe test. A rapid hover pass across both fired zero video/preview network requests (no
request-storm) and no console errors. Source confirmed
`PREVIEW_REVEAL_DELAY_MS = 0` / `PREVIEW_WARM_DELAY_MS = 100` unchanged
(`useTilePreview.js:39,46`). Given this is a pure floor-constant change with the WARM guard
untouched, residual risk is low, but a definitive visual-strobe verdict needs an account with a
larger tile grid — noting this honestly rather than claiming a stronger check than was run.

PLAN.md updated: this row, T10200's row, and T9950's flag all carry the re-verify verdict.
Status set to WAITING ON USER — no code shipped, nothing to merge, just needs the user's
Resolve.
