# T7730: Fix the 8 concrete real bugs found by the Playwright triage

**Status:** STAGING
**Priority:** P1 (real product bugs, confirmed root causes, low individual risk)
**Impact:** 7
**Complexity:** 4
**Created:** 2026-08-25
**Updated:** 2026-08-25

## Problem

The 2026-08-25 full Playwright suite run (348 passed / 144 failed / 23 skipped / 34 did not
run) was triaged in `docs/testing/playwright-triage-2026-08-25.md`. Of the 144 failures, 8
trace to concrete, confirmed real bugs in product code (not stale tests or environment
issues) with exact file:line fixes already identified. These are real user-facing defects
sitting behind failing tests, not just test maintenance.

## Solution

Fix all 8 bugs below. Each is documented with root cause + fix approach in the triage file's
"Concrete real bugs found" section (top of the file, before "Failure Clusters") — read that
section first, it has the full evidence per bug; this task file summarizes it for handoff.

1. **`ProjectManager.jsx`/`GalleryButton.jsx`** — "My Reels" button's accessible name is
   unstable (folds a live unread-count badge into the computed name, hides text below `sm`
   breakpoint). Fix: static `aria-label="My Reels"`, mark the badge `aria-hidden`. Root cause
   of 3 failures in `t5672-drawer-aspect-split.spec.js`.
2. **`questStore.js`'s `recordAchievement()`** is missing the `rbNonDataWrite: true` marker
   every sibling lifecycle-write call site has. `App.jsx`'s `returned_home` achievement fires
   reactively on Home-screen mount for any account whose quest_1 is already complete,
   tripping the "could not save to the cloud" alarm on a passive load. One-line fix. Root
   cause of 5 failures across `T5960`/`T6010-T6020`/`T6040`.
3. **`ReelTile.jsx:145`** hardcodes `menuHeight = 300` (comment falsely claims "actual is
   measured") to decide kebab-menu flip direction/position — the real menu is now taller, so
   a flipped menu overflows the viewport by ~45px. Root cause of 1 failure in `T6300`.
4. **`introCardEditorConstants.js`'s `SLOT_META.title`** label ("Athlete Name") is defined
   but never rendered — `IntroCardRail.jsx` only maps `FACT_SLOTS`, which excludes the title
   slot. Shipped-incomplete UI gap from T6620. 1 failure in `T6620-defects.qa.spec.js`.
5. **Two stray leaked clips (ids 178, 179)** confirmed via direct DB query on the real dev
   account's game 6 (`X-Profile-ID: 9fa7378c`), empty-named artifacts from an earlier test
   run's incomplete cleanup, sitting at `t=0-3s` and `t=21-33s` which several specs assume is
   clear seek space. Fix: `DELETE` the two rows, and harden `ensureAddClipVisible` (shared
   across `T5700`/`T5725` spec files) to verify the seek point is actually clip-free rather
   than trusting a hardcoded offset. Root cause of 7 failures.
6. **`page.locator('video')` is unscoped** in `T6700-owner-inapp-intro.qa.spec.js` and
   `T6710-intro-timeline-segment.qa.spec.js`, now also matching ~30 per-tile hover-preview
   `<video>` elements shipped by the T6420/T6820 tile-preview feature. Fix: rescope to
   `[data-testid="collection-player-backdrop"] video`. Root cause of 6 failures. (Test-file
   fix, but grouped here since it shares the "unscoped locator now matches new real UI" shape
   with the other confirmed-root-cause bugs.)
7. **`textdiag/main.jsx`** (dev-only test harness) still calls the pre-T6630 `useTextOverlays()`
   API (`addText`, `moveTextStart`, etc.) that no longer exists — the hook now exports
   `addRegion`/`moveRegionStart`/etc. The harness throws on mount, so no text block ever
   renders. One file fix. Root cause of 16+ failures across `T5225-text-lever-drag.qa.spec.js`
   and `T6610-text-body-drag.qa.spec.js` (cascades into `T6630-text-add-remove-drag.qa.spec.js`'s
   first test too).
8. **`CollectionPlayer.jsx`'s close (X) button** has no `aria-label`/text, so it has no
   accessible name at all. Fix: add `aria-label="Close"`. Contributes to a `T6300` failure.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx`, `src/frontend/src/components/GalleryButton.jsx` (bug 1)
- `src/frontend/src/store/questStore.js` (bug 2)
- `src/frontend/src/components/ReelTile.jsx:145` (bug 3)
- `src/frontend/src/constants/introCardEditorConstants.js`, `src/frontend/src/components/IntroCardRail.jsx` (bug 4)
- Backend DB access for the dev account (bug 5) + `src/frontend/e2e/` shared helper defining
  `ensureAddClipVisible` (grep for it — used across at least 3 spec files per the triage's own
  redundancy note, see T7760)
- `src/frontend/e2e/T6700-owner-inapp-intro.qa.spec.js`,
  `src/frontend/e2e/T6710-intro-timeline-segment.qa.spec.js` (bug 6)
- `src/frontend/src/textdiag/main.jsx` (bug 7)
- `src/frontend/src/components/CollectionPlayer.jsx` (bug 8)

### Related Tasks
- Full evidence: `docs/testing/playwright-triage-2026-08-25.md` (read the "Concrete real bugs
  found" section, plus each bug's cluster writeup in "Failure Clusters" for the exact
  file:line and reasoning)
- Sibling tasks from the same triage: [T7740](T7740-playwright-stale-test-cleanup.md) (stale
  tests), [T7750](T7750-playwright-env-scope-mismatch.md) (environment/fixture issues),
  [T7760](T7760-playwright-redundancy-survey.md) (coverage-overlap survey),
  [T7770](T7770-playwright-suite-trim.md) (suite trim, blocked on T7760)
- File-disjoint from T7740/T7750 at the product-code level; bug 5's DB delete and bug 6's
  spec-file edits are the only overlap risk with test-file work in the other buckets — verify
  against whichever of T7740/T7750 is in flight before touching e2e helper files shared with
  them

### Technical Notes
- This stems from the user's two-part ask on the full local Playwright run (348p/144f/23s/34dnr,
  4.6h wall-clock): (1) fix all real issues the failures reveal, (2) separately cut the suite
  to a 10-minute max via deduplication (see T7760/T7770, not this task).
- Bug 5's DELETE touches real dev-account data — confirm the exact row ids (178, 179) are
  still present before deleting (data may have shifted since the triage was written); this is
  a data-safety-adjacent action, narrate it in the PR/commit.
- Bugs are mostly independent 1-line/1-file fixes; low risk of conflicting with each other.

## Implementation

### Steps
1. [x] Fix bug 1 (My Reels accessible name) + verify `t5672-drawer-aspect-split.spec.js`'s 3
       affected tests
2. [x] Fix bug 2 (`questStore.js` rbNonDataWrite) + verify the 5 affected tests across
       `T5960`/`T6010-T6020`/`T6040`
3. [x] Fix bug 3 (`ReelTile.jsx` menuHeight) + verify the `T6300` failure
4. [x] Fix bug 4 (SLOT_META Athlete Name render) + verify `T6620-defects.qa.spec.js`
5. [x] Fix bug 5 (delete stray clips 178/179 + harden `ensureAddClipVisible`) + verify the 7
       affected `T5700`/`T5725` tests
6. [x] Fix bug 6 (rescope `page.locator('video')`) + verify the 6 affected
       `T6700`/`T6710` tests
7. [x] Fix bug 7 (`textdiag/main.jsx` API update) + verify the 16+ affected
       `T5225`/`T6610`/`T6630` tests
8. [x] Fix bug 8 (CollectionPlayer close button aria-label)
9. [ ] Re-run the full set of previously-failing tests these 8 bugs touch to confirm green

### Progress Log

**2026-08-26**: Worker container fixed bugs 1-4, 6-8 in code (`ensureAddClipVisible`
hardening for bug 5 also done, across all 4 spec files that duplicate it). Bug 5's actual
DELETE could not run in-container (no DB creds by design) — the supervisor ran it directly
after the code side merged: verified `raw_clips` ids 178/179 on `dev`/profile `9fa7378c` still
matched the triage's description exactly (`name=''`, `game_id=6`, `t=0-3s` and `t=21-33s`),
then applied `DELETE FROM raw_clips WHERE id IN (178,179) AND name = '' AND game_id = 6` via
`scripts/edit-user-db.py --env dev --db profile --apply` (db_version bumped automatically).
Confirmed both rows gone via a follow-up SELECT. All 8 bugs now fully resolved.

## Acceptance Criteria

- [x] All 8 bugs fixed per the description above
- [ ] The specific previously-failing tests named per bug now pass
- [ ] No new failures introduced in adjacent tests
- [ ] Tests pass; CI green
