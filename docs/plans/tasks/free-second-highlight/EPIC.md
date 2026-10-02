# Free Second Highlight

**Status:** TODO
**Started:** 2026-10-02 (filed)
**Mockups + original spec:** [Second Highlight Bonus canvas](https://claude.ai/artifact/6DVHn3V3Y16rzEGJBPKg9x)
(proposal **C** is the chosen one; A and B on the canvas are rejected alternatives)

## Goal

Get more users to make a **second highlight**. When a user publishes a highlight, congratulate
them and hand them a **free pass**: their next highlight is free (up to 40 seconds) if they make it
within 24 hours. The total free value stays at 88. To pay for the pass, the signup grant drops from
88 to 48 credits.

North-star metric: the share of users granted a pass who redeem it, measured against the 24h/7d
second-export baseline from T11610. Guardrails: the 7-day second-export rate (to catch
pull-forward only), the signup-to-first-export rate (the signup grant shrinks), and credit
purchases.

## Why this design (user decisions 2026-10-02)

- **Proposal C was chosen over A (two-step credits) and B (reserved bonus).** "Your next highlight
  is free" needs no credit math, and parents don't think in credits.
- **Total budget is 88:** 48 at signup (8 `NEW_ACCOUNT_CREDITS` + 40 `WELCOME_CREDITS`) plus a pass
  worth up to 40 credits.
- **This supersedes ruling G1** of the [quest-removal epic](../quest-removal/EPIC.md) (welcome
  grant frozen at 80). The user approved the change 2026-10-02.
- **Eligibility has the fewest branches possible:** every account gets exactly one pass, on its
  next publish after this ships.
  - There is no cohort gate and no "is this really their first publish" check.
  - Existing users (who already got 88) get one too. The user accepted that extra cost on purpose,
    to avoid writing code for a minority.
  - Because existing users qualify, UI copy never says "first highlight". It says "Your highlight
    is live!".
- **The landing page is updated** to the honest new offer (T11650).
- **The reminder email goes through the existing Resend integration** (`services/email.py`), as a
  scheduled send. We build no email provider and no scheduler.

## Design decisions (shared by all tasks)

1. **Pass state is one Postgres row per user:** table `free_highlight_passes`. The primary key on
   `user_id` is what enforces "one pass per account, ever".
   - It lives in Postgres because credits do (T5840) and a pass belongs to the user, not to one
     profile.
   - It can't be a ledger row: `credit_transactions` has `CHECK (amount <> 0)`, and nothing is
     granted at publish time.
   - Columns (exact definitions in T11620):

     | Column | Type |
     |---|---|
     | `user_id` | TEXT PK |
     | `granted_at` | TIMESTAMPTZ NOT NULL DEFAULT now() |
     | `expires_at` | TIMESTAMPTZ NOT NULL |
     | `trigger_final_video_id` | TEXT |
     | `used_at` | TIMESTAMPTZ NULL |
     | `used_reference_id` | TEXT NULL |
     | `credits_covered` | INTEGER NULL |
     | `reminder_email_id` | TEXT NULL |

2. **Granted by the publish gesture:** `POST /api/downloads/publish/{project_id}`
   (`publish_to_my_reels`, `routers/downloads.py:2102`).
   - It runs `INSERT ... ON CONFLICT (user_id) DO NOTHING`. A conflict means the user already had a
     pass, so nothing happens.
   - The publish response carries the pass only when this call created it, which is how the
     celebration sheet shows exactly once.
   - Gesture-traced, never reactive.
3. **Redeemed at credit reservation.** The pass applies at the two places an export reserves
   credits:
   - `routers/export/framing.py:324-329` (single clip)
   - `routers/export/multi_clip.py:2162-2168` (multi-clip)

   Redemption runs before `reserve_credits`, in ONE Postgres transaction:
   - Mark the pass used, where `used_at IS NULL AND expires_at > now()`.
   - Grant `LEAST(cost, 40)` credits under a new ledger source `free_highlight_pass` (key
     `free_pass:{user_id}`).

   Then the normal reservation charges the full cost, so the net charge is `cost - covered`.
   - The reservation path itself does not change.
   - If the export later fails, the reservation is refunded as usual and the user keeps the covered
     credits as balance. The pass is spent and its value was delivered, so there is no special case.
   - Overlay renders (free), uploads and storage extensions never redeem the pass.
4. **Constants** go in `services/storage_credits.py`, next to the signup grant:
   - `FREE_PASS_MAX_CREDITS = 40`
   - `FREE_PASS_WINDOW_HOURS = 24`
   - `FREE_PASS_REMINDER_AFTER_HOURS = 19` (the email lands with 5 hours left)
5. **Read path:** `GET /api/credits` gains `free_pass: {expires_at, max_credits} | null`. It is
   non-null only while the pass is unused and unexpired. The frontend reads pass state only from
   here and from the publish response, and never stores it anywhere else.
6. **Email:**
   - When the pass is granted, schedule a Resend email for `granted_at + 19h` and store its id in
     `reminder_email_id`.
   - When the pass is redeemed, cancel that email (best-effort, logged).
   - Skip scheduling when the user has `notification_email_optout` set.
   - An email failure never fails a publish or an export.
7. **Measurement comes from the table itself.** Granted = rows; redeemed = `used_at` set; expired =
   unused rows past `expires_at`; reminders = `reminder_email_id` set. We add no separate analytics
   state.

## Tasks (dependency order; implement top to bottom)

| ID | Task | Status |
|----|------|--------|
| T11610 | [Baseline: second-export rate + credits spent before first export](T11610-baseline-second-export-metrics.md) | TODO |
| T11620 | [Backend: free highlight pass (table, grant on publish, redeem on export)](T11620-free-pass-backend.md) | TODO |
| T11630 | [Frontend: pass celebration sheet, "Free" export price, Home banner](T11630-free-pass-frontend.md) | TODO |
| T11640 | [Reminder email: Resend scheduled send + cancel + unsubscribe](T11640-free-pass-reminder-email.md) | TODO |
| T11650 | [Signup 88 -> 48 + landing page copy (ships LAST)](T11650-signup-split-and-landing-copy.md) | TODO |

**Release order matters.** T11650 lowers the signup grant, so it must not reach prod before
T11620 + T11630. Otherwise users get 48 credits with no pass to make up the difference. Merge
T11650 last. The landing site deploys separately (`/deploy-landing`), and that deploy goes out
right after the prod deploy that contains T11650.

## Completion Criteria

- [ ] T11610 baseline numbers recorded in its task file before T11650 merges
- [ ] A new account gets 48 credits, publishes, sees the pass sheet, and its next export is free
      (up to 40 s); end to end on staging
- [ ] The 5-hours-left email arrives when the pass is unused and is cancelled when it is redeemed
- [ ] reelballers.com shows the new offer in the same window as the prod deploy
- [ ] Knowledge docs updated: `backend-services.md` (new table + ledger source) and
      `export-pipeline.md` (redemption at reserve)
