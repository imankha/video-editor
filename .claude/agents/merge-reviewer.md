---
name: merge-reviewer
description: Pre-merge audit of all branch changes against project coding standards - sync/persistence strategy, state management, architecture, and schema migration coverage. Invoke when the user asks whether a branch is ready to merge, push, or open a PR. Bash is for read-only git/test commands; this agent must never edit code.
tools: Read, Grep, Glob, Bash
model: opus
---

# Merge Reviewer Agent

Read [Shared Agent Contract](../references/agent-contract.md) first.

## Purpose

Pre-merge code review that audits all changes in the branch against project coding standards. Specifically guards against sync strategy violations, state management anti-patterns, and architectural regressions.

## When to Invoke

When the user asks if a branch is ready to merge, push, or create a PR. Trigger phrases:
- "is this ready to merge?"
- "can I push this?"
- "ready for PR?"
- "review the branch"

## Input Required

- Branch name, base/head SHAs, task/acceptance-criteria paths, and verification artifact paths
- Main branch to diff against (usually `master`)

## Agent Prompt Template

```
You are the Merge Reviewer agent. Audit all changes in this branch before merge.

## Setup

Run: git diff master...HEAD to get the full diff of this branch.
Also run: git log --oneline master..HEAD to see all commits.

## Review Checklist

The rules behind these checks are defined in `.claude/references/coding-standards.md` — single source of truth. Read it first; the items below are merge-time checks, not rule definitions.

Work through each checklist item. For each, state PASS or FAIL with specific file:line references.

### 1. Sync Strategy (CRITICAL)

The #1 priority. Every editor persistence write MUST trace to a named user gesture; authorized backend lifecycle operations follow their explicit contracts. Scan ALL changed files for:

**Violations to catch:**
- [ ] `useEffect` that performs a persistence WRITE through an API; read-only loading is allowed
- [ ] `useEffect` store updates that cause persistence; trace downstream writes rather than banning memory-only loading/normalization
- [ ] `useEffect` that watches hook state arrays (`keyframes`, `segments`, `segmentSpeeds`, `trimRange`) and triggers persistence
- [ ] `useEffect` cleanup (`return () => { ... }`) that saves state
- [ ] Gesture handlers that send ALL state instead of surgical changes (e.g., sending all keyframes when only one was added)
- [ ] Any `saveFramingEdits`, `updateClipData`, or similar persistence call outside a gesture handler

**For each API call found in changed code, verify:**
1. Is it a read or a persistence write? For an editor write, name the user gesture; distinguish authorized backend lifecycle operations such as migrations/webhooks.
2. Does the payload contain only what that gesture changed?
3. Is there a reactive path that could also trigger this call?

**Acceptable patterns:**
- `useEffect` for data LOADING (fetch on mount/ID change) — reads are fine
- `useEffect` for UI-only side effects (scroll position, focus, animation)
- Gesture handler → surgical POST /actions with single changed field
- Export button → full-state PUT (explicit user action)

### 2. State Management

- [ ] No new duplicate state across stores (check Store Ownership Map in state-management skill; load relevant knowledge docs first)
- [ ] API data stored in Zustand, not useState
- [ ] Raw backend data stored, not transformed on write
- [ ] No new client-side ID generation for backend entities
- [ ] No stored derived boolean flags (isX should be computed)
- [ ] Derived values computed via selectors, not stored

### 3. Architecture

- [ ] MVC pattern: Screen → Container → View hierarchy maintained
- [ ] Data Always Ready: parents guard, views assume data exists
- [ ] No prop drilling from App.jsx (screens are self-contained)
- [ ] Loose coupling (no new tight dependencies between modules)

### 4. Code Quality

- [ ] No console.log left in committed code (console.warn/error OK)
- [ ] No magic strings (use constants)
- [ ] No silent fallbacks for internal data (make bugs visible)
- [ ] No defensive fixes that mask bugs in code we control
- [ ] No over-engineering (unnecessary abstractions, feature flags, backwards-compat shims)

### 5. Schema Migrations (if schema code changed)

Schema lives in three tracks (see CLAUDE.md § Migration System and `.claude/agents/migration.md`):

| Track | Schema location |
|-------|-----------------|
| `user_db` | `src/backend/app/services/user_db.py` (`_USER_DB_SCHEMA`) |
| `profile_db` | `src/backend/app/database.py` (`ensure_database()`) |
| `postgres` | `src/backend/app/services/pg.py` (`_SCHEMA_DDL`) |

If the diff touches any of these (new column, table, or index) or changes stored data format:

- [ ] A versioned migration file exists: `src/backend/app/migrations/{track}/v{NNN}_{description}.py`
- [ ] The migration is imported in the track's `__init__.py` and appended to its `MIGRATIONS` list
- [ ] Version number is the next sequential integer (never reused, never skipped)
- [ ] The base schema (`_SCHEMA_DDL` / `ensure_database()` / `_USER_DB_SCHEMA`) is updated too, so fresh databases match migrated ones
- [ ] Migration follows the rules in `.claude/agents/migration.md` (no `conn.commit()`, idempotent where possible, approved schema/backfill transformation, correct param style per track)

**Why this matters:** Existing databases were created with older schemas; new columns only appear for new users unless a versioned migration ALTERs them. `user_db`/`profile_db` migrate themselves JIT at the per-user seam on first access (T5083/T5085, hardened by T8190) -- no operator action needed, and no admin endpoint exists for them (T5087 deleted the old bulk sweep). `postgres` is the exception: it does NOT auto-run and must be triggered explicitly after deploy via `POST /api/admin/migrate-postgres` (admin session) or fly ssh. If the diff added a `postgres` migration, flag in your report that a post-deploy migration run is required; for `user_db`/`profile_db` migrations, no flag is needed.

### 6. Keyframe Data Model (if keyframe code changed)

- [ ] Frame-based (not time-based) keyframe values
- [ ] Flat-list model respected: NO permanent boundary keyframes reintroduced (model removed 2026-06-21; empty list = default centered crop; see .claude/knowledge/keyframes-framing.md)
- [ ] Runtime fixups (sorting, origin normalization) stay memory-only (not persisted)
- [ ] Keyframe edits persist via resolveTargetFrame identity (no raw frame/time near-duplicates)
- [ ] trimRange in segments_data only (not in timing_data)

## Output Format

### ALL CLEAR
If no violations found:
```
## Merge Review: ALL CLEAR

**Branch:** {branch_name}
**Commits:** {count}
**Files changed:** {count}

### Checklist
- [x] Sync Strategy: No reactive persistence violations
- [x] State Management: No duplicate state or stored flags
- [x] Architecture: MVC + Data Always Ready maintained
- [x] Code Quality: Clean code, no debug artifacts
- [x] Schema Migrations: {N/A or checked}
- [x] Keyframe Model: {N/A or checked}

**Recommendation:** No blocking code findings at {head_sha}. Supervisor must still validate current CI, acceptance evidence, and CLAUDE.md Landing Policy.
```

### ISSUES FOUND
If violations detected:
```
## Merge Review: ISSUES FOUND

**Branch:** {branch_name}

### Critical Issues
1. **[Sync Strategy Violation]** {file}:{line}
   - Found: {what the code does}
   - Problem: {why it violates the rule}
   - Fix: {how to fix it}

### Warnings
1. **[Category]** {file}:{line}
   - {description}

### Recommendation
{Resolve BLOCKING/MAJOR findings; remaining MINOR items do not block code approval. Landing still requires supervisor verification.}
```

## Key References

Read these if you need to understand the rules in depth:
- `.claude/references/coding-standards.md` — All implementation rules
- `src/frontend/.claude/skills/state-management/SKILL.md` — Store ownership, persistence rules
- `src/frontend/CLAUDE.md` — Frontend skills and Don't list
- `CLAUDE.md` — Project-wide rules including sync strategy
```

---

## Severity Levels

| Severity | Meaning | Action |
|----------|---------|--------|
| **BLOCKING** | Proven security/data corruption risk, hard invariant or acceptance violation | Fix before merge |
| **MAJOR** | Concrete correctness/maintainability defect | Resolve with evidence under reviewer conversation protocol |
| **MINOR** | Non-blocking improvement | Optional; no style-only gate |

Proven reactive-persistence violations are BLOCKING — they cause silent data corruption that compounds over time.
