# T3200: Email Design System

**Status:** TODO
**Epic:** [Share Email Redesign](EPIC.md)
**Depends on:** Nothing

## Goal

Create a shared email template builder in `email.py` that all share emails use. Replaces the current inline HTML with a function that produces consistent, accessible, well-designed emails.

## Current State

Each of the 4 share email functions has its own copy-pasted HTML with:
- Dark background (#1f2937) — causes "double dark" inversion in Gmail/Outlook dark mode
- Purple CTA (#7c3aed) with 2.58:1 contrast on dark bg — fails all WCAG levels
- Footer text (#6b7280 at 11px) that blends into dark background
- `_CAN_SPAM_FOOTER` shared constant but no other template reuse
- No preheader text (inbox preview shows first HTML content)

See `src/backend/app/services/email.py` lines 375-470 for examples.

## Target State

A `_build_share_email()` function that takes structured content and returns complete HTML. Two template variants:

### Template Structure

```
[4px purple accent bar - #7c3aed, full width]
[32px padding]
[Heading - sender action text]
[Body - game name, context]
[CTA Button - primary action]
[Optional: trust line for first-touch]
[Divider - 1px #e5e7eb]
[Footer - "Sent via Reel Ballers" + CAN-SPAM]
```

### Implementation

Create `_build_share_email()` in `email.py`:

```python
def _build_share_email(
    heading: str,           # e.g. "Sarah shared a clip with you"
    game_name: str,         # e.g. "Vs LA Breakers May 9"
    cta_url: str,           # share URL
    cta_text: str,          # e.g. "Watch Clip", "View Game"
    footer_reason: str,     # e.g. "Sarah shared game clips with you"
    is_first_touch: bool,   # controls trust line visibility
    preheader: str = "",    # hidden inbox preview text
) -> str:
```

### Design Tokens (from EPIC.md)

- **Page bg:** #f9fafb
- **Content bg:** #ffffff
- **Heading:** #111827, 24px, bold
- **Body:** #1f2937, 16px
- **Secondary text:** #4b5563, 14px
- **CTA bg:** #6d28d9 (NOT #7c3aed — darker for AAA contrast)
- **CTA text:** #ffffff
- **Footer text:** #6b7280, 12-13px
- **Divider:** #e5e7eb
- **Accent bar:** #7c3aed, 4px tall, full width
- **Font stack:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`
- **Max width:** 600px
- **Button:** min 200px, 50px tall, 6px radius, 16px/700

### First-Touch Trust Line

When `is_first_touch=True`, insert below CTA:
```html
<p style="...secondary text styles...">
  No account needed to watch.
</p>
<p style="...secondary text styles...">
  Reel Ballers helps soccer parents create and share game highlights.
</p>
```

### CAN-SPAM Footer Update

Replace `_CAN_SPAM_FOOTER` with proper footer inside the template:
```
Reel Ballers
You received this because {footer_reason} on Reel Ballers.
Privacy Policy | Terms of Service
```

Keep existing Privacy Policy and Terms links. Footer text should be legible (#4b5563 for the reason line, #6b7280 for legal).

### Dark Mode Meta Tags

Include in `<head>`:
```html
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
```

### Preheader Pattern

Hidden preheader text for inbox preview (appears after subject in Gmail):
```html
<div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
  {preheader text}
</div>
```

## Files Changed

- `src/backend/app/services/email.py` — add `_build_share_email()`, update `_CAN_SPAM_FOOTER`

## Test Scope

- Backend unit test: call `_build_share_email()` with both first-touch and returning variants, verify:
  - Output contains light background (#ffffff)
  - Output contains CTA with #6d28d9
  - First-touch includes "No account needed" text
  - Returning-user omits trust lines
  - Preheader div is present
  - color-scheme meta tag present
