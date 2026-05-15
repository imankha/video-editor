# Invite & Referral

**Status:** TODO
**Created:** 2026-05-15

## Goal

Let users invite friends to Reel Ballers via email. Track referral attribution (who brought whom) across invite links and all share types (game shares, annotation shares, reel shares). Build a referral graph in Postgres for growth analytics.

## Flow

1. **Invite**: User clicks "Invite a Friend" button on home screen. Opens their email client (mailto:) with a pre-written personal pitch and a link to `reelballers.com?ref={invite_code}`.
2. **Landing page**: Recipient lands on reelballers.com with the invite code in the URL. The landing page does the visual selling (before/after, features, CTA). CTA button passes the invite code through to app signup.
3. **Attribution**: On signup, the app checks for a referral code (from invite link or pending share). Records the referrer-referred relationship in Postgres.
4. **Share attribution**: When a non-user signs up after receiving a game share, annotation share, or reel share, that share is also recorded as a referral source.

## Design Decisions

### mailto: over server-sent email
The invite email comes from the user's own email client, not from noreply@reelballers.com. This feels personal ("from a friend") and has better deliverability. The email body is short -- the landing page does the heavy lifting.

### Landing page as the sell
The invite link points to `reelballers.com` (not directly to the app). The landing page has before/after demos, feature cards, and a CTA above the fold. This converts better than a plain signup link.

### Adjacency list for referral graph
Simple `referrals` table in Postgres (referrer_id, referred_id, channel). Recursive CTEs handle tree queries. At shallow depth (1-3 levels) and <10K users, this is simpler and faster than ltree or closure tables.

### Attribution channels
Four channels tracked: `invite_link`, `game_share`, `annotation_share`, `reel_share`. A user can only be referred once (UNIQUE on referred_id) -- first attribution wins.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T2900 | [Invite Button + Email](T2900-invite-button-email.md) | TODO |
| T2910 | [Referral Graph](T2910-referral-graph.md) | TODO |

## Dependencies

- **Landing page** (`src/landing/`) -- must support `?ref=` query param passthrough to app CTA
- **Auth flow** (`src/backend/app/routers/auth.py`) -- must capture referral code on signup
- **Existing share infrastructure** (T1750, T1760, T2825) -- share acceptance triggers referral attribution

## Completion Criteria

- [ ] Invite button visible on home screen
- [ ] mailto: opens with compelling message + invite link
- [ ] Invite code passes through landing page to app signup
- [ ] Referral graph tracks all attribution channels
- [ ] Admin can query referral stats
