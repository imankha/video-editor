# T3460: SQLite Action Log + Recording

**Status:** TODO
**Priority:** P0 (blocks user detail redesign)
**Impact:** 8 | **Complexity:** 3

## Summary

Add a `user_action_log` table to per-user SQLite that records every action as an individual timestamped row with context JSON. Wire `record_milestone()` to write here alongside the existing Postgres writes.

## Why

Current SQLite tracking (`user_activity_events`) only stores aggregate counts per event -- no individual timestamps, no context. A data analyst can't "zoom into a user" and see their action-by-action timeline. This table is the raw log that powers the admin user detail view.

See [EPIC.md](EPIC.md) for design decisions.

## Schema

Add to `_USER_DB_SCHEMA` in `user_db.py`:

```sql
CREATE TABLE IF NOT EXISTS user_action_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    context TEXT,              -- JSON: {game_id, clip_id, project_id, ...}
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_action_log_action ON user_action_log(action);
CREATE INDEX IF NOT EXISTS idx_action_log_created ON user_action_log(created_at);
```

Bump `PRAGMA user_version` accordingly.

## Code Changes

### `analytics.py`

Update `record_milestone()` to also INSERT into `user_action_log`:

```python
def record_milestone(user_id: str, event: str, context: dict | None = None):
    # ... existing Postgres writes ...

    # SQLite: individual action log
    try:
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection(user_id) as conn:
            conn.execute(
                "INSERT INTO user_action_log (action, context) VALUES (?, ?)",
                (event, json.dumps(context) if context else None),
            )
            # ... existing user_activity_events upsert ...
            conn.commit()
    except Exception:
        logger.warning(...)
```

### Call sites -- add context dicts

Every `record_milestone()` call site should pass relevant context:

| Call Site | Context |
|-----------|---------|
| `games.py` game_created | `{"game_id": game_id, "game_name": name}` |
| `clips.py` clip_created | `{"clip_id": clip_id, "game_id": game_id, "rating": rating}` |
| `games.py` annotation_completed | `{"game_id": game_id, "clip_count": n}` |
| `exports.py` export_completed | `{"export_id": job_id, "type": export_type}` |
| `export_worker.py` framing_exported | `{"export_id": job_id, "project_id": project_id}` |
| `overlay.py` overlay_exported | `{"export_id": job_id, "project_id": project_id}` |
| `downloads.py` video_downloaded | `{"video_id": video_id}` |
| `shares.py` share_completed | `{"recipient_count": n, "share_type": type}` |
| `payments.py` credit_purchased | `{"amount": credits, "cents": amount_cents}` |
| `quests.py` framing_opened | `{}` |
| `quests.py` gallery_viewed | `{}` |

### New endpoint

`GET /api/admin/analytics/user/{user_id}/actions`

Reads from the user's SQLite `user_action_log`, returns paginated list:

```json
{
  "actions": [
    {"id": 1, "action": "session_started", "context": null, "created_at": "2026-05-27T09:14:00"},
    {"id": 2, "action": "game_created", "context": {"game_id": "abc", "game_name": "Beach FC"}, "created_at": "2026-05-27T09:15:00"}
  ],
  "total": 147,
  "page": 1,
  "page_size": 50
}
```

## Migration

For existing users: their `user_action_log` will be empty (no backfill -- we only have aggregate counts, not individual timestamps). This is fine -- the log starts recording from deploy forward. The aggregate counts in `user_actions` (Postgres) still power the funnel/cohort views for historical data.

## Testing

- Create a clip -> verify `user_action_log` row with context JSON
- Complete an export -> verify row
- Call admin endpoint -> verify paginated response
- Verify existing `user_activity_events` upsert still works alongside new log writes

## Notes

- Context is intentionally unstructured JSON -- different actions have different relevant fields. Don't over-normalize.
- No TTL or cleanup needed at current scale. Revisit if action log exceeds ~10k rows per user.
- Depends on T3450 for the `record_milestone()` signature change (adding context param).
