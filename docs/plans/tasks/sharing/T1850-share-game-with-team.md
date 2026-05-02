# T1850: Share Game

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-04-25
**Updated:** 2026-05-02

## Problem

Users upload game footage that friends on the team could also use. Currently there's no way to share raw game footage with others. An advocate who uploads a game should be able to share it with a few friends so they can annotate their own clips from the same footage.

## Solution

Add a "Share" button on game cards. Opens a UserPicker for entering individual emails — sharing is with friends, not a team broadcast. Creates pending shares for each recipient. On claim, the recipient gets the full game in their profile database (same R2 video, no duplication, no credit cost).

## Context

### Relevant Files (REQUIRED)

**Frontend:**
- `src/frontend/src/components/ProjectManager.jsx` — Game cards, add share button
- New: `src/frontend/src/components/ShareGameModal.jsx` — Uses UserPicker
- `src/frontend/src/components/shared/UserPicker.jsx` — Reuse (from T1800)

**Backend:**
- `src/backend/app/routers/sharing.py` — Share game endpoint
- `src/backend/app/routers/games.py` — Game metadata for share payload
- `src/backend/app/email_utils.py` — Share notification email

### Related Tasks
- Depends on: T1800 (UserPicker), T1830 (inbox/claim flow + materialization)
- Related: T1840 (tagged clip sharing uses same game materialization pattern)

### Technical Notes

**Share flow:**
1. User clicks "Share" on a game card
2. ShareGameModal opens with UserPicker
3. User enters friend emails (autocomplete from shared_contacts)
4. Submit → `POST /api/games/{game_id}/share` with `{recipient_emails: [str]}`
5. Backend creates `pending_shares` records with `share_type = 'game'`
6. `source_data` JSON: `{game_id, game_name, blake3_hash, game_videos: [{blake3_hash, sequence, duration}], opponent_name, game_date}`
7. Sends email to each recipient

**Materialization on claim (handled by T1830):**
1. Open recipient's profile database
2. Check if game exists (by `blake3_hash`):
   - Yes: skip (game already shared or uploaded by recipient)
   - No: create `games` record + `game_videos` records pointing to same R2 objects
3. Game appears in recipient's games list, ready for annotation

**No cost to recipient:** The game video is already on R2, paid for by the uploader's storage credits. The recipient gets a database reference — no R2 duplication, no credit charge.

**Expiry:** The game expires with the uploader's storage credits. When the R2 video is deleted, shared recipients also lose access to raw footage. However, any finalized clips or My Reels entries created from the game survive — those are prepaid and permanent.

**Email template:**
"[Sharer name] shared game footage with you: [game name]. Sign in to start creating your highlight clips."
CTA: link to inbox

## Implementation

### Steps
1. [ ] Frontend: "Share" button on game cards
2. [ ] Frontend: ShareGameModal with UserPicker
3. [ ] Backend: `POST /api/games/{game_id}/share` endpoint
4. [ ] Backend: Create pending_shares for each recipient email + send emails
5. [ ] Tests: Share creation, email delivery

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] "Share" button visible on game cards
- [ ] Modal opens with UserPicker for entering individual emails
- [ ] Submitting creates pending shares and sends emails
- [ ] Recipient claims game to a profile (via T1830 inbox)
- [ ] Game appears in recipient's games list with full video access
- [ ] Game deduplication: no duplicate if recipient already has the game
- [ ] No credit cost to recipient
- [ ] Non-users: pending share resolves on signup
