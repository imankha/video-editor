# T12780: Take the old tutorial video links off the landing site

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Tier:** S/M (landing only, ~3 files, display-only)
**Created:** 2026-10-14
**Updated:** 2026-10-18
**Milestone:** Deploy Candidate (P1), see PLAN.md

## Problem

User, 2026-10-14: "for now we don't have tutorial videos (the old ones are no longer relevant so
don't link to them)." The videos at `assets.reelballers.com/tutorials/*` were shot 2026-08-17
(T5140) and show retired screens and words (see T10320's vocabulary list). The app already links
none of them (`TUTORIAL_VIDEOS_ENABLED = false` in `src/frontend/src/config/questDefinitions.jsx:41`
and `src/backend/app/quest_config.py:44`). The landing site still plays them from eight triggers:

| Page | Line (origin/master 2026-10-14) | Trigger |
|---|---|---|
| `src/landing/src/pages/index.astro` | 146 | hero `data-tutorial="full"` |
| `src/landing/src/pages/index.astro` | 220, 238, 260 | step thumbnails `learn` / `elevate` / `celebrate` |
| `src/landing/src/pages/how-it-works.astro` | 107 | "Watch the full walkthrough" (`full`) |
| `src/landing/src/pages/how-it-works.astro` | 142, 149, 156 | step thumbnails `learn` / `elevate` / `celebrate` |

All are opened by `TutorialLauncher` (mounted at `index.astro:423`, `how-it-works.astro:169`).

## Solution

Remove every `data-tutorial` trigger and both `TutorialLauncher` mounts. Where a trigger is a
thumbnail inside a step card, keep the card's image and text as plain, non-interactive content (no
play icon, no button role, no "Play" aria-label); where it is a standalone CTA ("See how it works",
"Watch the full walkthrough"), remove it or point it at the in-page how-it-works section, without
any copy that promises a video. Keep `TutorialLauncher.tsx`, `TutorialModal.tsx` and
`config/tutorials.ts` in the tree (T10320 brings them back with the reshoot); note that in each
file's header comment. Do not delete the R2 assets.

## Context

### Relevant Files
- `src/landing/src/pages/index.astro`, `src/landing/src/pages/how-it-works.astro`
- `src/landing/src/components/TutorialLauncher.tsx`, `TutorialModal.tsx`, `src/landing/src/config/tutorials.ts` (comments only)

### Related Tasks
- T10320 (reshoot) re-adds the links with the new videos, and adds the in-app entry (decision 2A)
- Ships with `/deploy-landing`, independent of the app deploy

## Acceptance Criteria

- [x] `git grep -n "data-tutorial=" -- src/landing/src/pages` returns nothing; no page imports `TutorialLauncher`
- [x] No visible copy on either page promises a video ("watch", "walkthrough", play icons)
- [x] Landing build passes and both pages render with no layout gap at 390 and 1440 (screenshots)
- [x] A browser check confirms no request to `assets.reelballers.com/tutorials/` on either page

## Evidence (2026-10-18)

- Changes: hero "See how it works" is now an in-page link to `#how-heading`; "See the full walkthrough" became "See every step" (links /how-it-works); how-it-works "Watch the full walkthrough" button removed; "soccer walkthrough" became "soccer guide"; the six thumbnails are plain `div`s with no hover zoom, button role or aria-label; both `TutorialLauncher` mounts and imports removed; header notes added to `TutorialLauncher.tsx`, `TutorialModal.tsx`, `config/tutorials.ts`.
- `npm run build` in `src/landing`: exit 0, 33 pages.
- Browser check (Playwright, scratch script; per page at 390x844 and 1440x900: count `[data-tutorial]`, open dialogs after clicking the former triggers, requests containing `/tutorials/`, copy containing walkthrough / watch the full / play the / tutorial, horizontal overflow):
  - BEFORE, live https://reelballers.com (pre-change code): FAIL on all 4 cells; 4 triggers per page, "walkthrough" copy, 1 `/tutorials/` request on / at 1440.
  - AFTER, `astro preview` of this branch: PASS on all 4 cells (0 triggers, 0 dialogs, 0 tutorial requests, no promise copy, overflow 0).
- Screenshots checked at 390 and 1440 for both pages: no layout gap where the CTA was removed.

**2026-10-18 (STAGING)**: Merged as PR #615 (`1427ccfc8`) after independent proof verification (VERIFIED) and green Branch CI. Ships to reelballers.com with `/deploy-landing`.
