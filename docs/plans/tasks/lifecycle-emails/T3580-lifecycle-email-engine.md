# T3580: Lifecycle Email Engine

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-06-16
**Updated:** 2026-06-16

## Problem

We have no mechanism to send time-based lifecycle emails, no way to set a reply-to address, no record of which lifecycle emails a user has received, and no reusable "where is this user in the funnel" classifier. This task builds that plumbing so T3590 can focus purely on copy.

See [EPIC.md](EPIC.md) for goals, shared infra, and key decisions.

## Solution

Four pieces:

1. **Resend `reply_to` support.** Add a `reply_to` parameter to the Resend payload in `email.py` so lifecycle (and optionally other) emails set `reply_to = "imankh@gmail.com"`.
2. **`email_sends` dedup table** (Postgres, migration) — record `(user_id, email_type)` so each day-N email is sent at most once.
3. **Self-scheduling lifecycle loop** — new `lifecycle_emails.py` following the `sweep_scheduler.py` pattern: daily, find users at exactly day 7/14/30 since `acquired_at` who haven't received that email, render (via T3590), send with reply_to, record in `email_sends`.
4. **User funnel-stage classifier** — `classify_user_state(user_id) -> dict` that T3590 consumes to choose copy.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/email.py` — add `reply_to` to the Resend JSON payload (the dict posted to `RESEND_API_URL`). Reuse `_build_share_email` (line 33) / `_CAN_SPAM_FOOTER`.
- `src/backend/app/services/lifecycle_emails.py` — **NEW**. `start_lifecycle_email_loop()` / `_run_lifecycle_loop()` (mirror `sweep_scheduler.py:39,71`), `do_lifecycle_run()` (work fn in `asyncio.to_thread`), `classify_user_state(user_id)`.
- `src/backend/app/main.py` — start the loop in the startup hook alongside `start_sweep_loop()` (~line 345); stop in shutdown.
- `src/backend/app/services/pg.py` — add `email_sends` DDL to `_SCHEMA_DDL` (fresh deploys).
- `src/backend/app/migrations/postgres/v0NN_email_sends.py` — **NEW** versioned migration (Migration agent).
- `src/backend/app/services/user_db.py` / `grant_credits` (line 251) — referenced for the feedback-credit source string (`"lifecycle_feedback"`); actual granting stays manual in v1.
- Activity sources: Postgres `user_actions` (aggregate counts), `share_games`/`shares` (shared-game access, `pg.py:124`), `user_segments.acquired_at` (`pg.py:177`).

### `email_sends` schema
```sql
CREATE TABLE IF NOT EXISTS email_sends (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    email_type TEXT NOT NULL,          -- 'lifecycle_day7' | 'lifecycle_day14' | 'lifecycle_day30'
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, email_type)
);
CREATE INDEX IF NOT EXISTS idx_email_sends_user ON email_sends(user_id);
```
Insert with `ON CONFLICT (user_id, email_type) DO NOTHING` so a crash mid-run can't double-send. (Generic `email_type` leaves room for future non-lifecycle emails.)

### `classify_user_state(user_id)` — funnel stage
Read aggregate counts from `user_actions` (+ shared-game check). Return enough for T3590 to pick copy and the "stuck_at" stage:
```
{
  has_games: bool,             # game_created>0 OR shared-to-them game OR working_games>0
  has_owned_games: bool,
  has_shared_games: bool,
  annotated: bool,             # annotation_completed > 0
  created_clips: bool,         # clip_created > 0
  opened_framing: bool,        # framing_opened > 0
  exported_reel: bool,         # overlay_exported / export_completed > 0
  shared_reel: bool,           # share_completed > 0
  played_annotations: bool,    # annotations_played / annotation_playback_started (T3570) > 0
  is_dormant: bool,            # last_active_at older than ~the email interval
  stuck_at: 'no_games'|'not_annotated'|'no_clips'|'not_framed'|'not_exported'|'not_shared'|'power_user',
  counts: {<action>: int, ...} # raw, for finer personalization
}
```
`stuck_at` = the earliest funnel stage not reached:
`no_games → not_annotated → no_clips → not_framed → not_exported → not_shared → power_user`.

### Related Tasks
- T3590 implements the render function this loop calls.
- Reuses T3550's owned-vs-accessible games join, T3470's tracking, T3570's playback frequency event.
- Migration agent required (new Postgres table).

### Technical Notes
- **Idempotency / safety:** dedup table is the guard; also gate on a valid, non-unsubscribed email. Window the day-N match to a small range (e.g. `acquired_at = CURRENT_DATE - 7`) but rely on the unique constraint for correctness if a day is missed/retried.
- **No reactive persistence concern:** this is a scheduled job, not a UI state side-effect — allowed (it's a real backend gesture: the cron tick). Keep all writes inside the job.
- **Admin manual trigger/test:** add an admin-only endpoint to (a) preview the rendered email for a given user/day-N and (b) force-run for one user, so the content can be QA'd without waiting 7 days. Do NOT bypass the dedup table on real sends.
- **Volume:** alpha-scale; sequential sends with the existing httpx client are fine. Log counts sent per run.
- Follow the migration rules in CLAUDE.md (update `_SCHEMA_DDL` + versioned migration; migrations are triggered manually, not on deploy).

## Implementation

### Steps
1. [ ] `email.py`: add `reply_to` to the Resend payload; thread a `reply_to` arg through the send path used by lifecycle emails.
2. [ ] `pg.py` + migration: `email_sends` table.
3. [ ] `classify_user_state(user_id)` in `lifecycle_emails.py`.
4. [ ] `do_lifecycle_run()`: select day-7/14/30 users not yet sent, render via T3590, send with reply_to=imankh@gmail.com, insert into `email_sends`.
5. [ ] `start_lifecycle_email_loop()` + wire into `main.py` startup/shutdown.
6. [ ] Admin preview + force-send-for-user endpoint (QA).
7. [ ] Tests: classifier buckets (each `stuck_at`), dedup (no double-send), reply_to present in payload, day-N selection.

## Acceptance Criteria
- [ ] Resend payload includes `reply_to: imankh@gmail.com` for lifecycle emails
- [ ] `email_sends` table prevents duplicate day-N sends (unique constraint + ON CONFLICT)
- [ ] Daily loop selects users at day 7/14/30 since `acquired_at` and sends once each
- [ ] `classify_user_state` returns correct `stuck_at` for the funnel-stage fixtures
- [ ] Admin can preview + force-render an email for any user without waiting
- [ ] Migration written; `_SCHEMA_DDL` updated
- [ ] Tests pass
