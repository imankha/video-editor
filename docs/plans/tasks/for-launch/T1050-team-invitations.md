# T1050: Team Invitations (Viral Feature)

**Status:** TODO
**Impact:** 9
**Complexity:** 7
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

The app has no viral growth mechanism. Users discover the app individually with no incentive to bring teammates. For a sports video app, the natural social unit is a team — if one player uses it, the whole team should benefit.

## Solution

"Upload Team" feature: users can invite their team members to join the platform. The inviting user earns credits for every new user who signs up through their invitation.

### Core Flow

1. **User uploads team roster** — names + email addresses (or phone numbers) for teammates
2. **System sends invitations** — email/SMS with personalized invite link containing referral code
3. **New user signs up via invite** — linked to the team, inviter gets credit reward
4. **Team page** — shows team members, their highlight reels, shared content

### Credit Incentive

- Inviter earns X credits per teammate who signs up
- Bonus credits if teammate completes Quest 1 (ensures quality signups, not just registrations)
- Cap on credits per team to prevent abuse

### Team Data Model

- Teams have a name, sport, and member list
- Users can belong to multiple teams (club team + school team)
- Team membership is symmetric (if A invites B, both are on the team)
- Team page shows aggregated content from all members

## Context

### Relevant Files
- `src/backend/app/services/user_db.py` — User database, credit system
- `src/backend/app/routers/quests.py` — Quest/achievement system (referral quest hooks here)
- `src/frontend/src/stores/authStore.js` — User identity
- New files needed for team CRUD, invitation sending, referral tracking

### Related Tasks
- T1060 (Coaches View) — coaches also manage teams but with different permissions
- T1070 (Team & Profiles Quest) — quest that encourages team uploads
- T530 (Credit System) — DONE — credit granting infrastructure exists

### Technical Notes
- Invitation links: `app.reelballers.com/invite/{code}` where code maps to inviter + team
- Need email sending (Resend already integrated for OTP — T401)
- Referral tracking: `credit_transactions` with source `referral` and reference_id = invited user's ID
- Abuse prevention: rate limit invitations, cap credits per team, require invited user to complete a quest step

## Implementation

### Steps
1. [ ] Design team data model (teams table, team_members table)
2. [ ] Build team CRUD API (create team, add members, invite)
3. [ ] Build invitation sending (email via Resend)
4. [ ] Build referral tracking + credit rewards
5. [ ] Build team UI (create team, manage roster, see members)
6. [ ] Build invite landing page (sign up via invite link)
7. [ ] Add referral quest step (optional — ties into T1070)

## Acceptance Criteria

- [ ] User can create a team and invite members by email
- [ ] Invited users receive email with signup link
- [ ] Inviter earns credits when invited user signs up
- [ ] Team page shows all members
- [ ] Abuse prevention: rate limits, credit caps
