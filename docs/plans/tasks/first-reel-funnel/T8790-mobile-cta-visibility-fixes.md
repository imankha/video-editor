# T8790: Fix the 3 below-fold CTA findings from T8550's mobile visibility audit

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-05
**Updated:** 2026-09-05

## Problem

T8550's live 4-viewport audit (320x568 / 375x667 / 390x844 / 428x926, keyboard open/closed)
against deployed staging found 3 genuine below-fold primary-CTA bugs. The audit landed
merged (PR #340) with each finding recorded as a `test.fixme(...)` in
`src/frontend/e2e/cta-visibility.spec.js` — precise repro + prescribed fix inline — so
Branch CI stays green while the debt is tracked. This task applies and live-verifies
the 3 fixes, then flips each `fixme` back to a real `test`.

T8550's own worker could NOT do this: its container had no local backend (no venv/.env/R2
creds), so it could only drive against staging's PRE-fix build — no fix could be
live-re-verified there, and this project bans jsdom for this class of UI verification
(real-browser only, T5380 rule). **This task needs a stack where the frontend can be
driven against a live backend (local dev stack, or a container with real credentials) to
iterate fix -> re-run headed -> confirm green.**

Full matrix + evidence: see `docs/plans/tasks/first-reel-funnel/T8550-mobile-cta-visibility-sweep.md`
Progress Log, 2026-09-05 entry.

## Findings to fix

### F1 — Focus "Export Focused Video" button, ~400-1061px below fold at ALL 4 widths
- Component: `src/frontend/src/components/ExportButtonView.jsx`, rendered inside the shared
  Focus editor screen (video + timeline + segment editor stack above it).
- Measured: 950>568 (320w), 957>667 (375w), 1028>844 (390w), 1061>926 (428w) — fails at
  every width, not just the smallest.
- Prescribed fix: sticky bottom action bar, reusing the T8140 pattern already shipped for
  Annotate's Save button.
- **Desktop-regression risk**: this is a SHARED editor screen (not mobile-only), so the
  sticky bar must not push/overlap desktop layout. Verify both breakpoints before landing.

### F2 — Add Game modal submit button below fold + behind keyboard
- Component: `src/frontend/src/components/GameDetailsModal.jsx`.
- Measured: 612>568 at 320x568 with NO keyboard open; 612-736 > keyboard-adjusted fold at
  ALL 4 widths once the keyboard is open (modal is `max-h-[90vh] overflow-y-auto` with the
  submit button INSIDE the scrolling body).
- Prescribed fix: restructure to scrollable-body + fixed-footer (submit button pinned
  outside the scroll region).
- **Method caveat carried over from the audit**: real iOS does not shrink the LAYOUT
  viewport when the keyboard opens, so a fixed footer alone does not fully solve the
  keyboard-open case — the footer can still sit under the keyboard unless the modal also
  resizes against `visualViewport`. Decide whether that larger change is in scope here or
  needs its own follow-up; don't silently ship a partial fix without noting which case it
  covers.

### F3 — Add Play sheet "Save" button, clipped ~15-25px under the keyboard at narrow widths only
- Component: `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`.
- Measured: 363>340 (320w), 413.8>400 (375w) — fails ONLY at the two shortest heights;
  390w/428w already pass (413 < 506/555).
- The T8140 sticky-footer pattern is already working here (Save IS pinned) — this is a
  narrower fix than F1/F2: the sheet's own content pushes the pinned footer under the
  keyboard line only at the shortest two heights.
- Prescribed fix: trim the sheet's vertical padding at the narrow breakpoints so the
  pinned footer clears the keyboard-adjusted fold.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ExportButtonView.jsx` — F1
- `src/frontend/src/components/GameDetailsModal.jsx` — F2
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — F3
- `src/frontend/e2e/cta-visibility.spec.js` — the 3 `test.fixme(...)` entries to flip back
  to `test(...)` once each fix is green
- `src/frontend/e2e/helpers/qa.js` — `assertCtaInViewport` / `CTA_VIEWPORTS`, reuse as-is

### Related Tasks
- Depends on: T8550 (DONE — audit merged, PR #340)
- Filed from: T8550's Progress Log, 2026-09-05

### Technical Notes
- Verification MUST be real-browser, headed, at all 4 widths (jsdom is banned for this
  class of layout bug per the project's T5380 rule) — this is why T8550 itself could not
  close the loop.
- F1 carries the most risk (shared desktop+mobile screen); F3 is the smallest, most
  contained fix. Consider landing F3 first as a low-risk warm-up if splitting the work.

## Implementation

### Steps
1. [ ] Set up a stack with a live backend the frontend can be driven against (local dev
   stack with real/seeded credentials, or staging as a read path with careful gesture
   scoping) — confirm this BEFORE starting the fixes, since T8550 was blocked on exactly
   this.
2. [ ] Fix F3 (Add Play sheet padding) — smallest, most contained. Re-run headed at
   320/375, confirm the pinned footer clears the keyboard line. Flip its `fixme` to `test`.
3. [ ] Fix F2 (Add Game modal scrollable-body/fixed-footer) — decide scope on the
   `visualViewport` keyboard caveat before implementing. Re-run headed at all 4 widths,
   keyboard open and closed. Flip its `fixme` to `test`.
4. [ ] Fix F1 (Focus sticky export bar) — verify BOTH mobile (all 4 widths) and desktop
   layouts are unaffected. Re-run headed. Flip its `fixme` to `test`.
5. [ ] Re-run the full `cta-visibility.spec.js` suite (all 9 surfaces) — confirm zero
   `fixme` remain and the matrix is fully green.

### Progress Log

**2026-09-05**: Task filed after T8550's audit-only PR (#340) merged. Not yet started.

**2026-09-09**: All 3 fixes implemented and LIVE-VERIFIED headed (real browser, real backend,
seeded account imankh@gmail.com/9fa7378c) at 320x568 / 375x667 / 390x844 / 428x926. Evidence
in `qa/` (cta-add-game_*, cta-add-play_*, cta-focus-export_*, T8790-F1-desktop-1280.png).

- **F3 (Add Play sheet)** - `AnnotateFullscreenOverlay.jsx` inline-sheet footer gets
  `[@media(max-height:700px)]:pb-9`. ROOT CAUSE (found via live DOM probe, not the audit's
  guess): the sheet is `fixed bottom-0` but a `backdrop-blur` ancestor becomes its containing
  block, anchoring it to that card's bottom (~y=376, mid-screen), so the pinned Save lands at
  y+h=363 - below the keyboard-reduced fold ONLY on the two SHORT phones (568/667). A width
  breakpoint can't target them (all 4 widths are < `sm`), so the fix keys on `max-height:700px`
  (the failing phones are short, not narrow). Was 363>340 / 413.8>400; now 4/4 PASS.

- **F2 (Add Game modal)** - `GameDetailsModal.jsx` restructured to a flex column: fixed header /
  scrollable body / submit pinned in a footer OUTSIDE the scroll region. No-keyboard submit was
  612>568 at 320; now pinned and 4/4 PASS. Also fixed a STALE spec anchor (T8810 renamed the
  dropzone heading to "Drop any game video here."; the spec still matched the old copy, so the
  test couldn't find the form). SCOPE DECISION (the visualViewport caveat, decided explicitly per
  the task): the keyboard-open half is SCOPED OUT. A fixed footer alone can't satisfy it - real
  iOS doesn't shrink the layout viewport, and the test's proxy never shrinks visualViewport, so
  only confining the modal to the top ~57% of the layout viewport at all times would turn it
  green, which regresses the no-keyboard UX. Recorded as a tracked `test.fixme` ("...needs
  visualViewport resize"), NOT silently dropped. Owed as a follow-up.

- **F1 (Focus Export)** - `FocusModeView.jsx` `ExportButtonSection` wrapper becomes
  `sticky bottom-0 z-30` with a bg on mobile, `lg:static` on desktop. Used `sticky` (references
  the `flex-1 overflow-auto` scroll container), NOT `fixed`, because the Focus editor's
  `backdrop-blur` card would trap a fixed bar mid-screen exactly like F3. Was 900>568 at 320; now
  4/4 PASS. DESKTOP non-regression verified @1280: the wrapper computes `position:static`,
  `backdrop:none`, `background:transparent`, `padding:0` (the `lg:` resets fully neutralize the
  sticky styling) - desktop layout byte-unchanged; screenshot confirms the normal two-column
  editor.

- **NEW FINDING F4 (out of this task's 3-finding scope, flagged for follow-up)** - the full-suite
  re-run surfaced Surface 7 ("Build New Reel", In Progress Reels tab) below the fold at 629>568
  at **320x568 ONLY** (passes at 375/390/428). It reproduces only on an account with NO
  in-progress reels: the tall `EmptyTabGuide` (T8980) beneath the whole home shell (header +
  expiry banner + "Continue where you left off" cards + tab bar) pushes the CTA down. This is the
  SAME "primary CTA below the home shell scroll" structural case that Surface 8 is a documented
  skip for - NOT one of F1-F3, NOT caused by this diff (files untouched). Recorded as a tracked
  `test.fixme` in the spec (repo convention) pending its own follow-up task.

- Tests: curated unit set 74 passed (GameDetailsModal.videoFirst/t8700/beacon, ExportButtonView,
  FocusModeView.mobileReachable/aspectRatio/mobileAspect, AnnotateFullscreenOverlay.oneTap/
  details/stripLayout). Full `cta-visibility.spec.js`: 0 assertion failures (3 transient timeouts
  at 375x667 under an 8.8-min run all re-ran green in isolation).

## Acceptance Criteria

- [x] F1/F2/F3 all pass `assertCtaInViewport` at all 4 widths in a real, headed browser run.
      (F2 keyboard-open variant SCOPED OUT - needs visualViewport modal-resize; tracked as a
      documented `test.fixme`, see Progress Log 2026-09-09.)
- [x] All 3 `test.fixme(...)` entries flipped to `test(...)` (F2's keyboard-open half re-added
      as a NEW, separately-named tracked fixme for the deferred visualViewport work).
- [x] F1's fix verified not to regress the desktop Focus editor layout (computed styles @1280 +
      screenshot).
- [x] Evidence (screenshots) attached: `qa/cta-add-game_*`, `qa/cta-add-play_*`,
      `qa/cta-focus-export_*`, `qa/T8790-F1-desktop-1280.png`.
