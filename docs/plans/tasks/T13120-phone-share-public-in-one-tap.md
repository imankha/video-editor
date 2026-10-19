# T13120: Phone Share makes a highlight public in one tap; default it to private like desktop

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Tier:** S/M (frontend share flow)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T9720 staging release check, 2026-10-18 ([T9720-RESULTS.md](../ux/2026-10-18-release-check/T9720-RESULTS.md)). Screenshots are local only, in the session scratchpad `t9720/shots/` on the host that ran the check.

## Problem

On a phone (390 touch), tapping Share POSTs `/gallery/{id}/share`, copies the link, and the share is `is_public: true` (a signed-out fetch returns 200). There is no visibility choice. The desktop share modal defaults to "Only people I add". So the same gesture is private-by-default on desktop and public on a phone.

## Solution

**User decision 2026-10-18**: match desktop. A phone Share must default to "Only people I add", the same as the desktop share modal, and only become public when the user picks that. Keep T7350's pointer-capability split between the native phone sheet and the desktop modal; change only what visibility the phone path creates (and give it the visibility choice). This is unintended public exposure today, so it is a bug fix, not a product question.

## Context

### Relevant Files
- `src/frontend/src/` share routing (T7350 mobile share), share modal
- `src/backend/app/routers/` gallery share endpoint

### Related Tasks
- Found by T9720 (2026-10-18)

## Acceptance Criteria

- [ ] A phone (touch, 390) Share creates a share that a signed-out fetch cannot open, unless the user chose public
- [ ] The phone path offers the same visibility choice as desktop, defaulting to Only people I add
- [ ] A test (fails before, passes after) asserts the visibility a phone Share produces
- [ ] Desktop share behavior unchanged
- [ ] T9720's exposure box re-checked and ticked
