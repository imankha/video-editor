---
name: deploy
description: "Deploy to Production"
---

# Deploy to Production

Deploy the app to production using `scripts/deploy_production.sh`.

## When to Apply
- User says "deploy", "push to production", "ship it", or similar
- User wants to deploy frontend-only or backend-only

## Procedure

1. **Pre-check**: Ensure on master, clean tree, up-to-date with origin. If not, tell the user what needs to happen first (commit, push, checkout master, etc.).

2. **Determine scope** from user intent:
   - Default (or "deploy", "push to prod"): `--all` (backend + frontend)
   - "deploy frontend" / "just the frontend": `--frontend-only`
   - "deploy backend" / "just the backend" — **only when the user explicitly asked for a
     backend-only deploy**: `--backend-only --accept-build-drift`. T6220: `--backend-only`
     alone now REFUSES (leaves the server build ahead of the deployed bundle with nothing to
     load — the state T6210 had to defend against); `--accept-build-drift` is the explicit
     confirmation the script requires. Do not add it speculatively — a plain "deploy" intent
     stays `--all`.

3. **Launch the deploy in the BACKGROUND** (do not block on it):
   ```bash
   bash scripts/deploy_production.sh [--all | --frontend-only | --backend-only --accept-build-drift] > /tmp/deploy-output.log 2>&1; echo "DEPLOY_EXIT: $?"
   ```
   Run it with `run_in_background: true` (timeout 600000ms; the harness notifies you when it exits).
   The script handles:
   - Pre-flight checks (branch, clean tree, origin sync)
   - **Secrets sync**: pushes `.env.prod` → Fly.io secrets (except DATABASE_URL, managed by `fly postgres attach`)
   - Backend: `fly deploy` + health check
   - Frontend: `npm run build:production` + `wrangler pages deploy` + site verify
   - Git tagging of successful deploys

4. **Reconcile IN PARALLEL — start immediately; do NOT wait for the deploy to finish.** The commit
   range and code/task state are frozen the moment the deploy starts (the deploy only builds + ships
   commits that already exist), so the analysis is independent and safe to run concurrently. While the
   deploy runs in the background, do Steps A–D of
   [Post-Deploy: Plan Reconciliation](#post-deploy-plan-reconciliation): compute the range with
   `PREV..HEAD` (use HEAD — no need to wait for the new deploy tag), verify each candidate task, and
   determine which tasks' implementation shipped (those auto-promote to DONE) vs. the ambiguous cases
   that still need a quick `AskUserQuestion` (diverged / partial / drop). Do this work concurrently —
   the only thing that waits for the deploy is the *apply* in step 5.

5. **On deploy completion (you'll be notified):**
   - **Exited 0:** reduce_log the output, report what deployed (health/verify ✓), then **auto-promote
     every shipped task to DONE, apply any approved ambiguous-case edits, and auto-commit** (Step E).
     Running `/deploy` is the DONE gesture + a successful deploy IS the authorization — do not ask
     "should I mark these done?" or "should I commit?". **Report the list of auto-promoted tasks** so
     the user can correct any on the board.
   - **Failed:** reduce_log the output and report the failure; do **NOT** apply any promotions
     (nothing shipped to prod). Keep the analysis for after a fix + redeploy.

6. **Post-deploy DATA steps — schema first, then data.** Before running them, read
   [Pending One-Time Steps](#pending-one-time-steps) below. That section is usually empty;
   when it is not, it carries deploy-specific work that the routine steps here do not cover.

   `deploy_production.sh` itself does **not** migrate and does **not** backfill — it only ships code.
   `user_db`/`profile_db` schema migrations then apply themselves just-in-time per account (see
   below); Postgres migration and the poster backfill still need an explicit trigger. Run these in
   order after a successful deploy, and report the result of each:

   **Migration window (T5083/T5085 changed this).** `user_db`/`profile_db` now migrate
   **just-in-time** at the per-user DB-load seam — an account migrates on its own first access
   after the deploy, before any read, so the old "every deploy opens a window where new code runs
   against below-head profile DBs" hazard is closed for the SQLite tracks (the T5970 column guards
   are now belt-and-braces, not the only defense). **Postgres is still deploy-triggered and still
   needs step 6a**, so run it immediately after a green deploy. A per-user migration that cannot
   proceed returns a retryable 503 `pending_migration` rather than silently opening a stale DB.

   **6a. Migrations (schema) — Postgres track.** `POST /api/admin/migrate-postgres` (admin
   session), or the fly-ssh fallback in [migration.md](../../agents/migration.md):
   ```
   fly ssh console -a <app> -C "python -c 'from app.migrations import migrate_postgres; from app.services.pg import init_pg_pool; init_pg_pool(); print(migrate_postgres())'"
   ```
   A clean run reports `{"error": null, ...}` (singular `error`, not the old sweep's `errors: []`
   list). This call is Postgres-only.

   **T5087 deleted the bulk SQLite sweep this endpoint used to also run** (`run_all_migrations`)
   -- there is no admin tool left whose PURPOSE is bulk-migrating `user_db`/`profile_db`; they
   migrate JIT at the per-user seam (T5083/T5085, hardened by T8190) and there is nothing to
   trigger for them post-deploy. That sweep was never actually harmless run as a SEPARATE process
   alongside a live uvicorn: it could reproduce the pre-T8190 seam-reentrancy deadlock shape, and
   it moved R2 forward behind the LIVE process's in-memory version cache, causing a real CAS
   conflict for the next writer (JIT Migration epic's 2026-08-04 incident finding) -- do not
   reintroduce an out-of-process sweep. (Step 6b's poster backfill still walks every profile
   in-process via the JIT primitive it touches -- that's fine, since it never races a separate
   process's stale baseline against itself.)

   To confirm a per-user track landed **in R2**, not just on the machine -- the distinction that
   was the entire T6340 bug -- use the read-only probe against the specific account instead of
   any migrate call:
   ```
   GET /api/admin/migration-status?user_id=<id>   # all_profiles_at_head: true/false, per profile
   ```

   **6b. Poster backfill (data) — ONLY if the deploy shipped poster-selection changes.**
   Existing reels keep whatever poster they already have; nothing heals them automatically.
   ```
   POST /api/admin/backfill-share-posters?dry_run=true            # candidate count first
   POST /api/admin/backfill-share-posters?limit=500&force=true    # backgrounded
   GET  /api/admin/backfill-share-posters                         # poll running/last_result
   ```
   - **`force=true` is required** to move already-postered reels onto the current algorithm.
     Without it the candidate set is usually **0**, because every reel already *has* a poster —
     it is just an old one. (Measured on staging 2026-08-02: 0 candidates without force, 58 with.)
   - **User covers are safe:** `poster_source IN ('overlay','upload')` is *always* skipped
     (`skipped_override`), even under force.
   - Expect some `skipped_gone` (video object reclaimed) and unpublished drafts to be untouched —
     the backfill targets published reels. Neither is a failure.
   - Post-T5410 this is arithmetic + one frame grab per reel — **no Modal, no GPU**.

7. **Post-deploy USER NOTIFICATION.** Once the shipped-task list exists (Plan Reconciliation
   Step A), decide who needs to hear about this deploy. See
   [Post-Deploy: User Notification](#post-deploy-user-notification) below. This step is
   proposal-only until the user explicitly approves a send — never send email as a side effect
   of a deploy completing.

## Pending One-Time Steps

**Read this section on every deploy; it is normally EMPTY, and an empty section costs one
glance.** Rows here are one-shot items that apply to the NEXT deploy only, not standing
procedure. **Execute the row, verify it, then DELETE the row** in the same commit as the
deploy's Plan Reconciliation (Step E). A row that survives a deploy it applied to is a bug
in this file, not a recurring checklist item.

Add a row only when a step is (a) genuinely one-time and (b) would otherwise be forgotten.
Anything that recurs belongs in the numbered Procedure instead.

| Added | Item | Why it cannot wait | Verify | Delete row when |
|-------|------|--------------------|--------|-----------------|
| 2026-09-03 | **Postgres migration v026 (`users.is_test_account`, T8110) has never run on prod.** Step 6a is MANDATORY on the next prod deploy, not "run it if convenient". | Prod `schema_migrations` was at max version **25** on 2026-09-03 while master's admin code already queries `u.is_test_account` (`_test_exclusion`, `admin.py:92`, used by `list_users` and the revenue reconciliation). Deploying that code against a table without the column makes those endpoints 500: the admin user list and the reconciliation panel both go dark until 6a runs. Prod is safe only because `deploy/backend/2026-09-01` predates T8110. **Already proven on staging 2026-09-03:** staging had auto-deployed the T8110 code while its DB sat at v25, so its admin panel was broken until 6a was run there; the run applied v026 cleanly (`current_version: 26, error: None`). | After 6a, confirm `GET /api/admin/users` returns 200 and the Revenue Reconciliation panel loads. A clean 6a run reports `{"error": null, ...}`. | Both verified on prod |
| 2026-09-05 | **T8660 Stripe `receipt_email`: make one real purchase on prod after this deploy and confirm the receipt email arrives.** Buy any credit pack (e.g. Starter, $3.99) with a real card on production, using an account whose email you can check. | Stripe only sends a receipt-on-capture in **live mode** — test-mode purchases (dev/staging, where this was built and code-reviewed) never trigger the send, so this is the ONLY environment where the actual email-delivery half of the task can be confirmed. It's the last open item on [T8660](../../../docs/plans/tasks/revenue-integrity/T8660-stripe-receipt-email.md) — the code path and the account's statement descriptor (`REELBALLERS`) are already verified. | (1) A receipt email actually lands in the buyer's inbox within a few minutes of the purchase. (2) In the Stripe dashboard (live mode), open that PaymentIntent and confirm `receipt_email` is set to the buyer's account email. | Both verified — check the two boxes in T8660's Acceptance Criteria and flip its status; or file a bug if the email never arrives. |

## Post-Deploy: Plan Reconciliation

Goal: keep PLAN.md, EPIC.md, and task files current automatically. A deploy ships work to prod, so it is the natural moment to reconcile what the commits *claim* against what the tasks *specify*.

**Running `/deploy` IS the user's DONE gesture.** Every task whose *implementation* shipped in this deploy is auto-promoted to DONE on a successful deploy — no per-task approval. This is the standing default; it replaces the old propose-and-approve gate for plain DONE promotions. The user can move any row back on the task board if a promotion was wrong, so always **report the list of what was auto-promoted**.

The only cases that still need an `AskUserQuestion` (because they are judgment calls, not plain DONE) are **DONE (diverged)**, **PARTIAL/SPLIT**, and **DROP** — see Step D. And a task that was merely *added* in this range (a `docs(plan): add T#### task` commit with no implementation) is NOT shipped work — never auto-promote it.

**Run this analysis IN PARALLEL with the deploy (don't wait for it to finish); apply + commit on a successful deploy.**

### Step A — Find what shipped in this deploy

The deploy script tags each deploy (e.g. `deploy/frontend/2026-04-20`, `deploy/backend/...`). The reconciliation range is **previous deploy tag → the tag just created** (or `HEAD` if untagged yet).

```bash
# Most recent deploy tags, newest first
git tag --list 'deploy/*' --sort=-creatordate | head -5
# Commits in this deploy (replace PREV with the prior deploy tag)
git log --oneline PREV..HEAD
```

Extract every task ID (`T\d+`) referenced in those commit messages. These are the candidate finished tasks.

### Step B — Compare commit text against each task's spec ("task test")

For each candidate task ID:

1. Read the task file (`docs/plans/tasks/**/T{id}*.md`) — focus on its **Acceptance Criteria** and **Solution/phases**.
2. Read its current row in `docs/plans/PLAN.md` (status + description) and any owning `EPIC.md` row.
3. Compare the **commit messages** (the "comment text") for that task against the **acceptance criteria** (the "task test"). Ask: do the commits actually satisfy every criterion, or only some phases?

**Verify against code for anything non-trivial.** Commit messages overclaim. For multi-phase tasks, redesigned features, or anything where the commit text is ambiguous, spawn `Explore` subagents (one per task, in parallel) to check the real code state — this is what caught "P0 done but P1/P2 not" and "shipped differently than the spec" in past reconciliations. Skip verification only for small, unambiguous, single-commit tasks.

### Step C — Classify each task

| Classification | Meaning | Recommended update |
|----------------|---------|--------------------|
| **DONE** | All acceptance criteria met | Promote PLAN/EPIC status (usually STAGING, sometimes TODO/WIP) → DONE |
| **DONE (diverged)** | Outcome shipped, but differently than the spec | Promote to DONE **and** rewrite the description/spec to match reality; add a design note |
| **PARTIAL** | Some phases shipped, others not | Split the unshipped work into a new task; mark the shipped part done |
| **STATUS-STALE** | Merged earlier but PLAN still says TODO | Promote status only |
| **DROP** | Won't be finished / superseded | Propose deleting the task file + PLAN/EPIC rows |
| **NO CHANGE** | Already accurate | — |

Also flag **collateral staleness** the deploy introduced: task copy/cross-references that other tasks now contradict (e.g. an auto-advance shipping makes another task's "click the card" copy wrong), and **epic completion criteria** that should flip.

### Step D — Auto-promote shipped tasks; ask only on ambiguity

Split the candidates into two buckets:

- **Auto-DONE (no approval):** `DONE` and `STATUS-STALE` rows — tasks whose implementation shipped in this range. Promote these to DONE automatically. Exclude `NO CHANGE` rows (already accurate) and any task merely *added* in this range (no implementation commit).
- **Ask first (`AskUserQuestion`):** only the genuine judgment calls — `DONE (diverged)` (how to record the divergence), `PARTIAL/SPLIT` (what to carve into a new task), `DROP` (done-vs-keep). These are not plain DONE, so the deploy gesture does not auto-decide them.

Always output a table of what shipped, marking which rows auto-promote vs. which are being asked:

```
| Task | Current | Action | Why (commit vs criteria) |
|------|---------|--------|--------------------------|
| T#### | TODO | DONE (auto) | commits X,Y satisfy all 3 acceptance criteria |
| T#### | TODO | DONE (auto, stale) | merged earlier, PLAN still said TODO |
| T#### | TODO | ASK: diverged | shipped as <Z> instead of <spec>; rewrite description |
| T#### | TODO | ASK: split | P0 shipped (commit X); P1/P2 unbuilt -> new task |
| T#### | TODO | NO CHANGE | only added as a task this range; not implemented |
```

### Step E — Apply updates

On a successful deploy (exited 0):
- **Promote all Auto-DONE rows to DONE** (prefix the description with `DONE (deployed {date} prod).`) — no approval needed.
- **Move every promoted row OUT of PLAN.md into `docs/plans/PLAN-archive.md`** (user rule 2026-08-03: PLAN.md holds only live work). Place the row verbatim under the archive heading `## {PLAN.md section} — {subsection}` it came from — create the heading and copy the table's header/separator rows if that group doesn't exist yet. Same move applies to EPIC-row promotions. If a PLAN.md section is left with a header and no data rows, replace the empty table with: `*All tasks in this section are complete — rows archived to [PLAN-archive.md](PLAN-archive.md).*`
- For the Ask-first rows, apply whatever the user chose: rewrite diverged descriptions + add a design note; create split task files; `git rm` dropped task files and remove their rows.
- Fix collateral cross-references and epic completion criteria.
- **Auto-commit** all of the above once the deploy has exited 0 (the deploy gesture + a successful deploy is the authorization — don't ask "should I commit?"). Use an ASCII commit message with the co-author line. **Pushing stays the user's call** (push auto-deploys staging), so commit but don't push unless asked.
- **Report the auto-promoted list** to the user so they can move any row back on the board if a promotion was wrong.

Keep the reconciliation lightweight when little shipped (a couple of status promotions) and thorough when a milestone/epic landed (verify with subagents, update epic criteria).

## Post-Deploy: User Notification

Goal: when a deploy fixes something a user hit, or ships something a user would want, tell them — instead of hoping they notice. Uses the same shipped-task list as Plan Reconciliation Step A, so run this after that classification exists.

**Hard gate: proposal only, never auto-send.** Sending real email to real users is exactly the kind of hard-to-reverse, externally-visible action the project's execution-care rules flag for confirmation every time — there is no "obviously safe, skip the ask" case here, matching the standing HARD SEND GATE precedent on outreach work (e.g. T7610). Draft, show the user segments + copy as a decision artifact, and wait for explicit approval before any send.

### Step A — Classify each shipped task by notification type

For every task in this deploy's shipped list:

| Type | Trigger | Notification goal |
|------|---------|--------------------|
| **BUG-FIX** | Task closed a `bug_reports` row, or its description names a concrete broken behavior | Tell the users who hit it that it's fixed; ask them to retest |
| **DROP-OFF-FIX** | Task fixed a funnel cliff/abandonment point (activation-cliff work, First-Clip Funnel-style tasks) | Tell the users who fell off at that point specifically; invite them back to the exact step |
| **NEW-FEATURE** | Task shipped a new user-facing capability, not a fix | Tell the segment likely to want it |
| **NO-NOTIFY** | Internal/infra/perf/refactor/admin-only, no user-visible change | Nothing to send |

When a task is ambiguous, read its task file's Acceptance Criteria — the same read Plan Reconciliation Step B already does — rather than guessing from the PLAN.md one-liner.

### Step B — Identify who to notify

**BUG-FIX / DROP-OFF-FIX:** find the users who actually encountered it, not everyone:
- Per-user event-grain data lives in each user's own `user_action_log` SQLite (not the shared aggregate stores) — query it for the specific action/error the task's acceptance criteria describe.
- Cross-reference Postgres `user_segments`/`user_actions`/`user_usage_daily` for funnel position and last-active date, same query pattern as the win-back campaign (`fly postgres connect -a reel-ballers-db-prod -d reel_ballers_api`, read-only).
- For per-profile specifics (which game/clip/step), use the `fly ssh console` + `app.database.get_db_connection()` pattern with `user_context`/`profile_context` set, as in the win-back send.
- **Dedup** against anyone already notified for this exact issue (check the task file / prior outreach notes — e.g. T7610's cohort tracking) so retest asks don't repeat.

**NEW-FEATURE:** find the segment likely to care, not the whole user base — infer from what the feature touches (e.g. a Focus-mode feature → users who've used Focus; a Collections feature → active reel creators) using the same segmentation approach as the win-back campaign, not a blanket send.

### Step C — Draft copy

- **Bug-fix / drop-off-fix copy** asks for a retest and states plainly what was broken and that it's fixed now. Apply the existing support-framing rule: lead with "we're here to help" energy, not just a status update — e.g. invite a reply if the retest still doesn't work, don't just declare victory.
- **New-feature copy** introduces the feature and why it's relevant to that segment specifically (not generic marketing copy).
- One draft per segment/task, not one blast for everything that shipped.

### Step D — Approve, test-send, send

1. Present segments + draft copy to the user as a decision artifact (recipients, task each maps to, draft text) and get explicit approval — this is the hard gate, not a formality.
2. **Test-send to imankh@gmail.com first**, always, before any real recipient.
3. Send via `app.services.email.send_admin_update_email` (the same function the admin bulk-email modal calls) — per-recipient sends, real Resend API.
4. Record what was sent (recipients, task id, date) in the task file or its PLAN row, the way T8170/T7610 log outreach — this is what Step B's dedup check reads next time.

## Secrets Management

Root `.env` files contain most backend env vars per environment.

| File | Environment | Fly.io App |
|------|-------------|------------|
| `.env` | Local dev | (none) |
| `.env.staging` | Staging | reel-ballers-api-staging |
| `.env.prod` | Production | reel-ballers-api |

**Exception — DATABASE_URL has split ownership:**
- **On Fly.io**: managed by `fly postgres attach` (uses `*.flycast:5432` internal DNS). Never pushed by `push-secrets.sh`.
- **In `.env.*` files**: localhost proxy URLs for running scripts locally (requires `fly proxy` running).
- **In `.env` (dev)**: points to local docker-compose Postgres (`localhost:5432`).

To update secrets:
1. Edit the `.env.*` file
2. Run `bash scripts/push-secrets.sh <staging|production>` to push to Fly.io
3. The production deploy script runs this automatically
4. To change DATABASE_URL on Fly, use `fly secrets set` directly (not `.env` files)

Frontend public keys live in `src/frontend/.env.*` files (Vite build-time requirement).
Non-secret config (APP_ENV, CORS_ORIGINS, etc.) lives in `fly.*.toml` `[env]` sections.

## If the script fails

- **Pre-flight failure**: Tell the user what to fix (wrong branch, dirty tree, not pushed).
- **Secrets sync failure**: Check `flyctl` auth (`flyctl auth login`).
- **Backend deploy failure**: Check `fly logs` or the Fly.io dashboard.
- **Frontend build failure**: Check the vite build output for errors.
- **Frontend deploy failure**: Check wrangler output. May need `npx wrangler pages deploy dist --project-name reel-ballers-prod --branch main` manually.
- **Health/verify failure**: The deploy went through but the app isn't responding. Check logs.

## Important

- NEVER deploy from a non-master branch
- The script tags each successful deploy (e.g., `deploy/frontend/2026-04-20`)
- If deploy output is too long, use `reduce_log` on `/tmp/deploy-output.log`
