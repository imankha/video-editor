# T1840: Cross-User Clip Delivery

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

When a user tags a clip with a teammate's email, that teammate needs to receive the clip in their own database so they can frame and export it. No mechanism exists for cross-user clip transfer.

## Solution

When a clip is saved with player tags pointing to other users' emails, create `pending_shares` records and send email notifications. When the recipient claims the share (via T1830 inbox), materialize the game record and raw clip in the recipient's chosen profile database, pointing to the same R2 video (no file duplication).

## Context

### Relevant Files (REQUIRED)

**Backend:**
- `src/backend/app/routers/clips.py` — Hook into player tag save to create pending shares
- `src/backend/app/database.py` — Materialization: create game + raw_clip in recipient's profile DB
- `src/backend/app/routers/sharing.py` — Claim handler for clip-type shares
- `src/backend/app/email_utils.py` — Send notification email to recipient

### Related Tasks
- Depends on: T1810 (player tag model), T1820 (tagging UI), T1830 (inbox/claim infrastructure)
- Related: T1760 (share email delivery — similar Resend integration)

### Technical Notes

**Trigger: Player tag save creates pending shares**
When `PUT /api/clips/raw/{id}/player-tags` is called:
1. Diff new tags vs existing tags
2. For each newly added email (not the sharer's own email):
   - Look up `recipient_user_id` in auth.sqlite (may be NULL if not registered)
   - Create `pending_shares` record with `share_type='clip'`
   - `source_data` JSON: `{game_id, game_blake3_hash, game_name, raw_clip: {start_time, end_time, rating, tags, name, notes, video_sequence}}`
   - Send email notification via Resend
3. For removed tags: optionally revoke unclaimed pending shares

**Materialization on claim (the core complexity):**
When recipient claims a clip share to a profile:
1. Open recipient's profile database
2. Check if game already exists (by `blake3_hash`):
   - Yes: reuse existing game record
   - No: create `games` + `game_videos` records pointing to same R2 objects
3. Create `raw_clips` record with the shared clip metadata
4. The clip now appears in the recipient's clip library, linked to the game
5. Recipient can create reels, frame, export — full pipeline access

**No video duplication:**
Games are stored on R2 by `blake3_hash` (content-addressed). The recipient's game record points to the same R2 key. No copy needed.

**Email template:**
"[Sharer name] shared a clip with you from [game name]. Sign in to view and edit it."
CTA button: link to inbox or directly to `/shared/claim/{share_id}`

## Implementation

### Steps
1. [ ] Backend: Hook player tag save → create pending_shares for new recipient emails
2. [ ] Backend: Diff logic — only create shares for newly added tags, not existing ones
3. [ ] Backend: Claim handler for clip shares — materialize game + raw_clip in recipient's profile DB
4. [ ] Backend: Game deduplication — check blake3_hash before creating game record
5. [ ] Backend: Email notification on new clip share (via Resend)
6. [ ] Backend: Handle tag removal — revoke unclaimed pending shares
7. [ ] Tests: Claim materialization, game dedup, pending share lifecycle

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Tagging a clip with a new email creates a pending_share record
- [ ] Recipient receives email notification
- [ ] Claiming materializes game + raw_clip in recipient's profile DB
- [ ] Game deduplication: same blake3_hash doesn't create duplicate games
- [ ] Materialized clip has correct metadata (rating, tags, name, notes, boundaries)
- [ ] Recipient can frame and export the claimed clip
- [ ] Removing a player tag revokes unclaimed pending shares
- [ ] Non-users: pending share waits and resolves on signup
