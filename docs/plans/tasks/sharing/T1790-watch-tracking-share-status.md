# T1790: Watch Tracking & Share Status

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

Sharers have no visibility into whether recipients watched their shared videos. Recipients playing videos don't trigger any tracking. The gallery has no UI showing share status.

## Solution

Fire a "watched" event from the shared video player on first play. Show a share status panel on gallery cards listing all recipients with their watched/not-watched status.

## Context

### Relevant Files (REQUIRED)

**Frontend:**
- `src/frontend/src/components/SharedVideoPage.jsx` - Fire watched event on video play
- `src/frontend/src/components/Gallery/` - Add share status indicator/panel to video cards
- New: `src/frontend/src/components/Gallery/ShareStatusPanel.jsx` - List of shares + status

**Backend:**
- `src/backend/app/routers/gallery.py` - GET `/gallery/{video_id}/shares` already exists from T1750

### Related Tasks
- Depends on: T1750 (backend model + watched endpoint), T1770 (gallery UI), T1780 (shared video page)

### Technical Notes

- **Watch event:** SharedVideoPage calls POST `/shared/{shareToken}/watched` when video `onPlay` fires. Backend sets `watched_at` only if NULL (idempotent, first-play only).
- **Share status panel:** Expandable section or popover on gallery cards showing list of recipients. Each row: email, sent date, watched/not-watched badge.
- **Polling:** No real-time updates needed. Status fetched when gallery loads or when user opens the panel.

## Implementation

### Steps
1. [ ] SharedVideoPage: fire POST `/shared/{shareToken}/watched` on video `onPlay`
2. [ ] Gallery: fetch shares for each video (or lazy-load on panel open)
3. [ ] ShareStatusPanel component: list recipients with email, date, watched badge
4. [ ] Show share count indicator on gallery cards (e.g., "Shared with 3")
5. [ ] Visual distinction for watched vs not-watched (e.g., green check vs grey clock)

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Playing shared video fires watched event to backend
- [ ] watched_at recorded on first play only (subsequent plays don't update)
- [ ] Gallery cards show share count if video has been shared
- [ ] Share status panel lists all recipients with watched/not-watched status
- [ ] Status updates on gallery reload (no stale state)
