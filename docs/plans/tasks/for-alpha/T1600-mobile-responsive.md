# T1600: Mobile Responsive — Make It All Work on Mobile

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-04-20
**Updated:** 2026-04-20

## Problem

The app is desktop-first and breaks on mobile screens (360-428px). Navigation
truncates, two-column layouts are unusable, content overflows, and video
previews are too small. The new user flow (quest onboarding) is positioned at
the top of the page — on mobile it should be moved down the page so users have
to scroll to reach it, keeping the primary content (games, clips) front and
center.

## Solution

1. **Make all screens functional on mobile** — responsive layouts for Home,
   Annotate, Framing, Overlay, and Gallery. No horizontal overflow, no
   truncated controls.
2. **Move new user flow below the fold on mobile** — the quest/onboarding panel
   should be located further down the page on mobile so users scroll to it,
   rather than it dominating the initial viewport.

## Relevant Files

- `src/frontend/src/App.jsx` — top-level layout, NUF routing
- `src/frontend/src/components/QuestPanel.jsx` — quest/onboarding UI
- `src/frontend/src/components/QuestIcon.jsx` — quest entry point
- All screen components (Home, Annotate, Framing, Overlay, Gallery)
- Tailwind responsive utilities throughout

## Related Tasks

- Supersedes: mobile-responsive epic (T280-T330) — old granular breakdown
- Related: T1230 (Mobile Annotate Clips)

## Acceptance Criteria

- [ ] All screens functional on 360-428px width (Android Chrome, iOS Safari)
- [ ] No horizontal overflow or truncated controls on any screen
- [ ] New user flow / quest onboarding is below the fold on mobile (requires scroll)
- [ ] Video preview is usable on mobile (can see content, interact with controls)
- [ ] Desktop layout unchanged
