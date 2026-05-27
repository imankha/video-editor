# T3220: Rewrite Share Email Templates

**Status:** TODO
**Epic:** [Share Email Redesign](EPIC.md)
**Depends on:** T3200 (Email Design System), T3210 (Sender Name + Recipient Detection)

## Goal

Apply the design system and sender identity to all 4 share email functions. Each email gets two variants (first-touch / returning) with copy tuned to overcome spam skepticism or deliver a streamlined notification.

## Email-by-Email Specification

### 1. `send_teammate_share_email()` — Tagged Player Clips

This is the most important email (the screenshot the user showed). A parent tagged another parent's kid in game highlights.

**First-touch subject:** `{SenderName} tagged {PlayerName} in a highlight from {GameName}`
**Returning subject:** `New clip: {PlayerName} tagged in {GameName}`

**First-touch body:**
```
{SenderName} used Reel Ballers to clip highlights from {GameName}
and tagged {PlayerName} in {clip_count} clip(s).

[Watch Clips]

No account needed to watch.
Reel Ballers helps soccer parents create and share game highlights.
```

**Returning body:**
```
{SenderName} tagged {PlayerName} in {clip_count} clip(s) from {GameName}.

[Watch Clips]  ·  Open in your gallery
```

**Preheader (first-touch):** `Watch {PlayerName}'s highlight — {SenderName} thought you'd want to see this.`
**Preheader (returning):** `{clip_count} new clip(s) from {GameName}`

### 2. `send_share_email()` — Video Sharing

A finished reel shared with someone.

**First-touch subject:** `{SenderName} shared a highlight reel with you`
**Returning subject:** `New shared reel: {VideoName}`

**First-touch body:**
```
{SenderName} shared a highlight reel with you:

{VideoName}

[Watch Reel]

No account needed to watch.
Reel Ballers helps soccer parents create and share game highlights.
```

**Returning body:**
```
{SenderName} shared a reel with you:

{VideoName}

[Watch Reel]  ·  Open in your gallery
```

### 3. `send_game_share_email()` — Full Game Sharing

Sharing an entire game's footage.

**First-touch subject:** `{SenderName} shared game footage with you`
**Returning subject:** `{SenderName} shared {GameName} with you`

**First-touch body:**
```
{SenderName} shared game footage with you:

{GameName}

[View Game]

No account needed to watch.
Reel Ballers helps soccer parents create and share game highlights.
```

**Returning body:**
```
{SenderName} shared a game with you:

{GameName}

[View Game]  ·  Open in your gallery
```

### 4. `send_playback_share_email()` — Annotated Playback

Sharing annotated game playback (clips with timestamps/tags).

**First-touch subject:** `{SenderName} shared game annotations with you`
**Returning subject:** `{SenderName} shared annotations from {GameName}`

**First-touch body:**
```
{SenderName} shared annotated game highlights from:

{GameName}

[Watch Annotations]

No account needed to watch.
Reel Ballers helps soccer parents create and share game highlights.
```

**Returning body:**
```
{SenderName} shared annotations from:

{GameName}

[Watch Annotations]  ·  Open in your gallery
```

## Implementation Pattern

Each email function becomes a thin wrapper around `_build_share_email()`:

```python
async def send_teammate_share_email(
    recipient_email, sharer_email, tag_name, game_name,
    clip_count, share_token=None, sender_name="", is_first_touch=True,
) -> bool:
    # ... API key check, URL construction ...

    clip_text = f"{clip_count} clip{'s' if clip_count != 1 else ''}"

    if is_first_touch:
        subject = f"{sender_name} tagged {tag_name} in a highlight from {game_name}"
        heading = f"{sender_name} used Reel Ballers to clip highlights from"
        preheader = f"Watch {tag_name}'s highlight — {sender_name} thought you'd want to see this."
    else:
        subject = f"New clip: {tag_name} tagged in {game_name}"
        heading = f"{sender_name} tagged {tag_name} in {clip_text} from"
        preheader = f"{clip_text} from {game_name}"

    html_body = _build_share_email(
        heading=heading,
        game_name=game_name,
        cta_url=share_url,
        cta_text="Watch Clips",
        footer_reason=f"{sender_name} shared game clips with you",
        is_first_touch=is_first_touch,
        preheader=preheader,
    )

    from_address = f"{sender_name} via Reel Ballers <noreply@reelballers.com>" if sender_name else FROM_ADDRESS

    # ... send via Resend ...
```

## "Open in your gallery" Secondary CTA (Returning Users Only)

For returning users, add a secondary text link below the primary CTA button:

```html
<a href="{gallery_url}" style="color: #6d28d9; text-decoration: none; font-size: 14px;">
  Open in your gallery
</a>
```

The gallery URL is `{scheme}://{domain}/gallery` (or `/home` depending on current routing). This only appears when `is_first_touch=False`.

## Files Changed

- `src/backend/app/services/email.py` — rewrite all 4 `send_*_email()` functions to use `_build_share_email()`

## Test Scope

- Backend unit: each email function produces correct subject line for first-touch and returning variants
- Backend unit: sender_name appears in subject and body, raw email does NOT appear
- Backend unit: first-touch includes "No account needed", returning does not
- Manual: send test email to personal Gmail, verify rendering in light + dark mode
- Manual: check Outlook web rendering if possible

## Visual Checklist

After implementation, verify in Gmail:
- [ ] Light background renders correctly
- [ ] Purple accent bar at top
- [ ] CTA button is clearly visible and clickable
- [ ] Footer text is readable (not blending with background)
- [ ] Subject line shows name, not email
- [ ] First-touch email includes trust copy
- [ ] Dark mode: email still readable after Gmail inversion
