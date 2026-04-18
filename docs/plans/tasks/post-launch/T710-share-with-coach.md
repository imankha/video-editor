# T710: Share with Coach

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-04-18

## Problem

Players annotate their own game footage but have no way to get coach feedback on it. Coaches want to review clips, adjust ratings, and add notes — but currently there's no sharing or collaboration flow.

## Solution

A "Share with Coach" action on an annotated game that sends an email with a link. The coach opens the link, lands in a coach-specific profile view, reviews the annotated game, can change clip ratings, add notes per clip, and "send back" — which pushes the changes back to the original user's annotated game.

### User Flow

1. **Player** clicks "Share with Coach" on an annotated game
2. Player enters coach's email address
3. System sends email to coach with a link to the annotated game
4. **Coach** clicks link:
   - If no account: signs up, account created with coach profile
   - If existing account: coach profile added (one account can have many player profiles associated)
5. Coach sees the annotated game in a read/review mode:
   - View all clips with current ratings
   - Change clip ratings (e.g., star ratings, good/bad/neutral)
   - Add text notes per clip
   - Add overall game notes
6. Coach clicks "Send Back"
7. **Player** sees updated ratings and coach notes on their annotated game

### Coach Profile Model

- A coach account can be associated with many player profiles (one coach, many athletes)
- Each association is created when a player shares with that coach's email
- Coach sees a list of all players who have shared with them
- Coach profile is separate from any player profile the coach might also have

## Context

### Relevant Files
- TBD — requires architecture design

### Related Tasks
- T1050 (Team Invitations) — similar email-based invite flow, could share infrastructure
- T1060 (Coaches View) — this is a lighter version focused on review rather than full coach account management
- T1073 (Team + Athlete Name) — coach notes could reference athlete names

### Technical Notes
- Email delivery: need transactional email service (SendGrid, Resend, etc.)
- Sharing link: signed URL or token-based access
- Data model: shared_games table linking coach_user_id to player's game, with coach_annotations (ratings, notes) stored separately and merged on "send back"
- Persistence: coach changes stored in a separate layer until "send back", then merged into the player's data

## Acceptance Criteria

- [ ] Player can share an annotated game via coach email
- [ ] Coach receives email with working link
- [ ] Coach can view all clips in the shared game
- [ ] Coach can change clip ratings
- [ ] Coach can add notes per clip and overall
- [ ] "Send back" pushes changes to the player's game
- [ ] Player sees coach feedback on their game
- [ ] One coach can be associated with multiple players
