# T5740: Share sheet UX + growth instrumentation

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-21
**Updated:** 2026-07-21

Task 5 of 5 in the [Share the Game epic](EPIC.md).

## Problem

T5720 makes the link exist; this task makes the SEND moment effortless and the loop
measurable. Without a native share sheet + prefilled message, "drop it in the team WhatsApp"
is copy-paste friction; without funnel numbers, we can't tune the watch page CTA or know
whether the loop converts.

## Solution

1. **Share sheet** — from the game card menu and the Team Recap viewer: one tap →
   `navigator.share` on mobile (title + prefilled message + link), copy-link fallback on
   desktop with a "Link copied" toast. Prefilled message pattern:
   `"⚽ Highlights from {game name} — watch the team's best plays: {link}"` (exact copy via
   UI Designer; mirror the Dual-Camera T5510 share-sheet pattern so the two flows feel
   identical — whichever lands first establishes the component, the other reuses it).
2. **Entry-point placement** — game card menu ("Share with team") + Team Recap viewer header.
   The existing email-teammate-share entry stays as-is (different job — see epic architecture
   decision 6); UI Designer resolves how the two share affordances read side-by-side without
   confusion.
3. **Funnel instrumentation** — per-token counters across the loop:
   `share_created` / `share_viewed` (T5720's beacon) / `share_claimed` (T5730's
   `share_claims`) / claimed-account activation (existing milestone machinery). Surface:
   admin dashboard section (links per game, views, claims, activated) — enough to answer
   "does the loop convert" per link; no new analytics infra.
4. **Revoke polish** — revoke control confirmation + revoked-state display on the game card
   (link inactive), per T5720's backend.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — game card menu entry
- `src/frontend/src/components/RecapPlayerModal.jsx` — Team Recap share entry
- New shared share-sheet helper/component (navigator.share + copy fallback; coordinate with
  Dual-Camera T5510)
- `src/backend/app/routers/admin.py` + admin frontend — funnel surface
- Milestone recording: `record_milestone` call sites (T4840 beacon pattern)

### Related Tasks
- Depends on: T5720 (link), T5730 (claims)
- Related: Dual-Camera T5510 (share-sheet component reuse), T442 (Web Share API prior art if
  landed)

### Technical Notes
- Knowledge doc: [backend-services.md](../../../.claude/knowledge/backend-services.md)
- Analytics reads must not sit on response paths (T4840 lesson — background/beacon only).
- M-tier: UI + read-only admin surface; no schema beyond T5730's `share_claims`.

## Implementation

### Steps
1. [ ] UI Designer: share sheet copy + dual-affordance placement (approval gate)
2. [ ] Share-sheet component + entry points + toasts
3. [ ] Funnel milestones wiring + admin surface
4. [ ] Revoke confirmation/state polish
5. [ ] Tests + real-device navigator.share verify (Android + iOS)

### Progress Log

**2026-07-21**: Created from the epic consolidation.

## Acceptance Criteria

- [ ] One tap from game card or Team Recap opens the native share sheet (mobile) or copies
      the link (desktop) with the prefilled message
- [ ] Admin can see per-link: views, claims, activated accounts
- [ ] Revoke has a confirmation and a visible revoked state
- [ ] No analytics work on response paths
