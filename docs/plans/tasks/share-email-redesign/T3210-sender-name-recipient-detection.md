# T3210: Sender Name + Recipient Detection

**Status:** TODO
**Epic:** [Share Email Redesign](EPIC.md)
**Depends on:** T3200 (Email Design System)

## Goal

Emails should show "Sarah shared a clip with you" not "sarah@gmail.com shared a clip with you." Also detect whether the recipient already has an account so T3220 can choose the right template variant.

## Current State

All 4 share email functions receive `sharer_email: str` and use it directly in subject lines and body text:

```python
# email.py line 407
"subject": f"{sharer_email} shared a video with you on Reel Ballers"

# email.py line 378
f"Check out this soccer highlight from {_html_escape(sharer_email)}"
```

Sender lookup in share endpoints:
```python
# shares.py ~line 170
sharer = get_user_by_id(user_id)
sharer_email = sharer["email"] if sharer else user_id
```

No display_name field exists on the Postgres users table currently. No recipient account detection.

## Implementation

### 1. Sender Name Resolution

The Postgres `users` table has `email` but no `display_name`. Two options:

**Option A (recommended): Derive from email + athlete profile.**
- Query the user's profile SQLite for `athlete_name` (from T1610 Athlete Profile).
- If `athlete_name` exists, use it as sender name.
- Fallback: extract the local part of the email, title-case it (e.g., "sarah.jones@gmail.com" -> "Sarah Jones", "imankh@gmail.com" -> "Imankh").

**Option B: Add display_name column to Postgres users.**
- Postgres migration + UI to set display name.
- More correct but higher scope for this epic.

Go with Option A. Add a helper function:

```python
async def _resolve_sender_name(user_id: str, sharer_email: str) -> str:
    """Best-effort sender display name: athlete profile name > email local part."""
    # Try athlete profile name from user's SQLite
    # ... (load user DB, query athlete_name)
    # Fallback: email local part, title-cased
    local_part = sharer_email.split("@")[0]
    return local_part.replace(".", " ").replace("_", " ").title()
```

### 2. Recipient Account Detection

Check if recipient email exists in Postgres `users` table:

```python
async def _is_existing_user(email: str) -> bool:
    """Check if the recipient has a Reel Ballers account."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE email = %s", (email,))
        return cur.fetchone() is not None
```

This determines `is_first_touch` for the email template.

### 3. Update Email Function Signatures

All 4 share email functions gain two new parameters:

```python
async def send_share_email(
    recipient_email: str,
    sharer_email: str,
    share_token: str,
    video_name: str,
    sender_name: str = "",        # NEW
    is_first_touch: bool = True,  # NEW
) -> bool:
```

### 4. Update All Callers

Each share endpoint resolves the name and checks recipient status before calling the email function:

**Callers to update:**
- `src/backend/app/routes/shares.py` — `send_share_email()` call (~line 199)
- `src/backend/app/routes/clips.py` — `send_teammate_share_email()` call (~line 2191)
- `src/backend/app/routes/games.py` — `send_game_share_email()` call (~line 1605)
- `src/backend/app/routes/games.py` — `send_playback_share_email()` call (~line 1777)

Pattern at each call site:
```python
sender_name = await _resolve_sender_name(user_id, sharer_email)
is_first_touch = not await _is_existing_user(recipient_email)
await send_share_email(..., sender_name=sender_name, is_first_touch=is_first_touch)
```

### 5. From Header Update

Use sender name in the From header via Resend:
```python
from_address = f"{sender_name} via Reel Ballers <noreply@reelballers.com>" if sender_name else FROM_ADDRESS
```

Resend supports custom From display names in this format.

## Files Changed

- `src/backend/app/services/email.py` — add `_resolve_sender_name()`, `_is_existing_user()`, update 4 function signatures
- `src/backend/app/routes/shares.py` — resolve name + detect recipient at share endpoint
- `src/backend/app/routes/clips.py` — resolve name + detect recipient at teammate share endpoint
- `src/backend/app/routes/games.py` — resolve name + detect recipient at game share and playback share endpoints

## Test Scope

- Unit test `_resolve_sender_name()`: athlete name path, email fallback path, edge cases (no dots, underscores)
- Unit test `_is_existing_user()`: existing user returns False for is_first_touch, new email returns True
- Integration: share endpoint passes sender_name and is_first_touch through to email function
