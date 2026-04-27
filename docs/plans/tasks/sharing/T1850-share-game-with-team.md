# T1850: Share Game with Team

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

Users upload game footage that their teammates could also use. Currently there's no way to share a full game with others. A user who uploads a game should be able to share it with their team so teammates can annotate their own clips from the same footage.

## Solution

Add a "Share with Team" button on game cards. Uses the UserPicker component (T1800) for entering teammate emails. Creates pending shares for each recipient. On claim, the recipient gets the full game in their profile database (same R2 video, no duplication). Sends email notifications with a link.

## Context

### Relevant Files (REQUIRED)

**Frontend:**
- `src/frontend/src/components/ProjectManager.jsx` — Game cards, add share button
- New: `src/frontend/src/components/ShareGameModal.jsx` — Uses UserPicker
- `src/frontend/src/components/shared/UserPicker.jsx` — Reuse (from T1800)

**Backend:**
- New or extend: `src/backend/app/routers/sharing.py` — Share game endpoint
- `src/backend/app/routers/games.py` — Game metadata for share payload
- `src/backend/app/database.py` — Materialization: create game + game_videos in recipient's DB
- `src/backend/app/email_utils.py` — Share notification email

### Related Tasks
- Depends on: T1800 (UserPicker), T1830 (inbox/claim flow)
- Related: T1840 (clip delivery uses same materialization pattern for games)

### Technical Notes

**Share flow:**
1. User clicks "Share with Team" on a game card
2. ShareGameModal opens with UserPicker
3. User enters teammate emails (autocomplete from shared_contacts)
4. Submit → `POST /api/games/{game_id}/share` with `{recipient_emails: [str]}`
5. Backend creates `pending_shares` records with `share_type='game'`
6. `source_data` JSON: `{game_id, game_name, blake3_hash, game_videos: [{blake3_hash, sequence, duration}], opponent_name, game_date}`
7. Sends email to each recipient

**Materialization on claim:**
1. Open recipient's profile database
2. Check if game exists (by `blake3_hash`):
   - Yes: skip (game already shared or uploaded by recipient)
   - No: create `games` record + `game_videos` records pointing to same R2 objects
3. Game appears in recipient's games list, ready for annotation

**Email template:**
"[Sharer name] shared a game with you: [game name]. Sign in to start creating your highlight clips."
CTA: link to inbox or directly to game

## Implementation

### Steps
1. [ ] Frontend: "Share with Team" button on game cards
2. [ ] Frontend: ShareGameModal with UserPicker
3. [ ] Backend: `POST /api/games/{game_id}/share` endpoint
4. [ ] Backend: Create pending_shares for each recipient email
5. [ ] Backend: Claim handler for game shares — materialize game + game_videos in recipient's DB
6. [ ] Backend: Email notification via Resend
7. [ ] Tests: Share creation, claim materialization, game dedup

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] "Share with Team" button visible on game cards
- [ ] Modal opens with UserPicker for entering teammate emails
- [ ] Submitting creates pending shares and sends emails
- [ ] Recipient claims game to a profile
- [ ] Game appears in recipient's games list with full video access
- [ ] Game deduplication: no duplicate if recipient already has the game
- [ ] Non-users: pending share resolves on signup
