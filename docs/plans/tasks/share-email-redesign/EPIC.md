# Epic: Share Email Redesign

## Problem

Current share notification emails have critical issues that hurt conversion (recipient clicking the link) and brand trust:

1. **Raw email addresses as sender identity.** Subject line reads "imankh@gmail.com shared clips of test with you" — looks like spam. Recipients see an email address they don't recognize, not a person's name.

2. **Dark background with broken contrast.** Purple CTA (#7c3aed) on dark background (#1f2937) scores 2.58:1 contrast — fails every WCAG level. Text colors blend with background. Gmail/Outlook dark mode applies "double dark" inversion, mangling the layout further.

3. **No distinction between first-touch and returning users.** A parent who's never heard of Reel Ballers gets the same email as someone who uses the app daily. First-touch recipients need trust signals and context; returning users need a streamlined notification.

4. **Generic, robotic copy.** "Check out this soccer highlight from {email}" reads like an auto-generated email. No excitement, no context about why this matters.

## Goal

Emails that a skeptical soccer dad would actually click. Two variants:
- **First-touch:** Overcome spam skepticism. Sender name, game context, "no account needed" trust line. The sender is the hero, not the product.
- **Returning user:** Notification-style. Content-forward subject line, streamlined body, "Open in your gallery" secondary CTA.

## Design System (from expert research)

All emails switch to **light background** (white content, #f9fafb page). This renders predictably across all clients and degrades gracefully under dark mode inversion.

### Color Tokens

| Token | Value | Usage | Contrast on White |
|-------|-------|-------|-------------------|
| Background (page) | #f9fafb | Outer frame | - |
| Background (content) | #ffffff | Card body | - |
| Text (heading) | #111827 | H1, H2 | 17.74:1 AAA |
| Text (body) | #1f2937 | Paragraphs | 14.68:1 AAA |
| Text (secondary) | #4b5563 | Muted/captions | 7.56:1 AAA |
| Text (footer) | #6b7280 | Legal fine print | 4.83:1 AA |
| CTA button bg | #6d28d9 | Buttons, links | 7.10:1 AAA (white text) |
| CTA button hover | #5b21b6 | Hover state | 8.98:1 AAA |
| Brand accent | #7c3aed | Decorative only (accent bar) | NOT for text |
| Divider | #e5e7eb | Horizontal rules | - |

### Typography

```
Font stack: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
H1:     24px / 32px line-height / 700 weight / #111827
Body:   16px / 26px line-height / 400 weight / #1f2937
Small:  14px / 22px line-height / 400 weight / #4b5563
Footer: 13px / 20px line-height / 400 weight / #4b5563
Legal:  12px / 18px line-height / 400 weight / #6b7280
```

### Layout

```
Max width:        600px
Content padding:  32px (desktop), 20px (mobile)
Section spacing:  32px vertical
CTA button:       min 200px wide, 50px tall, 6px radius, 16px/700 text
Accent bar:       4px tall, #7c3aed, full width at top of email
```

### Dark Mode Strategy

Start with light background. Include `<meta name="color-scheme" content="light dark">`. Gmail inverts white-to-dark cleanly. Purple CTA at 7.10:1 contrast survives inversion. No @media dark overrides needed (progressive enhancement only).

### Sender Identity

- **From header:** `{SenderFirstName} via Reel Ballers <noreply@reelballers.com>`
- **Subject line:** Use sender's name + game context, not raw email
- **In-email:** Sender name prominently displayed

### Trust Signals (first-touch only)

- "No account needed to watch" below CTA
- One-line explainer: "Reel Ballers helps soccer parents create and share game highlights"
- Sender's name (not email) as the social proof anchor

## Scope

All 4 share email functions in `src/backend/app/services/email.py`:
- `send_share_email()` — video sharing
- `send_teammate_share_email()` — tagged player clips (screenshot in task description)
- `send_game_share_email()` — full game sharing
- `send_playback_share_email()` — annotated playback sharing

OTP and bug report emails are out of scope (admin-facing, different audience).

## Tasks

| Order | ID | Task | Description |
|-------|------|------|-------------|
| 1 | T3200 | Email Design System | Shared template builder with light-bg design tokens, two template variants (first-touch/returning), updated footer |
| 2 | T3210 | Sender Name + Recipient Detection | Resolve display names from Postgres, detect first-touch vs returning recipients, update function signatures and callers |
| 3 | T3220 | Rewrite Share Email Templates | Apply design system to all 4 email types with first-touch/returning variants, new subject lines, preheader text |

## Completion Criteria

- All 4 share emails use light background with AAA contrast ratios
- Subject lines show sender name, not raw email
- First-touch recipients see trust signals and product explainer
- Returning users see streamlined notification
- Emails render correctly in Gmail, Outlook, Apple Mail (light and dark mode)
- CAN-SPAM compliant footer on all emails
