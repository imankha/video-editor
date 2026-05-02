# T1840: Tag Teammate at Framing

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-04-25
**Updated:** 2026-05-02

## Problem

When an advocate user frames and exports a teammate's clip, the polished result is trapped in their account. The teammate's parent — the person who'd most want to see it — has no way to receive it. An unfinished annotation isn't worth sharing; the real value comes after framing and overlay produce a polished output.

## Solution

During the framing export background task (while the user is waiting for GPU processing), detect that the clip is marked `is_teammate` and show a sharing prompt. The user enters email(s) via the UserPicker. After export completes, create pending_shares and send notification emails. On claim, the recipient gets the game, annotation, AND the finished My Reels entry — instant gratification without any effort.

## Context

### Relevant Files (REQUIRED)

**Frontend:**
- `src/frontend/src/modes/framing/components/FramingExportProgress.jsx` (or equivalent export wait UI) — Show sharing prompt for teammate clips
- `src/frontend/src/components/shared/UserPicker.jsx` — Reuse for email entry
- `src/frontend/src/stores/exportStore.js` — Track sharing intent during export

**Backend:**
- `src/backend/app/routers/sharing.py` — Endpoint: create tagged_clip share
- `src/backend/app/database.py` — Materialization handled by T1830 claim flow
- `src/backend/app/email_utils.py` — Share notification email

### Related Tasks
- Depends on: T1810 (is_teammate flag), T1820 (toggle UI sets the flag), T1830 (inbox/claim infrastructure + materialization), T1760 (Resend email delivery)
- Related: T1850 (Share Game — similar game materialization pattern)

### Technical Notes

**Why during framing export:**
- The user is already idle (GPU processing takes 10-30s)
- The clip has just become "real work" — framed, polished, worth sharing
- Zero additional friction — they're waiting anyway
- This is the moment of maximum motivation: "Jake's dad needs to see this"

**Trigger UX:**
1. User clicks "Frame Video" on a clip where `is_teammate = true`
2. Framing export starts (background GPU task)
3. While the progress indicator shows, a sharing section appears below it:
   - "Share this clip with [teammate]'s parent?"
   - UserPicker for entering email(s)
   - "Share after export" / "Skip" buttons
4. User enters emails and confirms → sharing intent stored locally
5. When export completes → share created, emails sent

**Share creation (backend):**
`POST /api/sharing/clip-share`
```json
{
  "raw_clip_id": 123,
  "published_video_id": 456,
  "recipient_emails": ["jake.dad@example.com"]
}
```

For each recipient:
1. Look up recipient in auth.sqlite (may be NULL if not registered)
2. Create `pending_shares` record with `share_type = 'tagged_clip'`
3. `source_data` includes game metadata, clip metadata, and My Reels video reference (see T1830 for schema)
4. Send email via Resend

**What the recipient gets on claim (materialized by T1830):**
1. **Game** — check by blake3_hash, skip if exists. Create `games` + `game_videos` pointing to same R2 objects.
2. **Annotation** — create `raw_clips` record with shared clip metadata. Linked to game.
3. **My Reels entry** — create `published_videos` record pointing to same R2 video. Immediately watchable.

No R2 file duplication. No credit cost to recipient.

**Email template:**
"[Advocate name] made a highlight clip from [game name] — check it out!"
CTA: link to inbox

**Skip behavior:** No share created. The teammate flag stays on the clip. The advocate can always share the finished clip later through the My Reels share flow (existing gallery sharing).

## Implementation

### Steps
1. [ ] Frontend: Detect `is_teammate` on framing export start → show sharing section in export wait UI
2. [ ] Frontend: UserPicker integration in export wait UI
3. [ ] Frontend: Store sharing intent locally, fire `POST /api/sharing/clip-share` on export completion
4. [ ] Backend: `POST /api/sharing/clip-share` endpoint — gathers game + clip + published_video data, creates pending_shares
5. [ ] Backend: Email notification via Resend
6. [ ] Tests: Share creation, source_data correctness, skip behavior

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Framing export of `is_teammate` clip shows sharing prompt during wait
- [ ] UserPicker works in export wait context (autocomplete, green/yellow status)
- [ ] Share created only after export completes (not before)
- [ ] Recipient receives email notification
- [ ] Claiming materializes game + annotation + My Reels entry (via T1830 claim handler)
- [ ] Recipient can immediately watch the clip in My Reels
- [ ] Recipient can also re-frame/re-overlay the annotation independently
- [ ] Skipping the prompt creates no share (no side effects)
- [ ] Non-users: pending share resolves on signup
