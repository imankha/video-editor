# T2905: Share Annotated Playback via Link

**Status:** TODO
**Epic:** [Invite & Referral](EPIC.md)
**Impact:** 7
**Complexity:** 4
**Created:** 2026-05-15
**Depends on:** T2900 (invite code capture for referral attribution on signup)

## Problem

Users can share game clips with teammates (T2850) but can't share their annotated playback view with anyone via email link. Grandparents, other family members, and friends outside the team have no way to see the annotated highlights. This is also a missed growth channel -- non-users who receive a playback link see the product in action and have a natural path to signup.

## Solution

Add a "Share Playback" flow that creates a share link and emails it to one or more recipients. Recipients see the annotated playback experience (reusing T2840's SharedAnnotationView) with a signup CTA. This feeds the `annotation_share` channel in the referral graph (T2910).

### 1. Share Button on Recap / Playback View

Add a share button to the RecapPlayerModal (or wherever annotated playback is viewed). Clicking opens a share dialog (email input, similar to existing share flows).

### 2. Backend: Create Annotation Share

Reuse the existing `shares` table (T2825) with `share_type = 'annotation_playback'`.

```
POST /api/games/{game_id}/share-playback
Body: { "emails": ["grandma@example.com"], "tag_name": "Jake" }
```

1. Create a `shares` row per recipient email with `share_type = 'annotation_playback'`
2. Create `share_games` row linking to the game_id and tag_name
3. Pre-serialize clip annotations (same pattern as T2830's `serialize_clip_data()`) into `pending_teammate_shares.clip_data` for non-user recipients
4. Generate `share_token` for each recipient

### 3. Email Delivery

Reuse existing Resend integration (`src/backend/app/services/email.py`). New email template:

```
Subject: [sharer_name] shared [athlete_name]'s highlights with you

Body:
[sharer_name] shared annotated highlights from [game_name] with you.

Watch the highlights: [link to /shared/teammate/{share_token}]

-- Reel Ballers
```

Fire-and-forget pattern (share created regardless of email success), same as T1760.

### 4. Recipient View

Reuse T2840's `/shared/teammate/:shareToken` route and SharedAnnotationView component. The `share_type = 'annotation_playback'` shares resolve through the same `GET /api/shared/teammate/{share_token}` endpoint since they use the same `shares` + `share_games` tables.

Non-user recipients see:
- Annotated playback (video + clip navigation + annotation overlay)
- Sharer attribution
- Signup CTA

Authenticated recipients see:
- Same playback view, plus option to materialize clips into their account (existing pending share resolution flow)

### 5. Referral Attribution

When a non-user signs up after viewing a shared playback link, T2910's `record_referral()` picks it up via the pending share with `channel = 'annotation_share'`.

## Files Affected

| File | Change |
|------|--------|
| `src/backend/app/routers/shares.py` | New `POST /api/games/{game_id}/share-playback` endpoint |
| `src/backend/app/services/email.py` | New `send_playback_share_email()` template |
| `src/backend/app/services/materialization.py` | Reuse `serialize_clip_data()` for annotation pre-serialization |
| `src/frontend/src/components/RecapPlayerModal.jsx` | Add share button |
| `src/frontend/src/components/SharePlaybackDialog.jsx` (new) | Email input dialog for sharing playback |

## Edge Cases

- **No annotations for game**: Share button disabled or hidden if no clips exist for the selected tag
- **Recipient already has account**: Playback view + materialize option (no signup CTA)
- **Recipient already received this share**: Existing share_token reused (don't create duplicate shares for same email + game + tag)
- **Multiple tags per game**: Share is scoped to a specific tag_name (shares one athlete's clips, not all annotations)

## Test Scope

- **Backend Unit**: share-playback endpoint creates correct shares/share_games rows, email called with correct template
- **Backend Unit**: duplicate share prevention (same email + game + tag)
- **Frontend Unit**: share button visibility based on annotation presence
- **E2E**: Share playback flow end-to-end (button click -> email input -> share created -> recipient views link)

## Acceptance Criteria

- [ ] Share button visible on annotated playback view when clips exist
- [ ] Clicking share opens email input dialog
- [ ] Submitting emails creates share records and sends email with playback link
- [ ] Non-user recipient sees annotated playback + signup CTA via shared link
- [ ] Authenticated recipient can materialize shared clips into their account
- [ ] Duplicate shares for same email + game + tag are prevented
