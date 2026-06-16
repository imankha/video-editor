# Lifecycle Onboarding Emails

**Status:** TODO
**Started:** (not started)

## Goal

Email every user at **day 7, 14, and 30** since signup. Each email has three jobs:

0. **Thank them** for checking us out.
1. **Help them along** — contextual to where they actually are in the funnel (read from their activity log), to unblock whatever is stopping them.
2. **Beg for feedback** — including an **offer of free credits** in exchange for feedback.

**Replies go directly to imankh@gmail.com** (Resend `reply_to`), so every response lands in Iman's inbox.

The differentiator vs a generic drip campaign: we **personalize from the activity log** to figure out where each user got stuck and how to unblock them.

## Why now

Alpha is about learning. These emails are the primary mechanism to (a) recover stuck users who never got value, and (b) pull qualitative feedback out of the people who did. All infra exists (Resend, email template builder, self-scheduling background loops, activity log, credit grants) — see shared context below.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T3580 | [Lifecycle Email Engine](T3580-lifecycle-email-engine.md) | TODO |
| T3590 | [Day 7/14/30 Content & Personalization](T3590-lifecycle-email-content.md) | TODO |

Order is dependency: T3580 builds the scheduler + dedup table + reply_to + the user-state classifier and calls a render function; T3590 implements the render function (the actual copy per funnel stage + feedback section).

## Shared Context

### Existing infra (verified)
- **Resend sender:** `src/backend/app/services/email.py`. Send functions post JSON (`from`/`to`/`subject`/`html`) to Resend. **No `reply_to` is passed today** — T3580 adds it.
- **Template builder:** `_build_share_email(heading, ..., cta_url, cta_text, footer_reason, is_first_touch, preheader, secondary_cta_url)` in `email.py:33` — light-bg design system (T3200), CAN-SPAM footer (`_CAN_SPAM_FOOTER`), `_html_escape()`. Reuse for lifecycle emails.
- **Scheduler pattern:** `src/backend/app/services/sweep_scheduler.py` (`start_sweep_loop()` / self-scheduling asyncio loop) and `cleanup.py` (`start_cleanup_loop()`, hourly). Started in `main.py` startup hook (~lines 345-350). New lifecycle loop follows this pattern.
- **Signup date:** `user_segments.acquired_at DATE` (Postgres, `pg.py:177`). Day-N = `CURRENT_DATE - acquired_at`. `last_active_at` (`pg.py:182`) for active-vs-dormant.
- **Activity classifier source:** Postgres `user_actions` (aggregate counts per action) and per-user SQLite `user_action_log` (timeline). Action strings in `analytics.py` FLOW_EVENTS: `game_created`, `annotation_completed`, `clip_created`, `framing_opened`, `overlay_exported`/`export_completed`, `share_completed`, `annotations_played`, `gallery_viewed`, `video_downloaded`, etc.
- **Has-games check (owned OR shared):** owned via `user_actions.game_created > 0` (or per-user `working_games`); shared-to-them via `share_games` JOIN `shares` on `recipient_email` where `revoked_at IS NULL` (`pg.py:124`). See T3550 for the same join.
- **Credit grant:** `grant_credits(user_id, amount, source, reference_id)` in `user_db.py:251`; admin endpoint `POST /api/admin/users/{id}/grant-credits` (`admin.py:234`). Use `source="lifecycle_feedback"` for traceability.

### Gaps this epic fills
- Resend `reply_to` support (T3580).
- New Postgres `email_sends` table for send dedup (T3580, migration).
- A user-state/funnel-stage classifier (T3580) consumed by content (T3590).

## Key Decisions (defaults — adjust at architecture review)
- **Day-N basis:** calendar days since `acquired_at` (signup), not "N distinct active days." Standard lifecycle semantics + matches stored data.
- **Audience:** ALL users reaching day 7/14/30 with a valid email and not unsubscribed — including inactive/no-game users (they are the most important to unblock). Respect the existing CAN-SPAM unsubscribe footer.
- **Feedback credits = manual in v1:** email's reply_to is imankh@gmail.com; when a user replies with feedback, Iman grants credits via the existing admin grant-credits tool. No automated redemption codes in v1 (note as future).
- **Credit amount:** placeholder, configurable (e.g. ~15 credits) — confirm at review.
- **Per-interval tone:** same 3-goal structure at all three intervals; tone escalates (day 7 = welcome + gentle help; day 14 = stronger feedback ask + credits; day 30 = last-chance / we-miss-you re-engagement). Confirm at review.

## Completion Criteria
- [ ] Users receive a personalized email at day 7, 14, and 30 since signup
- [ ] Replies route to imankh@gmail.com
- [ ] Content adapts to funnel stage (no games / has games not annotated / annotated not reeled / reeled not shared / power user)
- [ ] No-games users get the "are games being videoed / do you have the file / how to upload / a teammate can upload & share with you" help
- [ ] Each email asks for feedback (clarity of annotate, playback, create/frame/slo-mo/crop reels, spotlight, share) and offers free credits
- [ ] No user receives the same day-N email twice (dedup table)
- [ ] Tests pass
