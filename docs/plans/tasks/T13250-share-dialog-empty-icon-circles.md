# T13250: Share dialog buttons show empty circles where icons should be

**Status:** STAGING
**Impact:** 4
**Complexity:** 1
**Tier:** S (frontend; verify first)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found while re-checking T13120 on staging, 2026-10-18 (T9720-RESULTS.md section 8; screenshot t13120-mobile-after-share, local).

## Problem

In the highlight share dialog ("Share <name>", Who can watch), the Share and Cancel buttons are tall tiles that each show a large empty circle above the label, as if an icon failed to render or a loading placeholder never resolved. Seen at 390 touch on staging after the T13120 merge; check 1440 too. It makes the primary action look broken or busy.

## Solution

Find the component that renders these action tiles and what the circle is meant to hold (icon, spinner, avatar). Render the intended icon, or drop the circle so the buttons are plain labeled buttons matching the rest of the dialog.

## Context

### Relevant Files
- `src/frontend/src/` highlight share modal and its action buttons (the T7350/T13120 share flow)

### Related Tasks
- Found during the T9720 re-check of T13120

## Acceptance Criteria

- [ ] Share and Cancel in the share dialog show their intended icon or no circle, at 390 and 1440
- [ ] Screenshot before and after
