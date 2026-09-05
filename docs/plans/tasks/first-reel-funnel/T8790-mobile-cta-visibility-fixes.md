# T8790: Fix the 3 below-fold CTA findings from T8550's mobile visibility audit

**Status:** TODO
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

## Acceptance Criteria

- [ ] F1/F2/F3 all pass `assertCtaInViewport` at all 4 widths (+ keyboard-open variants
      where applicable) in a real, headed browser run
- [ ] All 3 `test.fixme(...)` entries in `cta-visibility.spec.js` flipped back to `test(...)`
- [ ] F1's fix verified not to regress the desktop Focus editor layout
- [ ] Evidence (screenshots or recorded matrix) attached to this file
