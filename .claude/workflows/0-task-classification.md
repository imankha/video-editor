# Stage 0: Task Classification

`CLAUDE.md` owns tier thresholds and model policy. Classify before editing and
explain procedural adjustments. Do not use older size categories or silently
skip a tier's required review.

## Tier and model

Use CLAUDE.md **Task Tiers** and **Model Policy**. S is strictly under 10 LOC in
one file with no behavior-adjacent risk. M requires one fresh-context reviewer;
L includes architecture approval and specialist review fan-out. Optional roles
must add value; L does not mean every registered agent runs.

The interactive driver handles mechanics; the expert handles uncertain reasoning.
Container model flags are defined in spawn-worker step 3. Inspect frontmatter:
agents do not necessarily inherit the caller's model. The Sonnet implementor
requires an upstream specification. For M work without a design, the driver obtains
the expert's concrete recommendation or the Opus worker makes design decisions
before delegating mechanical slices.

Reclassify if scope reveals a schema change, new abstraction, material persistence
or API-contract change, or substantially more files. Apply the required design gate.
Documentation-only consistency work uses instruction/link validation, not app
test suites. Reconciling existing policy does not itself require a new product design.

## Required output

```text
Tier: S / M / L, with any justified procedural adjustment
Stack layers: Frontend / Backend / Modal / Database / Tooling or docs
Files / LOC estimate:
Test scope: named relevant checks, or why app tests do not apply
Knowledge docs: relevant paths, or none for instruction-only work
Model/effort: driver, worker, included specialists
Agents: include/skip each role with reason
Skipped stages: reason
```

## Role selection

| Role | Include when | Scope |
|---|---|---|
| Code Expert | Knowledge docs leave material code/data-flow gaps | Findings and proposed knowledge corrections; no edits |
| Expert | Non-obvious mechanism, design tradeoff, concurrency, or failed fix | Root cause/design only |
| Architect | L tier or explicitly design-gated change | Design document for user approval |
| Tester | Separate test authorship/verification adds value; default for L | Tests/evidence; S driver tests directly, M may test directly |
| Implementor | Approved design or concrete scoped specification exists | Assigned source files |
| Proof Verifier | Before every automatic landing | Independent evidence reproduction; no implementation or proof-test edits |
| Reviewer | M and L | One fresh reviewer for M; lens fan-out for L; S skips |
| Migration | Schema or persisted-format transformation | Migration and verification, not account operations |
| Refactor | A scoped prerequisite is necessary | Characterization tests first; no cleanup sweep |
| UI Designer / UX Investigator | Missing product decisions/evidence | Design/report, not production implementation |

## Test selection

Name tests for the changed behavior, direct consumers, regression mechanism, and
changed flow. Consult `.claude/skills/run-tests/SKILL.md`. About ten tests is a
sizing guide, not a ceiling. Branch CI runs full unit suites for affected layers;
Master CI checks the combined state. Neither replaces task-specific E2E.

## Examples

| Task | Tier | Default handling |
|---|---|---|
| Five-line copy correction in one file | S | Direct edit, relevant validation, no implementation agents; separate proof gate before automatic landing |
| Behavioral bug in two files | M | Regression test, implement, tests, one reviewer |
| New schema or persistence protocol | L | Design gate, test-first, migration if needed, review lenses |
| Instruction reconciliation across role files | L by file count | Document mechanical adjustment; validate instructions; no app tests or new product design gate |

For tracked tasks, the orchestrator updates PLAN.md and the task-file status;
container workers do not. Branch before changes (S exception in CLAUDE.md), stage
explicit paths, and preserve unrelated work. Task-ID commit conventions apply
when an ID exists; an untracked maintenance request need not invent a roadmap task.
