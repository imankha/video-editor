# T4090 (P1): Empower /dotask container workers to run the full live app + Playwright verification

**Status:** TODO
**Priority:** P1
**Impact:** 8
**Complexity:** 4
**Created:** 2026-06-28

## Problem
A /dotask container worker (running `claude -p` INSIDE the container) currently **cannot self-verify
in the live app** — it can write code + unit tests but not drive the running app with Playwright as a
real user. This forces the supervisor to do the live verification (e.g. T4080's e2e was run by the
supervisor against the host app, not by the worker). The user wants workers empowered to do everything
the supervisor can.

## Root cause (confirmed on T4080)
- The container's copied `.env` has `DATABASE_URL=…@localhost:5432` (the HOST's dev Docker Postgres).
  Inside the container, `localhost` is the container, so the backend can't reach Postgres → `dev-login`
  (and any DB-backed request) fails.
- The working start path, `.devcontainer/container-stack.sh`, DOES rewrite the DB host to
  `host.docker.internal` — but it's invoked by the SUPERVISOR via `bash scripts/task.sh stack <id>` /
  `task.sh test <id>` (host-side commands). The in-container worker can't run `task.sh`, and the
  `drive-app-as-user` skill didn't tell it to start the stack via `container-stack.sh` directly. So the
  worker booted uvicorn with the raw `localhost` `.env` and failed.

## Goal
Inside a /dotask container, a worker can run a single documented command to: start the app stack with a
DB host that actually resolves (host.docker.internal), authenticate as a real user (dev-login), run a
Playwright spec against it, and read the result — i.e. the full "drive-app-as-user" loop the supervisor
runs, no supervisor needed.

## Approach (implement + verify end-to-end)
1. **Make the in-container DB host correct without ceremony.** Either (a) at `task.sh up`, rewrite the
   container `.env` `DATABASE_URL` host `localhost`→`host.docker.internal` (so a plain in-container
   `uvicorn` works), or (b) provide an in-container script the worker runs that applies the same
   rewrite `container-stack.sh` already does. Keep host scripts' `.env` (localhost) semantics intact —
   only the container copy changes.
2. **One in-container verify command.** Add `scripts/dev-verify.sh <playwright-spec>` (runnable INSIDE
   the container by the worker) that: starts backend+frontend via `.devcontainer/container-stack.sh`
   (correct DB), waits for `/api/health` + the frontend, then runs
   `npx playwright test <spec> --reporter=line` (dev-login via `e2e/helpers/realAuth.js`), and prints
   the result. Idempotent if the stack is already up.
3. **Verify the host->container DB path actually works.** Confirm the host's dev Docker Postgres is
   reachable from the container at `host.docker.internal:5432` (Postgres must listen on the docker
   bridge / 0.0.0.0, not only 127.0.0.1) and that dev R2 (cloud) works. Fix the bind/compose if needed.
4. **Confirm `dev-login` works in-container** (APP_ENV=dev is in the container `.env`; the email must
   exist in the env's Postgres — document copying an account down with `copy_user_between_envs.py`).
5. **Update the docs so workers know the recipe (no LLM grokking):**
   - `.claude/skills/drive-app-as-user/SKILL.md` — add a "From inside a /dotask container" section
     with the exact command (`bash scripts/dev-verify.sh e2e/<spec>`), the DB-host note, and the
     dev-login/data prerequisite.
   - `.claude/skills/dotask/SKILL.md` — note that workers should self-verify via this for any change
     that needs the running app, and only fall back to supervisor `task.sh test` if blocked.
   - Memory `reference_drive_app_as_user` — add the in-container entry point.

## Acceptance
- From inside a fresh `/dotask` container, `bash scripts/dev-verify.sh e2e/annotate-soccer-times.spec.js`
  (or similar) starts the stack, authenticates as a real user, runs the spec, and reports pass/fail —
  no supervisor involvement.
- Skills + memory document the exact in-container recipe.
- Host-side `task.sh stack`/`test` and host scripts (with localhost `.env`) still work unchanged.

## Relevant files
- `scripts/task.sh` (up/stack/test; the `.env` copy at ~L84), `.devcontainer/container-stack.sh`
- `src/backend/app/routers/auth.py` (`dev-login`), `src/frontend/e2e/helpers/realAuth.js`
- `.claude/skills/drive-app-as-user/SKILL.md`, `.claude/skills/dotask/SKILL.md`
- Reference: `scripts/copy_user_between_envs.py` (seed a real account into dev)
