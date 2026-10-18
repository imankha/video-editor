# T13120: Phone Share makes a highlight public in one tap with no visibility choice (verify intent)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** S/M (frontend share flow; product decision first)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T9720 staging release check, 2026-10-18 ([T9720-RESULTS.md](../ux/2026-10-18-release-check/T9720-RESULTS.md)). Screenshots are local only, in the session scratchpad `t9720/shots/` on the host that ran the check.

## Problem

On a phone (390 touch), tapping Share POSTs `/gallery/{id}/share`, copies the link, and the share is `is_public: true` (a signed-out fetch returns 200). There is no visibility choice. The desktop share modal defaults to "Only people I add". So the same gesture is private-by-default on desktop and public on a phone.

## Solution

Decide with the user whether a phone Share should be public by default. If not, give the phone flow the same visibility choice or default as desktop (T7350 owns phone vs desktop share routing; keep its pointer-capability split). If yes, record the decision and make the phone copy say the link is public.

## Context

### Relevant Files
- `src/frontend/src/` share routing (T7350 mobile share), share modal
- `src/backend/app/routers/` gallery share endpoint

### Related Tasks
- Found by T9720 (2026-10-18)

## Acceptance Criteria

- [ ] The phone and desktop share defaults match the user's decision
- [ ] A test asserts the visibility a phone Share produces
- [ ] Copy states the visibility when the link is created
