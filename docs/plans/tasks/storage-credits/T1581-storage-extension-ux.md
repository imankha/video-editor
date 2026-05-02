# T1581: Storage Extension UX

**Status:** TESTING
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-19
**Updated:** 2026-04-19
**Epic:** [Storage Credits](EPIC.md)
**Depends on:** T1580

## Problem

Game videos expire after 30 days. Users need a way to extend storage, and every expiration indicator in the app should double as a monetization button.

## Solution

An ExpirationBadge component on game cards that opens a Storage Extension modal when tapped. The modal shows a date slider so users can pick how long to keep the game and see the credit cost.

### ExpirationBadge

Shown on game cards when within 28 days of expiry:

| State | Visual | Color |
|---|---|---|
| > 28 days | Hidden | -- |
| 14-28 days | "N days" | Muted gray |
| 3-14 days | "N days" | Yellow/amber |
| <= 3 days | "N days" | Red |
| Expired | "Expired" | Red, dimmed card |

Every badge is a button. Tap opens the extension modal.

### Extension Modal

```
+----------------------------------+
|  [thumbnail]  Game Name          |
|  Expires in 12 days (May 1)      |
+----------------------------------+
|                                  |
|  Keep until:                     |
|  |=====[O]===============|       |
|  May 1         ->        Apr 19  |
|  (current)              (+1 yr)  |
|                                  |
|  Selected: Aug 15, 2026          |
|  Duration: +106 days             |
|  Game size: 2.5 GB               |
|  Cost: 1 credit                  |
|                                  |
|  [ Extend - 1 credit ]           |
|  Balance: 12 credits             |
+----------------------------------+
```

- **Min:** Current expiry (or today if expired)
- **Max:** +1 year
- **Cost updates live** as slider moves, size-based formula
- **Insufficient credits:** Extend disabled, "Buy Credits" link shown

### Cost Formula

```
cost_credits = max(1, ceil(size_gb * 0.015 * (days / 30) * 1.10 / 0.072))
```

## Context

### Relevant Files

**Frontend (new):**
- `StorageExtensionModal.jsx` -- extension modal with date slider
- `ExpirationBadge.jsx` -- badge component for game cards

**Frontend (integrate into):**
- Game card components -- add ExpirationBadge
- `BuyCreditsModal.jsx` -- link from insufficient credits state

**Backend:**
- `POST /api/games/{game_id}/extend` -- extend game expiry, deduct credits

### Related Tasks
- T1580 (Game Storage Credits) -- establishes expiry, this task adds the extension UX

## Implementation

### Steps

1. [ ] Create `ExpirationBadge` component with color states
2. [ ] Create `StorageExtensionModal` with date slider, live cost calculation
3. [ ] Add `POST /api/games/{game_id}/extend` endpoint
4. [ ] Integrate ExpirationBadge into game cards
5. [ ] Handle insufficient credits -- disable extend, show buy credits link
6. [ ] Mobile-responsive: bottom sheet on mobile, centered modal on desktop

## Acceptance Criteria

- [ ] ExpirationBadge appears on game cards when within 28 days of expiry
- [ ] Badge color escalates gray -> yellow -> red
- [ ] Tapping badge opens extension modal
- [ ] Slider picks date, cost updates live based on game size
- [ ] Extend button deducts credits and updates expiry
- [ ] Insufficient credits shows "Buy Credits" link
- [ ] Works on mobile (bottom sheet) and desktop (modal)
