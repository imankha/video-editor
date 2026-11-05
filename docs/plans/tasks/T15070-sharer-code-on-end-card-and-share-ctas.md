# T15070: Sharer's code on the end card and share-page calls to action (K becomes measurable)

**Status:** STAGING
**Impact:** 8
**Complexity:** 2
**Tier:** M (frontend share surfaces + one field on the public share payload + two small backend attribution changes)
**Created:** 2026-11-04
**Updated:** 2026-11-04

Owner-approved 2026-11-04 from the acquisition-test prep list in
[topdown-vs-bottomup-2026-11-04.md](../bi/topdown-vs-bottomup-2026-11-04.md) section 10. The
referral K factor (0.008 measured, 3 referred sign-ups of 379; 22 shares, 153 share views, 0
claims) is the input whose assumed value most distorts the optimistic revenue column (0.25
assumed). It cannot be measured today because the one surface every shared highlight carries,
the "Made with ReelBallers" end card, links back with a STATIC campaign tag and no sharer. This
task makes every end-card and share-page sign-up attributable to the parent who shared, so
referred sign-ups over total sign-ups reads from existing tables in about a month (90 post-launch
sign-ups separate K 0.01 from 0.05; 285 per arm against the 379 pre-launch control tightens it).

## Problem

Audit 2026-11-04 (read-only):

- The public reel page `src/frontend/functions/shared/[token].js` renders an end card when the
  video ends (lines 293 to 303) whose call to action is the fixed URL
  `https://www.reelballers.com/?utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard`.
  The footer "Open ReelBallers" points at `appHome`. Neither carries who shared.
- The in-app shared views use the same fixed URL: `BrandedEndCard` and `BrandedCtaLink`
  (`src/frontend/src/components/BrandedEndCard.jsx:4-52`), mounted in `SharedVideoOverlay.jsx:132`,
  `SharedCollectionView.jsx:161`, `SharedGameView.jsx` and `SharedAnnotationView.jsx`.
- A sign-up through that link therefore gets `origin = reel_endcard` (via `utm_campaign`, see
  `_determine_origin`, `app/analytics.py:703-771`) and `referrer_id = NULL`, unless the viewer's
  email happens to match a `shares.recipient_email` row. The admin "Viral Conv." number
  (`/analytics/pulse`, `referrer_id` based) and the `referrals` table never see these sign-ups.
- The sharer already has a code: `GET /api/me/invite-code` (`app/routers/users.py:23-41`) makes
  `sha256(user_id)[:8]`, persists it to `users.invite_code`, and the app resolves `?ref=<code>` at
  sign-up (`_find_or_create_user`, `auth.py:380-386`, channel `invite_link`). The code exists only
  once the sharer has opened "Invite a friend"; most sharers have not.
- Second defect, same area: a referral recorded when a share is claimed AFTER sign-up
  (`materialization.py:1080-1095`, channels `teammate_share` or the share type's channel) inserts
  a `referrals` row but never updates `user_segments.referrer_id`, so the two disagree and the
  pulse undercounts.

## Solution

1. **Public share payload carries the sharer's code.** The backend that serves the public share
   (`app/routers/shares.py`, the read used by `functions/shared/[token].js` and the in-app shared
   views) adds `sharer_invite_code`, computed the same way as `get_invite_code` (deterministic
   `sha256(sharer_user_id)[:8]`) and persisted through `persist_invite_code` if `users.invite_code`
   is still NULL, so the code is valid at sign-up whether or not the sharer ever opened Invite.
   Factor the code derivation into one helper both call sites use (no second formula).
2. **End card and share-page links carry it.** Every CTA built from the fixed URL becomes
   `https://www.reelballers.com/?ref=<sharer_invite_code>&sport=<sharer_default_sport if known>&utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard`.
   `BrandedEndCard` and `BrandedCtaLink` take a `refCode` (and optional `sport`) prop; the Pages
   Function templates the same. The landing relay (T3455, T15000) already forwards `ref`, `sport`
   and `utm_*` to the app, and `captureCampaignParams` already stores them first-touch.
3. **Backend names the channel.** At sign-up, when `ref` resolves to an invite code AND
   `utm_source == "share_endcard"`, record the referral with channel `endcard` (new key in
   `SHARE_TYPE_TO_CHANNEL`'s neighbourhood, `sharing_db.py:628-638`) instead of `invite_link`, so
   the loop is told apart from a deliberate invite. `_determine_origin` keeps its order (invite
   code outranks `utm_campaign`), so these sign-ups take the sharer's origin as invites do today;
   the channel column on `referrals` is where the end-card read lives.
4. **Claim-after-sign-up updates the segment.** Where `materialization.py` records a referral for a
   claimant who already had an account, also `UPDATE user_segments SET referrer_id = %s WHERE
   user_id = %s AND referrer_id IS NULL`. First attribution wins; never overwrite.
5. **No reward.** This task measures K at zero reward (the owner's pricing stance; a reward is
   T15090, not filed). Copy stays as is: "Make your own highlights at www.reelballers.com" is
   inside the glossary (highlight, not clip).

Out of scope: the burned-in outro (`branded_outro.py`) prints `reelballers.com` as video text and
cannot carry a per-sharer code; a per-sharer short URL is a separate decision. Share-view counting
(`/api/shared/{token}/viewed`) is unchanged.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/shares.py` - public share payload gains `sharer_invite_code` (+ `sharer_default_sport` is already there, v018)
- `src/backend/app/routers/users.py` - `get_invite_code` uses the shared helper
- `src/backend/app/services/sharing_db.py` - invite-code helper, `endcard` channel key, `record_referral` unchanged
- `src/backend/app/routers/auth.py` (`_find_or_create_user`, ~380-386) - channel `endcard` when `ref` is an invite code and `utm_source == share_endcard`
- `src/backend/app/services/materialization.py` (~1080-1095) - set `user_segments.referrer_id` if NULL when recording a claim-after-sign-up referral
- `src/frontend/functions/shared/[token].js` - end-card and footer links templated with the code; `share-page.test.js`, `unfurl-cta.test.js` updated
- `src/frontend/src/components/BrandedEndCard.jsx` (+ `.test.jsx`) - `refCode`/`sport` props
- `src/frontend/src/components/SharedVideoOverlay.jsx`, `SharedCollectionView.jsx`, `SharedGameView.jsx`, `SharedAnnotationView.jsx` - pass the code from the share payload
- `src/backend/tests/` - sign-up with `ref=<code>&utm_source=share_endcard` records channel `endcard` and sets `referrer_id`; claim-after-sign-up fills a NULL `referrer_id`

### Related Tasks
- Builds on: T3455 (param relay), T2915 (`ref_sport` inheritance), T13980 (campaign id in any field), T5720/T5730 (game-link claims).
- Feeds: T14910 gate 9 (K factor), the `/analytics/pulse` "Viral Conv." number, T15120 (referral channel as a read-out dimension), the revenue-outlook K row.
- Not touched: T11510 (share video vs share link split) and T11530 (cover image) share files but not scope.

### Technical Notes
- Deterministic code: `sha256(user_id)[:8]` is what `get_invite_code` produces today; reusing it means the sharer's existing invite link and the end card resolve to the same referrer.
- First touch: the app's `captureCampaignParams` stores the first `ref` per tab; a viewer who opens two different parents' highlights in one tab is attributed to the first. Accept; document in the module header.
- Privacy: the code identifies the sharer to our backend only; the URL exposes an 8-hex token, not a name or email, same as today's invite link.
- Attribution order in `_determine_origin` is unchanged (invite code first); only the `referrals.channel` value distinguishes `endcard` from `invite_link`.

## Implementation

### Steps
1. [ ] Failing tests: public share payload includes `sharer_invite_code` (persisted when missing); `[token].js` renders the end-card href with `ref=` and the existing `utm_*`; `BrandedEndCard` renders `refCode`; sign-up with `ref=<code>&utm_source=share_endcard` writes `referrals.channel = 'endcard'` and `user_segments.referrer_id`; claim-after-sign-up fills NULL `referrer_id` and leaves a non-NULL one alone.
2. [ ] Backend helper + payload field + channel + segment update.
3. [ ] Pages Function and the four in-app shared views.
4. [ ] Verify on staging with two accounts: share a highlight from A, open the public page signed out, click the end card, sign up as B, confirm `referrals` (channel `endcard`) and `referrer_id = A` in admin.
5. [ ] Record the launch date in the revenue-outlook K row so the 90 and 285 sign-up reads can be dated.

### Progress Log

**2026-11-04**: Filed from the owner's approval of the acquisition-test prep list. Audit facts above are from the read-only code audit of the same day.

## Acceptance Criteria

- [ ] Every end-card and share-page call to action carries the sharer's invite code; a sharer who never opened Invite still gets a valid code.
- [ ] A sign-up through an end card is recorded as a referral with channel `endcard` and the sharer as `referrer_id`.
- [ ] A share claimed after sign-up sets `referrer_id` when it was NULL and never overwrites an existing one.
- [ ] `/analytics/pulse` "Viral Conv." and `/referrals/by-channel` count end-card sign-ups.
- [ ] No reward, no copy change outside the glossary, no new tables; relevant backend and frontend tests pass.
