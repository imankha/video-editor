# T3470: Fill Tracking Gaps

**Status:** TODO
**Priority:** P1
**Impact:** 7 | **Complexity:** 2

## Summary

Instrument 7 user actions that currently happen in the app but are not tracked. Each is a single `record_milestone()` call at an existing code location.

## Why

These are critical funnel steps we're blind to. Without them:
- We can't measure the viral loop (share_viewed)
- We can't see payment funnel drop-off (payment_started vs completed)
- We can't track onboarding completion (quest_completed)
- We can't measure session frequency directly (session_started)
- We can't distinguish export attempts from completions (export_started)

See [EPIC.md](EPIC.md) for full gap analysis.

## New Events

| Event | Where to Fire | Context | Why It Matters |
|-------|--------------|---------|----------------|
| `session_started` | `analytics.update_session()` when 30min gap triggers increment | `{"is_pwa": bool}` | Recency/frequency for churn prediction, session count per user |
| `quest_completed` | `quests.py` POST /quests/{id}/claim handler | `{"quest_id": id, "quest_name": name}` | Onboarding completion rates, which quests block users |
| `invite_sent` | `shares.py` after send_share_email calls | `{"recipient_email": email, "share_type": type}` | Viral loop: how many invites go out per user |
| `share_viewed` | `shares.py` GET /shared/{token} handler | `{"share_token": token, "sharer_user_id": id}` | Viral conversion: did the recipient actually look? |
| `payment_started` | `payments.py` POST /payments/create-intent | `{"amount_cents": n}` | Payment funnel: started vs completed ratio |
| `payment_completed` | `payments.py` POST /payments/verify | `{"amount_cents": n, "credits": n}` | Revenue attribution (supplements existing credit_purchased) |
| `export_started` | `exports.py` POST /exports (after job created) | `{"export_id": job_id, "type": type}` | Export funnel: started vs completed vs failed |

## Implementation

Each event = 1-3 lines added at an existing code location:

```python
# Example: session_started in analytics.py update_session()
# Inside the "if last_active_at < 30 min ago" branch:
record_milestone(user_id, "session_started", {"is_pwa": is_pwa})
```

### Analytics registry

Add all 7 events to `FLOW_EVENTS` in `analytics.py`:

```python
FLOW_EVENTS = {
    # ... existing events ...
    "session_started":     {"label": "Session",          "daily_col": "sessions_started"},
    "quest_completed":     {"label": "Quest Done",       "daily_col": None},
    "invite_sent":         {"label": "Invited",          "daily_col": "invites_sent"},
    "share_viewed":        {"label": "Share Viewed",     "daily_col": "shares_viewed"},
    "payment_started":     {"label": "Payment Started",  "daily_col": None},
    "payment_completed":   {"label": "Payment Done",     "daily_col": None},
    "export_started":      {"label": "Export Started",   "daily_col": "exports_started"},
}
```

### daily_counters migration

Add new columns to `daily_counters` for events that have daily_col:
- `sessions_started`
- `invites_sent`
- `shares_viewed`
- `exports_started`

### FUNNEL_STEPS update

Insert new steps into the funnel:

```python
FUNNEL_STEPS = [
    "session_started",           # NEW
    "game_created",
    "clip_created",
    "annotation_completed",
    "framing_opened",
    "framing_exported",
    "overlay_exported",
    "export_started",            # NEW
    "export_completed",          # already tracked, add to funnel
    "gallery_viewed",
    "video_downloaded",
    "share_completed",
    "invite_sent",               # NEW
    "share_viewed",              # NEW (viral conversion)
    "credit_purchased",
]
```

## Special: share_viewed tracking

`share_viewed` fires on GET /shared/{token} -- this is an **unauthenticated** endpoint (the viewer may not have an account). Track it as an action on the **sharer's** user_id, not the viewer's:

```python
# In shares.py GET /shared/{token}:
# share row has sharer_user_id
record_milestone(share.sharer_user_id, "share_viewed", {"share_token": token})
```

This way the sharer's funnel shows: shared -> viewed -> (recipient signed up via referral).

## Dependencies

- T3450 (schema normalization) should be done first so we write to `user_actions` not `user_milestones`
- T3460 (action log) should be done first so these events also write to SQLite with context

## Testing

- Trigger each event in the app and verify it appears in:
  1. `user_actions` table (Postgres)
  2. `user_action_log` table (SQLite)
  3. `daily_counters` table (where applicable)
- Verify share_viewed records against the sharer's user_id
- Verify session_started only fires on 30min gap (not every request)
