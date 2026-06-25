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
   - "deploy backend" / "just the backend": `--backend-only`

3. **Launch the deploy in the BACKGROUND** (do not block on it):
   ```bash
   bash scripts/deploy_production.sh [--all | --frontend-only | --backend-only] > /tmp/deploy-output.log 2>&1; echo "DEPLOY_EXIT: $?"
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
   present the recommended-updates table for the user to approve. Do this work concurrently — the only
   thing that waits for the deploy is the *apply* in step 5.

5. **On deploy completion (you'll be notified):**
   - **Exited 0:** reduce_log the output, report what deployed (health/verify ✓), then **apply the
     approved promotions and auto-commit them** (Step E). Approval + a successful deploy IS the
     authorization — do not ask "should I commit?" again.
   - **Failed:** reduce_log the output and report the failure; do **NOT** apply any promotions
     (nothing shipped to prod). Keep the proposal for after a fix + redeploy.

## Post-Deploy: Plan Reconciliation

Goal: keep PLAN.md, EPIC.md, and task files current automatically. A deploy ships work to prod, so it is the natural moment to reconcile what the commits *claim* against what the tasks *specify*, then propose plan updates for the user to approve. **Run this analysis IN PARALLEL with the deploy (don't wait for it to finish); propose, then apply + commit on approval — never edit statuses or files silently** (project rule: the user promotes statuses; this approval gate + a successful deploy is what authorizes the edits, including the auto-commit).

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
| **DONE** | All acceptance criteria met | Promote PLAN/EPIC status TODO→DONE |
| **DONE (diverged)** | Outcome shipped, but differently than the spec | Promote to DONE **and** rewrite the description/spec to match reality; add a design note |
| **PARTIAL** | Some phases shipped, others not | Split the unshipped work into a new task; mark the shipped part done |
| **STATUS-STALE** | Merged earlier but PLAN still says TODO | Promote status only |
| **DROP** | Won't be finished / superseded | Propose deleting the task file + PLAN/EPIC rows |
| **NO CHANGE** | Already accurate | — |

Also flag **collateral staleness** the deploy introduced: task copy/cross-references that other tasks now contradict (e.g. an auto-advance shipping makes another task's "click the card" copy wrong), and **epic completion criteria** that should flip.

### Step D — Present the recommended-updates list for approval

Output a single table the user can approve/reject per row:

```
| Task | Current | Recommended | Why (commit vs criteria) |
|------|---------|-------------|--------------------------|
| T#### | TODO | DONE | commits X,Y satisfy all 3 acceptance criteria |
| T#### | TODO | DONE (diverged) | shipped as <Z> instead of <spec>; rewrite description |
| T#### | TODO | SPLIT | P0 shipped (commit X); P1/P2 unbuilt -> new task |
| T#### | TODO | DROP | superseded by <other>; never built |
```

Use `AskUserQuestion` for genuine judgment calls (done-vs-drop, how to record a divergence, what to keep). For clearly status-stale rows, list them and let the user bulk-approve.

### Step E — Apply approved updates

Only after approval, edit `PLAN.md` / `EPIC.md` / task files:
- Promote statuses; rewrite descriptions to match shipped reality.
- Create split task files; `git rm` dropped task files and remove their rows.
- Fix collateral cross-references and epic completion criteria.
- **Auto-commit the approved promotions** once the deploy has exited 0 (approval + a successful deploy is the authorization — this is the standing default; don't ask "should I commit?" again). Use an ASCII commit message with the co-author line. **Pushing stays the user's call** (push auto-deploys staging), so commit but don't push unless asked.

Keep the reconciliation lightweight when little shipped (a couple of status promotions) and thorough when a milestone/epic landed (verify with subagents, update epic criteria).

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
