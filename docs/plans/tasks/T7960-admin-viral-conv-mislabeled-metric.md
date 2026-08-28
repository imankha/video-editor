# T7960: Admin "Viral Conv." card computes views-per-share, not referral conversion

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-28
**Updated:** 2026-08-28

## Problem

Found during a user-requested audit of the admin dashboard (screenshot review, 2026-08-28) — the
user spotted "VIRAL CONV. 2000%" and correctly flagged it as impossible: no one has referred/invited
anyone in at least a month, yet the card reads 2000%.

Root cause: `admin.py:1690` computes `viral_pct = total_views / total_shares * 100` — this is
**views per share** (an unbounded ratio: one share link viewed 20 times = 2000%), not a referral
conversion rate. It has nothing to do with invites/referrals. `share_viewed` is recorded on every
render including edge-cache hits (`shares.py:687,742,862,892,1111`), attributed to the sharer, so
the numerator inflates independent of any new user showing up.

The dashboard already computes the correct signal elsewhere and just doesn't surface it as this
card: the `channels` endpoint's `viral` column (`admin.py:1064`, `COUNT DISTINCT ... WHERE
s.referrer_id IS NOT NULL`) is genuine referred-user attribution and is consistent with "no one has
referred anyone" (near-zero).

## Solution

Redefine the "Viral Conv." stat-tile metric to an actual conversion rate: referred signups /
total signups (or /shares, per the admin's preference — pick ONE bounded definition, never an
unbounded ratio), reusing the `referrer_id IS NOT NULL` signal already used in the channels
endpoint's `viral` column. Keep the existing views/share number if it's useful, but relabel it
honestly (e.g. "Avg Views per Share") and do NOT badge it as a percentage — do not multiply an
unbounded ratio by 100 and call it a conversion rate.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — `viral_pct` computation (~line 1615, 1672-1690, 1706) and
  the existing correct `viral` column in the channels query (~line 1059-1075)
- `src/frontend/src/**/PulseCards.jsx` — renders the card label/value (confirm exact path via
  Explore; referenced by the audit as `PulseCards.jsx:30,46`)

### Related Tasks
- Sibling bugs from the same audit: T7970 (upload success), T7980 (channels cartesian join),
  T7990 (stat-tile day-boundary mislabel)

### Technical Notes
- Do not conflate this with `T7910` (signup referrer attribution capture gap) — that task is about
  whether `origin`/referrer gets captured correctly at signup; this task is purely about what the
  admin dashboard displays once that data exists.
- Decide the exact metric definition before implementing — flag as an open product question if the
  founder wants a different definition than "referred signups / total signups".

## Implementation

### Steps
1. [ ] Decide final metric definition (referred signups / total signups, bounded, capped at 100%)
2. [ ] Update the dashboard summary-card query/computation in admin.py to use it
3. [ ] Relabel or drop the raw views/share ratio so it's never displayed as a percentage
4. [ ] Update/add a backend test asserting the metric never exceeds 100% and matches referrer_id counts

### Progress Log

**2026-08-28**: Filed from admin dashboard audit (code-expert agent finding).

## Acceptance Criteria

- [ ] "Viral Conv." (or its renamed equivalent) never exceeds 100% and tracks actual referred-user
      conversion, verifiable against `user_segments.referrer_id`
- [ ] No remaining UI surface presents an unbounded ratio as a "%" metric
- [ ] Backend test covers the new computation
