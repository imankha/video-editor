# T4290: ESLint Guardrails — Machine-Enforce the Persistence & Constants Rules

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-03
**Source:** Audit item F1 ([audit doc](../audit-2026-07-03-code-quality.md))

## Problem

The sync model's most important rule — no persistence from `useEffect` — lives in prose (CLAUDE.md, skills). Prose conventions don't survive agent-driven development: the audit still found one live violation (T4260) and several effect→other-store writes. The 2025 consensus for LLM-assisted codebases: conventions an agent must never regress get enforced by lint, not documentation.

## Solution

Add ESLint rules (custom rules via `eslint-plugin-local-rules` or flat-config inline plugin — the repo has `mcp__eslint` wired; check `src/frontend` eslint config format first):

1. **`no-persistence-in-effects`** (error): inside a `useEffect`/`useLayoutEffect` callback, flag calls to `apiFetch`/`fetch` and calls to known store-setter patterns imported from OTHER stores (heuristic: identifier from `use*Store.getState()` or imported `set*` action invoked in effect body). Allowlist mechanism: an explicit `// eslint-disable-next-line local/no-persistence-in-effects -- <named gesture/justification>` so legitimate cases (fetch-on-mount data LOADING is fine — the rule targets WRITES) are visible and reviewed. Scope the first version to write verbs: method POST/PUT/PATCH/DELETE in `apiFetch` calls, and `.setState(`/store-action calls — keep false positives low; tune on the real codebase.
2. **`no-raw-editor-mode-literals`** (warn initially): string literals `'framing' | 'overlay' | 'annotate'` outside `constants/` and `editorStore.js` — drives EDITOR_MODES adoption (T4560) and keeps it adopted.

## Steps

1. [ ] Read current eslint setup (`src/frontend/eslint.config.js` or `.eslintrc*`) + the lint skill.
2. [ ] Implement rule 1 with unit tests (ESLint `RuleTester`): banned case (effect body PUT), allowed case (gesture handler PUT), allowed case (effect GET load), disable-comment case.
3. [ ] Run across the codebase; triage every hit: real violations become TODO comments referencing their audit task ID (do NOT fix them here — they belong to T4260/T4520 etc.); false positives tune the rule.
4. [ ] Rule 2 as `warn`; count baseline hits in the PR description.
5. [ ] Wire into `npm run lint` / CI if a lint step exists (check `.github/workflows`).

## Acceptance Criteria

- [ ] `npm run lint` fails on a new `useEffect` containing a write-verb apiFetch or cross-store setState
- [ ] Zero unexplained disables; each carries a named-gesture justification
- [ ] Rule unit tests cover the four cases above
- [ ] Existing violations are annotated with their owning task, not silently disabled

## Non-Goals

Fixing the flagged violations (owned by T4260, T4520, T4480); backend lint (ruff config is separate); making rule 2 an error (that flips after T4560 lands).
