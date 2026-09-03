# T8330: Proactive storage-expiry notification (product decision + implementation)

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-01
**Updated:** 2026-09-01

## Problem

Bug 50p showed that storage expiry is communicated only passively: the 30-day window is
stated at upload (GameDetailsModal) and in the ToS, and the Games tab shows per-tile chips
inside 14 days. There is NO proactive notice of any kind - [email.py](../../src/backend/app/services/email.py)
sends only auth codes (plus the admin bulk-email tool). A user who lives in Reel Drafts
(arshia) can pass through the entire warning window, the expiry, and the 14-day deletion
grace without one affirmative signal, then lose the ability to edit drafts permanently.

His case concretely: 2 games deleted (12 draft reels dead), 8 more were one day from
first deletion when he happened to file a bug report. That report was luck, not design.

## Solution (proposal - needs product decisions before implementation)

Two candidate channels, either or both:

1. **In-app aggregate banner** (cheap, no send-approval friction): on app load, if any
   owned game expires within N days (or is in grace with un-exported draft clips), show a
   dismissible banner: "3 games expire this week - X draft reels depend on them. Extend
   storage". Deep-links to the Games tab. Computable from the existing games list response
   (storage_expires_at + can_extend already served); grace-window games are extendable
   until the object deletes, which the banner should exploit.
2. **Email digest** (reaches lapsed users - the ones most likely to lose data, since
   expiry correlates with not opening the app): "Your game vs Albion SC expires in 7
   days; 3 reels still in drafts." Needs a scheduled sender; note the fire-and-forget
   deferral (T1537) and that all email sends are approval-gated per project policy.

### Open product decisions (user call)
- [ ] Channel(s): banner only, email only, or both? (banner-first is the cheap MVP)
- [ ] Warning threshold (7 days? 14, matching the chip?) and whether grace-window
      ("already expired, deletes in N days, still rescuable") gets its own louder notice
- [ ] Only warn when un-exported draft clips depend on the game, or for every game?
      (drafts-at-risk is the actual loss; bare games expiring is the business model)
- [ ] Email frequency cap / dedup so a hoarder with 10 expiring games gets one digest,
      not ten emails

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` or app shell - banner mount point
- `src/backend/app/routers/games.py` - games list already carries expiry + can_extend
- `src/backend/app/services/email.py` - sender (if email channel chosen)
- `src/backend/app/services/storage_credits.py` - EXPIRY_VISIBLE_DAYS constant (28)

### Related Tasks
- Siblings: T8310, T8320 (bug 50p truth-telling fixes; this one is prevention)
- Constraint: analytics/notification state must not add new Postgres tables without
  scrutiny (aggregates-only policy); banner needs zero new state, email digest needs at
  most a last-notified marker (user_db candidate)

## Implementation

1. [ ] User decides the open questions above
2. [ ] Then classify (likely M for banner-only; L if email digest included) and implement

## Acceptance Criteria

- [ ] A user with games expiring inside the threshold gets an affirmative signal on a
      surface they actually visit, before expiry and again during grace
- [ ] No reactive persistence, no per-event analytics rows, sends approval-gated
