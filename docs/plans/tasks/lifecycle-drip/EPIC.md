# Lifecycle Email Drip (Activity-Aware Onboarding Emails)

**Status:** TODO (design gate: user approval of this EPIC before T7230 starts)
**Started:** —
**Filed:** 2026-08-19
**Placement:** For Alpha - Polish (user decision 2026-08-19 — resolves the sequencing open
item; not queued behind Milestone TOP)

## Goal

Every new signup gets an email at **day 1, 3, 7, and 14 after signup** — but never a static
blast. At send time the system reads the user's actual activity (`user_actions` funnel data,
same model the admin panel and the 2026-08 manual win-back campaign used), determines where
they stalled in Annotate → Framing → Overlay → Publish, and sends the email written for
**that stage on that day**, pointing at the tutorial video for their next step. Copy lives in
a Postgres table, editable live from the admin panel — changing an email never requires a
deploy.

This automates what the founder did by hand on 2026-08-18/19 (8 users, individually
segmented and emailed via `send_admin_update_email`). That campaign is the design basis:
same stage buckets, same tutorial links, same support-first tone.

## Origin / Basis

- **Manual win-back campaign 2026-08-18/19** — segments, copy tone, and send mechanics
  proven by hand. See memory `project_winback_campaign_2026_08` and the
  [Win-Back Segments artifact](https://claude.ai/code/artifact/c93e41d1-a59a-4688-b279-7b50f1c8ae11).
- **Support framing rule** (user, 2026-08-19): every email leads with *"we're here to help —
  reply and tell us exactly where you got stuck"*, not just a tutorial link. Non-negotiable
  content rule for all seeds and future edits.
- **Live example the epic exists for**: cschwartz78@gmail.com signed up, uploaded one game,
  annotated zero plays, went quiet — an automated day-1 email with the Annotate tutorial is
  exactly the intervention that was instead done manually.

## Design Decisions (binding for all tasks)

### 1. Signup anchor and send windows

- Anchor = `users.created_at` (timestamptz, exact). NOT `user_segments.acquired_at` (a DATE —
  day-granular, and NULL for test-login/copied accounts per the T4970 LEFT-JOIN lesson).
- Step N (offsets 1, 3, 7, 14 days) is **due** at `created_at + N days` and **expires** at
  `created_at + N days + 48h`. A step whose window has fully passed is **skipped forever**
  (recorded as `skipped`, never sent late). Consequences, both deliberate:
  - Users who signed up before the feature ships get **no catch-up blast**.
  - Extended downtime never causes a pile of stale drips on restart.

### 2. Stage model (computed at send time, stored nowhere)

Stage is derived from `user_actions` at the moment of send — **never persisted** (project
no-redundant-state rule). Mapping from highest funnel step reached:

| Stage key | Condition (highest step) | Next-step tutorial | Email intent |
|---|---|---|---|
| `not_uploaded` | no `game_created` | annotate.mp4 | Get the first game in |
| `uploaded` | `game_created`, no `clip_created`/`annotation_completed` | annotate.mp4 | Mark the first play |
| `clipped` | `clip_created` or `annotation_completed`, no `framing_exported` | framing.mp4 | Finish framing |
| `framed` | `framing_exported`, no `overlay_exported` | overlay.mp4 | Add highlights |
| `overlaid` | `overlay_exported`, no `export_completed` | publish.mp4 | Export the reel |
| `exported` | `export_completed`, no `share_completed` | — | Download/share nudge |
| `completed` | `share_completed` | — | Referral nudge (rows may be disabled) |

Tutorial URLs: `https://assets.reelballers.com/tutorials/{quest}.mp4` (truth =
`contract.py`, see memory `reference_tutorial_assets_contract`; reshot in T5140, deployed
2026-08-17).

### 3. Storage: ZERO new Postgres fields/rows (user directive 2026-08-19)

**Postgres is the most expensive part of the stack — this epic adds nothing to it.** The
tick only READS existing tables (`users`, `user_actions`, `user_segments`). Drip state is
partitioned **by writer**, because that's what makes SQLite safe here: a SQLite file shared
across machines is the clobber class T1960 moved auth/sharing OUT of SQLite to escape, so
each store lives where its writer runs.

| Store | Writer | Where it lives |
|---|---|---|
| Send log / claims | tick process ONLY | `drip.sqlite` — dedicated SQLite file, R2-persisted at `drip/drip.sqlite` |
| Templates | admin panel (app servers, rare) | R2 JSON doc `drip/templates.json`, etag If-Match CAS on write |
| Unsubscribes | public endpoint (any app server, any time) | R2 marker objects `drip/unsubscribed/{user_id}` — PUT-only, idempotent, existence = suppressed; distinct keys never conflict, so app servers write them with zero race |

Templates + unsubscribes go to R2 objects rather than into the tick's SQLite precisely
because their writers are app servers — folding them into `drip.sqlite` would recreate the
multi-machine write race. The admin send-log VIEW reads a downloaded copy of
`drip/drip.sqlite` (read-only, precedent: `share_view_counts` reads per-user SQLite
server-side); it never opens the tick's live file.

Templates: 28 entries keyed `"{day}:{stage}"` → `{subject, body, enabled, updated_at}`.
Plain text bodies in the exact format `body_text_to_html()` already accepts (blank line =
paragraph), plus whitelisted variables (`{{game_name}}`, `{{clip_count}}`). Seeded by a
checked-in seed file uploaded once; edited live via the admin panel (T7270). `enabled:
false` = that cell sends nothing. Rendering **fails loudly** on an unresolvable variable
(send recorded as `failed`, CRITICAL log) — never sends literal `{{game_name}}`, never
silently substitutes. Seed copy only uses variables its stage guarantees.

### 4. Idempotency: single writer + claim-before-send

`drip.sqlite` has `drip_sends UNIQUE(user_id, drip_day)`, and the tick process is its ONLY
writer — "only 1 tick user" is made structurally true: the scheduled machine is the sole
place sends execute (manual run = starting that same machine, §5), and Fly does not
double-start a machine, so there are never two writers.

At-most-once across crashes comes from **upload ordering**: download `drip.sqlite` → write
ALL claims for this run locally → **upload to R2 (CAS)** → send emails → record
sent/failed → final upload. Claims are durable in R2 BEFORE the first email leaves, so a
crash mid-run can never double-send on the next run; it leaves `claimed`-never-sent rows
that surface in the admin log for a deliberate decision. A `failed` send keeps its claim
(no auto-retry blast) — retry is an admin gesture, never automatic.

### 5. Tick: a Fly **scheduled machine**, NOT an in-process loop

**(Revised 2026-08-19 after user review — the original draft used an in-process asyncio
loop like `sweep_scheduler.py`; rejected for the reasons below.)**

The tick is a separate one-shot Fly machine in the same app:

```
fly machine run <current-image> --schedule daily -a reel-ballers-api \
  --vm-memory 512 "python -m app.drip_tick"
```

`app/drip_tick.py` is a tiny entrypoint: check `DRIP_EMAILS_ENABLED` (exit 0 with one log
line if unset — the kill switch), call `run_drip_tick()`, exit. Daily cadence is sufficient:
48h windows guarantee every step is evaluated at least once while due.

Why this beats the alternatives:
- **In-process loop (rejected):** the app fleet runs `auto_stop_machines = "suspend"` +
  `auto_start`, so a machine's timers only fire while traffic keeps it awake — the sweep
  works around this with a keepalive ping that defeats suspend (cost + fighting the
  platform). With several app servers it also runs N redundant ticks, and it shares CPU/RAM
  with request serving on a 1-vCPU box that has already been OOM-killed once (T7090).
  Isolation requirement: a drip bug must not be able to take down an app server.
- **Cloudflare Worker cron → admin endpoint (runner-up):** exact cron and zero image drift,
  but the work still executes ON an app server (isolation only as strong as one HTTP
  request), and it adds a second platform holding a shared secret. Kept as a documented
  fallback; the admin endpoint it would call already exists for manual/dry-run.
- **Scheduled machine (chosen):** own process/memory — cannot take down an app server; a
  crash affects only that run and the next schedule retries; exactly ONE runner regardless
  of app-fleet size; same image/secrets as the app (no cross-platform secret sharing);
  billed only for seconds of runtime; no keepalive hacks.

Operational note (goes in T7260 + the deploy skill): a machine created via `fly machine
run` is NOT updated by `fly deploy` — `deploy_production.sh` gains a
`fly machine update <id> --image <new-ref>` step so the tick never runs stale code. Windows
are 48h, so scheduled-run timing slop (Fly schedules relative to machine creation, not
cron-exact) is harmless.

**Manual live run = `fly machine start <tick-machine-id>`** (start the scheduled machine
early). Same machine ⇒ Fly won't double-start it ⇒ the single-writer guarantee (§4) holds
for manual runs too. The admin endpoint is **dry-run only** (read-only plan preview on an
app server); there is deliberately NO app-server code path that executes sends — that would
add a second writer to `drip.sqlite`.

`RESEND_API_KEY` unset = dev log-only sends (existing `send_admin_update_email`
convention). NOT folded into the sweep (expiry-event-driven vs calendar-driven; different
failure domains — and the sweep runs heavy video work in-process, which is precisely what
the drip tick must not sit behind).

### 6. Suppression (checked before claim)

Skip a user when ANY of: unsubscribed (R2 marker `drip/unsubscribed/{user_id}` exists —
the tick lists the prefix into a set once per run); `is_admin`;
email in `DRIP_SUPPRESSED_EMAILS` (comma-separated env, seeded with the win-back campaign's
team/tester exclusions: imankh@gmail.com, iman@launchitlabs.io, hello@reelballers.com,
arshia.kalantari@gmail.com, sarkarati@gmail.com); email matches test patterns
(`*@test.local`, `*@e2e.local`); template row for (day, stage) disabled or absent.

### 7. Compliance

Lifecycle emails are marketing mail: every drip email carries a working **one-click
unsubscribe link** (HMAC-tokened public endpoint, no login required) and the CAN-SPAM
footer. **OPEN ITEM (owner):** a physical mailing address is legally required in the footer —
the current shared email shell has none. T7250 blocks on the user providing the address
string. Transactional email (OTP, share notifications) is out of scope and untouched.

### 8. Content rules (apply to seeds AND all future admin edits)

- Lead with outcome + support: "reply and tell us where you got stuck — we'll walk you
  through it or fix it" appears in **every** template (memory
  `feedback_winback_email_support_framing`).
- One CTA per email: the stage's tutorial link or the app link — never a link farm.
- Same day, different stage = different email; same stage, later day = different angle
  (day 1 helpful nudge → day 3 value prop → day 7 direct "what blocked you?" ask → day 14
  last touch). Tone matrix + drafted examples in T7230.
- Sender: `Reel Ballers <hello@reelballers.com>` (`ADMIN_FROM_ADDRESS`, unchanged).

### 9. What this epic deliberately does NOT do

- No open/click tracking (Resend webhooks) — measure via funnel progression in existing
  analytics; revisit only if needed.
- No A/B testing machinery.
- No changes to the manual `BulkEmailModal` flow (stays for ad-hoc sends).
- No emails past day 14 (win-back beyond onboarding stays manual/judgment for now).

## Tasks (strict order — each depends on the prior)

| ID | Task | Status |
|----|------|--------|
| T7230 | [Drip stores + seed copy (drip.sqlite, R2 templates doc, unsubscribe markers)](T7230-drip-schema-templates.md) | TODO |
| T7240 | [Stage resolver + template selection/render engine](T7240-stage-resolver-selection-engine.md) | TODO |
| T7250 | [Unsubscribe endpoint + compliance footer](T7250-unsubscribe-compliance.md) | TODO |
| T7260 | [Drip scheduler + idempotent send pipeline + admin dry-run](T7260-drip-scheduler-send-pipeline.md) | TODO |
| T7270 | [Admin panel: template editor + send log](T7270-admin-template-editor.md) | TODO |

## Rollout sequence

1. T7230–T7260 land → staging: `DRIP_EMAILS_ENABLED` unset (loop off), verify via admin
   `dry_run` endpoint that the plan is correct against staging's seeded users.
2. Test-sends of every enabled template to the admin's own inbox (T7270's per-template
   test button; interim: the endpoint from T7260).
3. User reviews/edits seed copy in the admin editor; provides the physical mailing address.
4. Enable on staging briefly (its user base is test accounts — all suppressed; proves the
   loop runs clean). Then enable on prod.

## Completion Criteria

- [ ] A brand-new prod signup who stalls receives stage-appropriate emails at day 1/3/7/14,
      each recorded in `drip_sends`, none duplicated (claim proven by test + staging run)
- [ ] A user who progresses between steps gets the email for their NEW stage
- [ ] A user who completes + shares receives nothing further once `completed` rows are disabled
- [ ] Unsubscribe link works logged-out, and a suppressed/unsubscribed user is provably skipped
- [ ] Founder edits a template in the admin panel and the next send uses the new copy — no deploy
- [ ] Missed windows are skipped, never sent late (test: user created 20 days ago gets nothing)
- [ ] Physical mailing address present in the footer (user-provided)
- [ ] ZERO new Postgres fields/rows (user directive 2026-08-19) — grep-provable: no migration
      file, no `_SCHEMA_DDL` change; drip state lives in `drip.sqlite` + R2 objects only
