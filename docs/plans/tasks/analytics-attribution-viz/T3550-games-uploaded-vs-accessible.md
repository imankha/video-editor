# T3550: Games Uploaded vs Accessible

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

The admin panel shows a single "Games" number per user. Because games can be shared, that number is ambiguous: it conflates **games the user uploaded** with **games shared to them**. The owner of a game and someone who merely has access to it look identical. We can't tell, for any user, how much content they actually created vs how much they're just consuming via sharing — which matters for understanding real producers vs viewers.

## Solution

Split the metric into two distinct numbers wherever games are shown per user:

- **Uploaded** — games this user created (their own uploads).
- **Accessible** — total games the user can see = uploaded + games shared TO them (deduped).

Surface both in the admin user list (`UserTable`) and the user detail panel. Optionally show "shared to them" as the derived third number (`accessible - uploaded`).

## Context

See [EPIC.md](EPIC.md) for shared data-source and admin-surface details.

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — user list endpoint (line 90) and per-user counts (game count from `user_actions` where `action='game_created'`, ~lines 140-203). Add the accessible count here.
- `src/backend/app/services/pg.py` — schema reference: `share_games` (line 124: `recipient_profile_id`, `recipient_email`, `game_id`), `shares` (line 98: `sharer_user_id`, `revoked_at`).
- `src/frontend/src/stores/adminStore.js` — `fetchUsers()` / `fetchUserDetail()`; thread the new field through.
- `src/frontend/src/components/admin/UserTable.jsx` — render uploaded vs accessible columns.
- `src/frontend/src/components/admin/UserDetailPanel.jsx` — show the breakdown in detail.

### Related Tasks
- Part of the [Analytics: Attribution & Access Visibility](EPIC.md) epic (sibling: T3560).
- Builds on T2825 (`shares`/`share_games`) and T2830 (game materialization into recipient profile).

### Technical Notes
- **Uploaded count:** keep the existing `game_created` action count (or count owned games in the user's profile if more authoritative — confirm during implementation which source is canonical; prefer the existing `user_actions` source unless it proves inaccurate, per the "correct data, not workarounds" rule).
- **Accessible count:** games shared TO the user = distinct `share_games.game_id` joined to `shares` where the recipient is this user (`share_games.recipient_profile_id` belongs to the user, or `shares.recipient_email` = user's email) AND `shares.revoked_at IS NULL`. Then `accessible = uploaded + (distinct shared-to-them games not already owned)`.
- **Dedup:** a user could be shared a game they also uploaded (edge case) — count it once. Match on `game_id`/blake3 where feasible.
- Watch N+1: the user list is paginated; compute accessible counts in a single grouped query joined to the page of user_ids, not per-row.

## Implementation

### Steps
1. [ ] Backend: add `games_accessible` (and keep `games_uploaded`) to the user-list query in `admin.py`, via a grouped `share_games`/`shares` join keyed on recipient.
2. [ ] Backend: add the same breakdown to the user-detail/journey payload.
3. [ ] Frontend: thread the new fields through `adminStore.js`.
4. [ ] Frontend: render Uploaded / Accessible (and derived Shared-to-them) in `UserTable.jsx` + `UserDetailPanel.jsx`.
5. [ ] Tests: backend test asserting uploaded vs accessible differ for a user with a game shared to them.

### Progress Log

_(none yet)_

## Acceptance Criteria

- [ ] Admin user list shows games **uploaded** and games **accessible** as separate numbers
- [ ] For a user with a game shared to them, accessible > uploaded
- [ ] Revoked shares do not count toward accessible
- [ ] No N+1 query on the paginated user list
- [ ] Tests pass
