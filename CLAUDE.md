# Video Editor - AI Guidelines

## Project Overview
Browser-based video editor: **Annotate** (clip extraction) → **Focus** (crop/upscale) → **Overlay** (highlights) → **Gallery** (downloads).

## Stack
| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite + Zustand + Tailwind (port 5173) |
| Backend | FastAPI + Python 3.11 (port 8000) |
| Database | Fly Postgres (auth/sharing/sessions) + SQLite per-user (clips/projects, synced to R2) |
| Storage | Cloudflare R2 (user media + per-user SQLite) |
| GPU | Modal (cloud) or local FFmpeg + Real-ESRGAN |

## Data Safety Rules

- Always confirm the exact scope of deletion with the user before executing
- Use `scripts/reset_all_accounts.py` for full account resets on dev/staging (preserves games)
- Use `scripts/reset-test-user.py` for single account resets on any env (including prod):
  ```bash
  cd src/backend && .venv/Scripts/python.exe ../../scripts/reset-test-user.py <email> --env <dev|staging|prod>
  ```
  For prod: downloads DBs from R2, clears data, re-uploads, restarts Fly.io machines, warms server. Add `--no-restart` to skip the restart.

## Commands
```bash
# Dev servers
cd src/frontend && npm run dev
cd src/backend && uvicorn app.main:app --reload

# Frontend tests
cd src/frontend && npm test           # Unit tests (Vitest)
cd src/frontend && npm run test:e2e   # E2E (Playwright)

# Backend tests
cd src/backend && .venv/Scripts/python.exe run_tests.py  # All tests
cd src/backend && pytest tests/test_clips.py -v          # Specific file
```

## Model Policy (driver = Sonnet, expert = Opus)

Interactive sessions in this project default to **Sonnet** (settings.local.json). Sonnet owns
everything mechanical: orchestration, bookkeeping (PLAN.md, WAVE.md, status files, commits),
running the relevant test set, driving containers, and implementation that follows a clear spec.

**Escalate to the [expert agent](.claude/agents/expert.md) (Opus) — don't grind.** Spawn it,
passing the relevant `.claude/knowledge/` doc name(s) and a precise question, whenever:

- root-causing a bug whose mechanism isn't obvious from the first read of the code
- an architecture/design decision has real tradeoffs (schema, persistence, new pattern)
- the problem involves async timing, persistence/sync (CAS, R2 versioning), or concurrency
- performance analysis beyond an obvious hot spot
- **one focused attempt at a fix has failed** — a second Sonnet guess costs more than the
  escalation; never attempt a third without the expert's verdict

The expert returns analysis/design only; this session implements it. The design-gated agents
(architect, code-expert, reviewer) are pinned to Opus in their frontmatter and stay strong
regardless of the session model. Container workers keep their own tier-based model flags
(spawn-worker SKILL).

## Task Rules

### Never Skip (ALL tasks, including bug fixes)

| Step | When | Action |
|------|------|--------|
| Classify | Before starting | Determine TIER first, then stack layers, files, LOC, test scope, agent inclusion |
| Load knowledge | Before exploring | Read the relevant `.claude/knowledge/*.md` domain doc(s) instead of re-auditing the codebase |
| Branch | Before first change | `git checkout -b feature/T{id}-{description}` (skip for <10 LOC single-file) |
| Commit | After implementation | Commit with co-author line |

### Task Tiers (pipeline scales with size)

Classification starts by picking a tier. The tier sets the DEFAULT pipeline; classification can still add/remove agents with justification.

| Tier | Trigger | Default pipeline |
|------|---------|------------------|
| **S** | <10 LOC, 1 file, no behavior-adjacent risk | Fix directly. Lint hooks + targeted test + commit. No agents. |
| **M** | Bug fixes and small features: <~6 files, 1-2 layers, no new abstractions, no schema change | Load knowledge doc(s) -> plan briefly -> implement -> tests + lint hooks -> ONE fresh-context Reviewer on the diff -> commit. Skip Architect / Tester Phase 1 / Migration unless classification flags them. |
| **L** | Epics, schema changes, new patterns/abstractions, 6+ files or 3+ layers, design-gated tasks | Full staged workflow (Stages 0-7) including Architect design gate; Reviewer runs as a parallel fan-out (see ORCHESTRATION.md). |

Deterministic gates apply to ALL tiers automatically: eslint/ruff run via PostToolUse hook on every edit (`.claude/hooks/lint-changed.cjs`) and block until clean. Test evidence (actual output, not claims) is required before a task is called complete.

### Test Scope Policy (all tiers)

Local/worker test runs are the **RELEVANT SET (~10 tests), curated — never everything**. First understand the corner of the code the change lives in (changed files + their direct consumers), then name the set before running it: the tests written for this feature + the existing regression tests guarding that corner + the e2e spec for the changed flow. `npx vitest related --run <changed sources>` is a candidate finder, not a run list — curate its output. More complexity means a bigger relevant set, chosen deliberately; never a full suite, never a whole layer, never "run everything to be safe" — Branch CI is the mandatory full-sweep verdict and Master CI re-runs everything on every merge to master.

**Branch CI is layer-scoped (T6405).** Its `changes` job diffs against master and skips the whole frontend job when no `src/frontend/**` (or `scripts/**`) file changed, and the whole backend job when no `src/backend/**` file changed; a change to `branch-ci.yml` itself runs both. **Within a job the suite still runs IN FULL** — the scoping is per LAYER, never per test file. Selecting individual test files from the diff is explicitly rejected: Python's import graph means a `storage.py` change is exercised by tests that never name storage (anything importing `app.main`), so file-name selection silently skips real regressions. Sound intra-suite selection needs coverage data (testmon), not path matching. Bias the filter toward RUNNING — shared paths trip both layers. Fix loop: a failing test gets fixed, then re-run that test + tests exercising the files the fix touched; already-passed tests whose subject code didn't change are not re-run. Details: `.claude/skills/run-tests/SKILL.md`.

### Task Status Rule

Statuses split into two kinds with different owners:

**Factual (AI sets in PLAN.md):**
- `WIP` — work begins or resumes (see [1-task-start.md](.claude/workflows/1-task-start.md)).
- `WAITING ON USER` — set the MOMENT the task blocks on the user (design gate, manual-test verdict, open question, finished branch awaiting merge); say what you are waiting for. Back to `WIP` when unblocked. A task must never sit at `WIP` while AI is idle.
- `STAGING` — task branch lands on master (auto-deploys staging; staging IS the test phase, so there is no separate TESTING step). See [7-task-complete.md](.claude/workflows/7-task-complete.md).

**DONE (user's call, exactly two gestures):** the user clicks **Resolve** on the task board, OR runs **`/deploy`** (a prod deploy auto-promotes every task whose implementation shipped in it — see [deploy skill](.claude/skills/deploy/SKILL.md)). AI never marks DONE otherwise.

Lifecycle: `TODO -> WIP (AI) <-> WAITING ON USER (AI) -> STAGING (AI) -> DONE (user gesture)`. DONE rows are hidden on the board.

**DONE rows leave PLAN.md.** The moment a row is promoted to DONE (deploy reconciliation or board Resolve), MOVE it verbatim to [PLAN-archive.md](docs/plans/PLAN-archive.md) under a `## {section} — {subsection}` heading matching its PLAN.md location (create the heading + table header if absent). PLAN.md holds only live work; if a section empties, replace its table with the archive-pointer line. The deploy skill's Step E does this as part of auto-promotion.

**Branch visibility is derived, never recorded.** No branch names in PLAN.md — the board resolves each task's branch from git (branch named `feature/T{id}-slug`, or any commit subject on a branch mentioning `T{id}` — that is how tasks stay attributed after wave branches collapse). Corollary that must hold: **every task commit subject starts with the task id** (`T5683: ...`), or the task loses attribution once its own branch is deleted.

### Classification Output (Required)

Before starting any task, produce:

```
**Tier:** [S | M | L]
**Stack Layers:** [Frontend | Backend | Modal | Database]
**Files Affected:** ~{n} files
**LOC Estimate:** ~{n} lines
**Test Scope:** [Frontend Unit | Frontend E2E | Backend | None]
**Knowledge Docs:** [.claude/knowledge/ docs relevant to this task]

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | Yes/No | {reason} |
| Architect | Yes/No | {reason} |
| Tester | Yes/No | {reason} |
| Reviewer | Yes/No | {reason} |
| Migration | Yes/No | {reason} |
```

See [0-task-classification.md](.claude/workflows/0-task-classification.md) for full criteria.

---

## Workflow Stages

**Detect the current stage and load the appropriate workflow file:**

| # | Stage | Workflow | Agent | User Gate |
|---|-------|----------|-------|-----------|
| 0 | Task Classification | [0-task-classification.md](.claude/workflows/0-task-classification.md) | - | - |
| 1 | Task Start | [1-task-start.md](.claude/workflows/1-task-start.md) | Code Expert | - |
| 1.5 | Refactor | - | Refactor | - |
| 2 | Architecture | [2-architecture.md](.claude/workflows/2-architecture.md) | Architect | **Approval Required** |
| 3 | Test First | [3-test-first.md](.claude/workflows/3-test-first.md) | Tester (Phase 1) | - |
| 4 | Implementation | [4-implementation.md](.claude/workflows/4-implementation.md) | Implementor | - |
| 4.75 | Migration | - | Migration | - |
| 4.5 | Review | [reviewer.md](.claude/agents/reviewer.md) | Reviewer | Conversation (protocol in ORCHESTRATION.md) |
| 5 | Automated Testing + Coverage | [5-automated-testing.md](.claude/workflows/5-automated-testing.md) | Tester (Phase 2) | - |
| 6 | Test & Fix Agent Handoff | [6-manual-testing.md](.claude/workflows/6-manual-testing.md) | - | **New Conversation** |
| 7 | Task Complete | [7-task-complete.md](.claude/workflows/7-task-complete.md) | - | - |

The TIER sets the path: S skips all stages except implement+gates+commit; M runs implement -> review; L runs the full table.

## Stage Detection Rules

| User Says | Action |
|-----------|--------|
| "Implement T{id}..." / assigns task | → Stage 1 → Stage 2 |
| Reviews design doc | → Wait for "approved" or feedback |
| "Approved" / "looks good" (design) | → Stage 3 → Stage 4 |
| "I think this works" / code complete | → Stage 5 |
| All tests pass | → Stage 6 handoff |
| "Approved" / "that worked" (testing) | → Stage 7 |
| "Ready to merge?" / "can I push?" / "ready for PR?" | → Spawn Merge Reviewer agent |

## Agents

Registered subagents live in `.claude/agents/` (frontmatter = name, description, tool scoping); spawn them by `subagent_type`, never by pasting instructions into `general-purpose`. Spawning templates, handoff protocol, review-conversation flow, and the implementation fan-out are in [ORCHESTRATION.md](.claude/ORCHESTRATION.md). **Pass artifact PATHS (design doc path, diff via `git diff`), never pasted content.** Before spawning, name the task's `.claude/knowledge/` doc(s) in the prompt so the agent loads them instead of re-exploring.

## Knowledge Base (persistent domain expertise)

`.claude/knowledge/` holds one doc per code domain (entry points, data flow, invariants, landmines, active work) — cached exploration, so tasks don't re-audit the codebase.

| Doc | Domain |
|-----|--------|
| [export-pipeline.md](.claude/knowledge/export-pipeline.md) | Export/publish flow, final videos, R2 refs |
| [modal-gpu.md](.claude/knowledge/modal-gpu.md) | Modal functions, upscaling, local FFmpeg |
| [keyframes-framing.md](.claude/knowledge/keyframes-framing.md) | Crop/highlight keyframes, splines, Focus (formerly Framing) mode |
| [annotate.md](.claude/knowledge/annotate.md) | Annotate screen, clips/segments, recap |
| [persistence-sync.md](.claude/knowledge/persistence-sync.md) | Gesture persistence, R2 sync, versioning |
| [backend-services.md](.claude/knowledge/backend-services.md) | FastAPI structure, Postgres, migrations |

**Rules:** (1) Load the matching doc(s) at task start BEFORE exploring; only explore what they don't cover. (2) Update the touched doc(s) at Stage 7 (new invariants, moved entry points, landmines); prune stale lines. (3) Docs are claims, code is truth — fix contradicting docs in the same commit.

## References

| Reference | Content |
|-----------|---------|
| [Coding Standards](.claude/references/coding-standards.md) | **All implementation rules** - MVC, state, types, coupling, persistence (single source of truth) |
| [Code Smells](.claude/references/code-smells.md) | Fowler's refactoring catalog |
| [Design Patterns](.claude/references/design-patterns.md) | GoF patterns for React + FastAPI |
| [Testing Matrix](.claude/references/testing-matrix.md) | Coverage guidance by change type |
| [UI Style Guide](.claude/references/ui-style-guide.md) | Colors, typography, components |
| [Epic Rules](.claude/references/epic-rules.md) | Epic sequencing, task-file self-containment, handoff template, PLAN.md format |
| [Handoff Schemas](.claude/schemas/handoffs.md) | Structured context passing between agents |
| [Error Recovery](.claude/workflows/error-recovery.md) | Recovery procedures |
| [Retrospectives](.claude/retrospectives/README.md) | Task retrospective template |

## Design Document

Stage 2 creates `docs/plans/tasks/T{id}-design.md` (current state, target state, implementation plan, risks — with diagrams/pseudo code). **Must be approved before implementation.** Details: [2-architecture.md](.claude/workflows/2-architecture.md).

## Task Management

Use the [task-management skill](.claude/skills/task-management/SKILL.md) to create tasks (file + PLAN.md entry) and organize epics. For roadmap decisions (placement, priorities, next task), use the [Project Manager agent](.claude/agents/project-manager.md); cycles run **INFRA → FEATURES → POLISH → repeat**. Current plan: [docs/plans/PLAN.md](docs/plans/PLAN.md).

**Epics:** tasks implemented strictly in PLAN.md order, each handed to its own agent with prior-task learnings; task files must be self-contained (reference EPIC.md, don't duplicate it). Full rules + handoff template + PLAN.md `↳` format: [epic-rules.md](.claude/references/epic-rules.md).

## Coding Principles

Full rules and examples live in [coding-standards.md](.claude/references/coding-standards.md) — the single source of truth. The always-on rules:

- **No silent fallbacks for internal data.** `region.fps || 30` hides a bug; warn loudly and let the caller handle the missing value. Fallbacks are for external dependencies only.
- **No defensive fixes for internal bugs.** Don't write code that "handles" impossible states our own code created — fix the source. Invalid state should log and fail visibly, never self-repair silently.
- **Correct data, not workarounds.** One canonical location per datum; code assumes data is correct; migrations MAKE it correct (and are self-sufficient — they run their prerequisites, never fall back to raw sources).

### Persistence: Gesture-Based, Never Reactive

**The app NEVER writes to the backend as a side effect of state changing.** Every DB write must trace to a named user gesture (click, drag, keypress) — if you can't name the gesture, the write shouldn't exist. Reactive persistence creates feedback loops that corrupt data (runtime fixups get persisted, then re-fixed on every load — this caused T350's keyframe corruption; mechanism + examples in [coding-standards.md](.claude/references/coding-standards.md) § Persistence).

```
SURGICAL:   gesture → handler → POST /actions with ONLY the changed field
FULL-STATE: explicit save gesture only (export button → saveCurrentClipState)
NEVER:      useEffect watching state → write to store/backend   ← BANNED
```

1. **Gesture → surgical call**: each handler sends ONLY the data that gesture changed
2. **No reactive persistence**: never `useEffect` → DB/store write. No exceptions.
3. **Runtime fixups are memory-only** (`ensurePermanentKeyframes`, origin normalization) — never persisted
4. **Restore is read-only**: loading DB → hooks must not trigger a write-back
5. **Single write path per data**
6. **Full-state saves require an explicit gesture** (export click), never reactive
7. **A write path must prove its copy is current, or fail loudly** (T4310 upload side + T4315 restore side). Read-modify-write on an unconfirmed snapshot silently clobbers newer state. Both halves required — CAS alone still serves stale reads; restore-if-newer alone still races the upload: **upload CAS** (R2 version compare-and-swap refuses a stale upload; on conflict freeze the write, log CRITICAL, surface the failed-sync/Retry UX — never auto-merge, never blind-retry) and **restore-if-newer** (a writer resolving a DB it does not already hold under the request's own session/profile context — admin grants, payment webhooks, cross-user materialization — must confirm R2 hasn't moved past its loaded-from version BEFORE mutating, or refuse; enforced structurally in the shared connection-opening path, so new call sites can't skip it). Never swap a live WAL-mode file another connection may hold — refuse instead. See [persistence-sync.md](.claude/knowledge/persistence-sync.md) § CAS / SyncResult and § T4315.

Self-check: writing a `useEffect` that calls an API or updates a store? → move it into the gesture handler. Watching hook state? → name the gesture; "internal fixup" means don't persist. Sending all keyframes when one changed? → make it surgical.

## Refactoring Rules

Process rules for structural refactors (catalog: [code-smells.md](.claude/references/code-smells.md); rationale: [audit-2026-07-03](docs/plans/audit-2026-07-03-code-quality.md)):

1. **Abstract on the 3rd duplication, never the 1st** — premature indirection hides code paths from grep and hurts agents more than duplication does
2. **Characterization tests before structural change**; strangler-fig (facade -> comparison -> flip -> delete), never big-bang
3. **Moves are mechanical commits** — code motion never mixes with behavior change
4. **Keep reviewable units < ~200 lines of meaningful diff**; split larger refactors into sequenced tasks
5. **Update CLAUDE.md/skills in the same PR as the refactor**
6. **Greppability beats elegance** — explicit names, no dynamic dispatch/registries for internal code, string literals near use or in `constants/`, never computed

## Migration System

AI never manually migrates accounts. AI writes migration code; the per-user tracks migrate
themselves just-in-time, and an admin triggers the Postgres track after deploy.

| Track | DB Type | Version Mechanism | Schema Location |
|-------|---------|-------------------|-----------------|
| `user_db` | `user.sqlite` (per-user) | `PRAGMA user_version` | `src/backend/app/services/user_db.py` (`_USER_DB_SCHEMA`) |
| `profile_db` | Profile SQLite (per-user-per-profile) | `PRAGMA user_version` | `src/backend/app/database.py` (`ensure_database()`) |
| `postgres` | Fly Postgres (shared) | `schema_migrations` table | `src/backend/app/services/pg.py` (`_SCHEMA_DDL`) |

Migration files: `src/backend/app/migrations/{track}/v{NNN}_{description}.py`.

**How each track runs (T5083 + T5085, 2026-08-31 — this replaced the old "nothing ever
auto-runs; always hit the admin endpoint" rule):**

| Track | Trigger | Operator action after deploy |
|-------|---------|------------------------------|
| `user_db`, `profile_db` | **JUST-IN-TIME at the per-user DB-load seam** — `run_user_seam`/`run_profile_seam` (`app/migrations/__init__.py`), called from `ensure_database`/`ensure_user_database` AND from every non-login opener (share materialization, admin cross-user reads, cross-profile moves, background loops). Migrates on FIRST access, before any read. | **None.** Accounts migrate themselves as they are touched. |
| `postgres` | Deploy/admin-triggered ONLY (`init_pg_schema()` creates fresh DBs but never migrates). | `POST /api/admin/migrate` (admin session); SSH fallback in [migration.md](.claude/agents/migration.md). |

A blocked per-user migration (WAL-busy, CAS-refused sync, below-head R2 verify) raises
`migrations.MigrationBlocked` → retryable HTTP 503 `{"code": "pending_migration"}` — it never
opens a below-head DB silently. `run_all_migrations` / `POST /api/admin/migrate` still exist
and still sweep every user as a backstop (JIT Migration epic child T5087 deletes the per-user
half once JIT has proven itself); running it is harmless and idempotent, just no longer
required for the SQLite tracks.

Schema changes: include the Migration agent in classification AND update `_SCHEMA_DDL` in `pg.py` for fresh deployments. Key rule: `PRAGMA user_version` = schema version; `db_version` table / R2 `x-amz-meta-db-version` = sync version. Independent. Mechanism details (locking, CAS re-pull-retry-once, fail-loud): [persistence-sync.md](.claude/knowledge/persistence-sync.md) §T5083/§T5085.

## Log handling

**NEVER ingest raw logs** — a 2000-line log burns 20k+ tokens. `reduce_log` reads the file server-side; only reduced output enters context. Always include `tail` (200-2000); filter with `grep`/`level`:

```
reduce_log({ file: "app.log", tail: 2000 })                            // auto-summary if large
reduce_log({ file: "app.log", tail: 200, level: "error" })             // errors only
reduce_log({ file: "app.log", tail: 200, grep: "timeout|connection" }) // regex search
```

Over-threshold calls without filters return an error/warning summary (use it to plan the next call); with filters they return output plus a narrowing TIP.

**Always redirect commands that might produce >20 lines** (`npm test`, `pytest`, `playwright`, `pip install`, `docker build`, ...):

```
pytest 2>&1 > /tmp/test-output.log; echo "exit: $?"
```

The exit code gives pass/fail; `reduce_log` the file only if details are needed. Short commands (`git status`, `ls`) run directly.

**User logs:** never ask the user to paste logs — tell them: *"Copy the log to your clipboard and type `/logdump`"* (or give a file path).

## Resources
- [src/frontend/CLAUDE.md](src/frontend/CLAUDE.md) - Frontend skills and patterns
- [src/backend/CLAUDE.md](src/backend/CLAUDE.md) - Backend skills and patterns
- [README.md](README.md) - Full architecture reference
