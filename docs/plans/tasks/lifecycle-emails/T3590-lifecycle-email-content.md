# T3590: Day 7/14/30 Email Content & Personalization

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

T3580 provides the engine (scheduler, dedup, reply_to, `classify_user_state`). This task writes the actual emails: copy that thanks the user, helps them along based on where they're stuck, and asks for feedback with a free-credit offer — personalized from their activity.

See [EPIC.md](EPIC.md) for goals, infra, and key decisions.

## Solution

A render function `render_lifecycle_email(user_state, day_n) -> {subject, html}` that T3580's loop calls. Built on `_build_share_email` / the design-system helpers in `email.py`. Three sections, assembled per user:

### Section 0 — Appreciation (always)
Short, warm thanks for checking out Reel Ballers. Tone escalates by interval (day 7 welcome → day 30 "we'd hate to lose you").

### Section 1 — Help, by `stuck_at` (from `classify_user_state`)
Pick the block matching the user's earliest unreached stage:

- **`no_games`** (no owned or shared games): Ask the diagnostic questions —
  - Are your games being videoed?
  - Do you have access to the video file?
  - Do you know how to upload it?
  - Reassure: *a teammate can add a video and share it with you* if uploading is hard. (Link to upload help + the invite/teammate-share flow.)
- **`not_annotated`** (has games, no `annotation_completed`): Explain annotation is a great way to help their athlete learn from their mistakes — quick how-to + CTA into Annotate.
- **`no_clips`** (annotated but no `clip_created`): Nudge that rating/clipping the best moments is what becomes a reel; CTA to create clips.
- **`not_framed`** (clips but no `framing_opened`): Show framing — trim, animated crop, slo-mo — turns a clip into a polished reel; CTA to framing.
- **`not_exported`** (opened framing but no export): They got close — offer help finishing a reel (this is a real observed drop-off; see Examples). Ask what stopped them.
- **`not_shared`** (exported but no `share_completed`): Encourage sharing the finished reel with family/coach; mention sharing also lets teammates into the loop.
- **`power_user`** (exported + shared): Skip the hand-holding — lead with gratitude, ask for a testimonial/referral, and prioritize the feedback ask.

Use `counts`/timeline for finer touches where cheap (e.g. "you've created 130 clips" for an engaged user, or "you opened framing 6 times" for a not_exported user) — but keep it optional, don't over-fit.

### Section 2 — Feedback ask + free credits (always)
Ask whether it was **obvious how to**: annotate, play back annotations, create reels, frame reels (trim, animated crop, slo-mo), apply the spotlight, and share reels with others — *and if not, what could be clearer?* **Prefer asking about steps the user actually reached** (from `user_state`), so we learn where it was confusing rather than asking about features they never saw. Offer free credits in exchange for a reply. CTA = reply to this email (reply_to is imankh@gmail.com).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/email.py` — `_build_share_email` (line 33), `_CAN_SPAM_FOOTER`, `_html_escape`, `_FONT_STACK`. Add `render_lifecycle_email()` (or a `_build_lifecycle_email` variant) here.
- `src/backend/app/services/lifecycle_emails.py` (from T3580) — calls `render_lifecycle_email`; provides `user_state` from `classify_user_state`.
- App URLs for CTAs (app base URL, Annotate/Framing/My Reels routes, upload help, invite/teammate-share). Match how share emails build `cta_url`.

### Related Tasks
- Depends on T3580 (`classify_user_state`, `reply_to`, scheduler). Builds on T3200/T3220 email design system.
- Feedback-step targeting uses T3470/T3570 events (annotation playback, etc.).

### Technical Notes
- **One template, conditional blocks** — not three separate templates. Day-N only changes appreciation tone + feedback intensity (per EPIC decision); the help block is driven by `stuck_at`, not the day.
- **Plain, parent-friendly copy.** Target audience = engaged soccer parents (see project memory). Avoid jargon; "reel" not "project."
- **Manual credit redemption (v1):** the email promises credits for feedback; granting happens manually when Iman reads the reply (existing admin grant-credits). Don't build redemption codes. State the offer clearly so replies are actionable.
- **Accessibility/deliverability:** reuse the AAA-contrast light-bg system and CAN-SPAM footer already in place; include a preheader.

### Examples (real activity → intended treatment)
- **Stuck at framing→export** (created games, annotated heavily, 13+ clips, `framing_opened` repeatedly, `annotations_played`, quest_1 done, but **no export/share**): `stuck_at = not_exported`. Help block = "you're one step from a finished reel — what stopped you in framing?"; feedback asks about annotate/playback/framing clarity (steps reached), not spotlight/share.
- **Barely started** (one `session_started` + one `annotation_completed`, minimal): early stage; gentle help toward clipping + the value of annotation; light feedback ask.
- **Power user** (full funnel: many clips, multiple `overlay_exported`, `share_completed`, `video_downloaded`, `payment_completed`): `stuck_at = power_user`. Lead with thanks + ask for testimonial/referral + full feedback ask; no onboarding hand-holding.
- **No games at day 7**: `stuck_at = no_games`. Send the videoed/file-access/how-to-upload diagnostic + the "a teammate can upload and share with you" reassurance — even though they're inactive (this is the highest-value unblock).

## Implementation

### Steps
1. [ ] `render_lifecycle_email(user_state, day_n)` returning `{subject, html}` via the design-system builder.
2. [ ] Appreciation section with per-interval tone (7/14/30).
3. [ ] Help section: one block per `stuck_at` value, with correct CTAs/links.
4. [ ] Feedback section: clarity questions scoped to steps reached + free-credit offer + reply CTA.
5. [ ] Wire into T3580's loop + admin preview endpoint; QA all buckets via preview.
6. [ ] Tests: render snapshot per `stuck_at` bucket + per day-N tone; assert no-games block contains the upload/teammate guidance; assert feedback only asks about reached steps.

## Acceptance Criteria
- [ ] Email renders correctly for each `stuck_at` bucket and each interval (7/14/30)
- [ ] `no_games` users get videoed/file-access/how-to-upload questions + teammate-share reassurance
- [ ] `not_annotated` users get the "annotation helps your athlete learn from mistakes" message
- [ ] Power users get gratitude + testimonial/referral + feedback ask, no onboarding nag
- [ ] Feedback section asks about clarity of annotate / playback / create / frame (trim, crop, slo-mo) / spotlight / share, scoped to steps reached, and offers free credits
- [ ] Reply CTA routes to imankh@gmail.com; CAN-SPAM footer + preheader present
- [ ] Tests pass
