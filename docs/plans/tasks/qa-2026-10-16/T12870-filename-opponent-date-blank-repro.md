# T12870: Opponent and date stayed blank for "2026-10-10 Vs Rangers.mp4" although the parser reads both

**Status:** STAGING
**Impact:** 3
**Complexity:** 2
**Tier:** S/M (repro first; fix size unknown)
**Created:** 2026-10-16
**Milestone:** Next build (external QA 2026-10-16). Prod never parses this filename format, so it does not block the deploy.

## Problem

External QA C02 ([report](../../ux/2026-10-16-external-qa/QA-REPORT.md), screenshot
`screenshots/C02_game-details_1440x900_filename-not-parsed.png`). Upload of `2026-10-10 Vs Rangers.mp4`
produced the title "2026-10-10 Vs Rangers" but Game Details showed Opponent and Game Date empty.

## What was checked (2026-10-16)

- The staging parser handles it: `parseGameFilename('2026-10-10 Vs Rangers.mp4', null)` on
  `origin/master` returns `{opponentName: 'Rangers', gameDate: '2026-10-10'}` (run directly with node).
- The staging build the tester used included ba61023e3 (deploy-frontend for b4f3665d5 succeeded
  2026-10-15 05:19 UTC).
- `GameDetailsModal.handleFootageChange` (`:115-130`) prefills opponent/date only on the FIRST file pick
  of a dialog session (`autofillTriedRef`), and `submitGame` sends whatever the fields hold.
- A title equal to the raw filename is the backend's no-opponent fallback (`games.py:262-275`), so
  the submit most likely sent no opponent.

Open possibilities: the file reached the dialog through a path that skips `handleFootageChange` (drop on
Games, `initialFiles` prefill via `ProjectManager.jsx:2412`, `AddFootageButton.jsx:276`), the autofill
ref was already spent by an earlier pick in the same dialog (the tester tried other files), or the
values were cleared.

## Solution

Reproduce on staging through each entry path (dialog pick, re-pick after a rejected file, drag-drop /
prefill). Fix the path that skips or spends the autofill; add a regression test for this exact name in
`gameNameParser.formats.test.js` and a component test for the failing entry path.

## Acceptance Criteria

- [ ] Repro recorded (which entry path) or "not reproducible" with the paths tried
- [ ] If reproduced: red-first test for that path, then Opponent "Rangers" and date 2026-10-10 are saved and shown in Game Details
