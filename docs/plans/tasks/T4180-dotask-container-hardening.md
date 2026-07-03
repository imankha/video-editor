# T4180: /dotask Container Hardening (audit findings + fixes)

**Status:** STAGING
**Impact:** 8
**Complexity:** 3
**Created:** 2026-07-03
**Updated:** 2026-07-03

## Problem

A read-only audit (2026-07-03, agent-run; triggered by worker friction on T4160/T4170) found the
per-task Docker sandboxes were silently degraded — workers wasted turns on every task and some
image fixes never shipped at all. Findings, ranked:

1. **Stale image (critical)**: `task.sh ensure_image` only built when the image was missing, never
   on Dockerfile change — the running `reel-task:latest` predated T4120, so the pytest bake never
   reached workers (both T4160/T4170 workers pip-installed pytest manually).
2. **Backend pytest couldn't reach Postgres**: the `localhost -> host.docker.internal` DB rewrite
   lived only in `container-stack.sh`; bare pytest read `.env` verbatim -> connection refused.
3. **1,555 phantom-modified files in-container**: host `core.autocrlf=true` wrote CRLF worktrees
   into clones consumed by a Linux container (root cause of the explicit-`git add` discipline and
   the CRLF push-guard trips).
4. **Clones based on the shared tree's HEAD, not origin/master**: task branches inherited sibling
   commits when the shared tree sat on a feature branch (forced the cherry-pick-onto-fresh-worktree
   recovery on T4160/T4170 push day).
5. **No container fact sheet**: repo docs tell workers to use `.venv/Scripts/python.exe` (doesn't
   exist in-container) and `reduce_log` (no MCP in-container) — discovery tax on every task.
6. `npm install` ran unguarded in the background (vite-mid-install races) and mutated
   `package-lock.json` (accidental-commit trap).
7. Modal enabled by default in the interactive stack with no `~/.modal.toml` -> export crashes.
8. `task.sh test` kept the hang-prone unconditional `playwright install chromium`.

## Fixes applied (this task's commit, host-side tooling only)

- `scripts/task.sh`:
  - image tag = content hash of `task.Dockerfile` + baked requirements (auto-rebuild on change;
    `reel-task:latest` kept as alias; superseded content tags pruned)
  - clone with `--config core.autocrlf=false` + LF re-checkout (kills CRLF noise at birth)
  - checkout re-based onto `origin/master` after clone (`TASK_BASE=<ref>` env to override)
  - frontend deps via `npm ci --no-audit --no-fund && touch node_modules/.ready`
  - `test` chromium self-heal now skip-if-present + `timeout 120` (dev-verify's guard)
- `.devcontainer/task-bootstrap.sh`:
  - exports container-corrected `DATABASE_URL` (host.docker.internal) into `~/.profile`/`~/.bashrc`
    so bare pytest/uvicorn work (`.env` untouched; python-dotenv never overrides set env vars)
  - writes `/workspace/CLAUDE.local.md` container fact sheet (correct python, test commands,
    no-MCP log fallback, git-add discipline, no `gh`/push)
- `.devcontainer/container-stack.sh`:
  - `MODAL_ENABLED` defaults false in-container unless `MODAL_TOKEN_ID` present
  - frontend start gates on `node_modules/.ready` (up to 180s) instead of racing `npm ci`
- `.gitignore`: `.dotask-kickoff.md`, `.task-env`, `CLAUDE.local.md`

Smoke-tested end-to-end (`task.sh up smoketest`): image rebuilt under hashed tag, clone based on
`origin/master`, **0 phantom-modified files**, pytest 8.3.4 baked, ffprobe present. NOTE:
bootstrap-delivered items (fact sheet, DATABASE_URL export) come from the CLONE's copy of
`task-bootstrap.sh`, so they only reach workers once this commit is on origin/master.

## Remaining follow-ups (unchecked = not done)

- [x] Verify fact sheet + DATABASE_URL land in a fresh container AFTER this commit is on master
      (supervisor verified 2026-07-03 in a fresh container: fact sheet present, DATABASE_URL
      exported, psycopg2 connect OK)
- [x] Modal token provisioning (T4120 Gap 3): bootstrap writes `~/.modal.toml` from
      `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` when present (opt-in real-Modal verify)
- [ ] Consider ephemeral in-container Postgres for backend tests — today in-container pytest
      TRUNCATES the shared host dev DB (same as supervisor runs); parallel task containers running
      backend tests will stomp each other
- [ ] Rotate/de-hardcode the `ANTHROPIC_API_KEY` in the host's untracked `.mcp.json` (logreducer
      server env) — never reaches containers, but violates the no-hardcoded-secrets rule
- [x] Update `.claude/skills/dotask/SKILL.md` kickoff template: dropped the CRLF-noise claim (clones
      are LF-clean now), kept explicit-`git add` as hygiene, and pointed at `/workspace/CLAUDE.local.md`

## Context

### Relevant Files
- `scripts/task.sh` — launcher (image/clone/up/test/push)
- `.devcontainer/task-bootstrap.sh` — in-container per-up bootstrap
- `.devcontainer/container-stack.sh` — in-container app stack
- `.devcontainer/task.Dockerfile` — image (unchanged this task; its inputs now drive the tag)
- `scripts/dev-verify.sh` — unchanged (its chromium guard was ported TO task.sh)

### Related Tasks
- T4090 / T4120 (prior container-empowerment work; T4120's pytest bake is what the stale image
  had silently dropped)

## Progress Log

**2026-07-03**: Audit run, all 8 findings root-caused; top-6 fixes implemented + committed;
smoke test green for image/clone/CRLF/base fixes; bootstrap-delivered fixes verified after the
commit reached origin/master.
