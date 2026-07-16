# T4300: Codify Refactor Process Rules (CLAUDE.md + skills)

**Status:** DONE
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-03
**Source:** Audit item F3 + best-practices research ([audit doc](../audit-2026-07-03-code-quality.md))

## Problem

The audit epics ahead (export write-path, keyframe unification, editor decoupling) will be executed largely by agents. The research brief's process rules that keep agent refactors safe and reviewable exist only in the audit doc; they need to live where agents actually read: CLAUDE.md and the relevant skills.

## Solution

Add a concise "Refactoring Rules" section to root `CLAUDE.md` (and reference it from the implementor/refactor agent definitions in `.claude/agents/`):

1. **Abstract on the 3rd duplication, never the 1st.** Two copies may be coincidence; three is a system. Premature indirection hides code paths from grep and hurts agents more than duplication does.
2. **Characterization tests before structural change.** Pin current behavior (golden outputs) before consolidating duplicated modules; strangler-fig (facade → comparison → flip → delete), never big-bang rewrite.
3. **Moves are mechanical commits.** Code motion (file moves, renames) never mixes with behavior change in a single commit — reviewers must be able to trust "this diff only moves code".
4. **Keep reviewable units < ~200 lines of meaningful diff**; split larger refactors into sequenced tasks.
5. **Update CLAUDE.md/skills in the same PR as the refactor** — a landed refactor that leaves stale conventions actively misleads the next agent.
6. **Greppability beats elegance:** explicit names, no dynamic dispatch/registry indirection for internal code, string literals near their use or in constants/ — never computed.

## Steps

1. [ ] Draft the section (≤ 40 lines — CLAUDE.md is context-budgeted; link to the audit doc for rationale).
2. [ ] Cross-reference from `.claude/agents/refactor.md`, `implementor.md`, `reviewer.md` (one line each: "Follow CLAUDE.md § Refactoring Rules").
3. [ ] Check `.claude/references/code-smells.md` / `coding-standards.md` for overlap — reference, don't duplicate (rule 5 applies to this task itself).

## Acceptance Criteria

- [ ] Rules present in root CLAUDE.md, ≤ 40 lines, with the 3rd-duplication and mechanical-commit rules verbatim
- [ ] Agent definitions reference the section
- [ ] No duplicated rule text across CLAUDE.md/references (links instead)
