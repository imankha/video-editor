# Design: relevant CI and a revision-bound landing gate

Status: APPROVED by user in this task before implementation. Implementation is in draft PRs #495 and #496 pending independent review and CI.

## Goal and scope

Implement priorities 1 and 2 while retaining the Claude subscription/CLI, isolated
workers, domain knowledge, small local test sets, and full affected-layer application
suites. Do not introduce a new orchestration framework or database.

This is L-tier tooling work: a shared CI-routing policy, an evidence record, and a
landing command. Product architecture is unchanged. Tests cover the routing policy,
gate decisions, and Git/GitHub boundary behavior. Application suites apply to changes
that can affect the application, including CI configuration changes during this rollout.

## Current versus proposed

| Concern | Current behavior | Proposed behavior |
|---|---|---|
| Instruction changes | No dedicated required CI check; local audit only | Dedicated instruction checks validate registration, links/metadata, and audit regression tests |
| Script changes | Every scripts/ change triggers frontend; shared backend impact can be missed | Explicit ownership for known scripts; unknown/shared executable changes conservatively trigger all potentially affected checks |
| Application coverage | Full unit suites for selected layers | Preserve full suites within affected layers; no filename-based test pruning |
| CI result | Supervisor manually selects and interprets workflow run | Gate queries GitHub for exact head, workflow/run identity, expected jobs, and terminal results |
| Proof | Worker reports evidence; instructions tell supervisor to request verification | Supervisor launches separate verifier, captures its result, and records the exact reviewed revision and evidence hashes |
| Missing proof | Agent must remember to stop | Gate returns blocked with specific missing items; never infers approval |
| Later changes | Instructions require refreshed review/proof | Changed revisions/artifact hashes invalidate the old record mechanically |
| Merge | Supervisor runs gh pr merge directly | Single check/land command rechecks eligibility and pins merge to approved head |
| Enforcement boundary | master is currently unprotected; no rulesets | Initial command enforces the supervised route; GitHub protection is a separate explicit rollout decision |

## 1. One tested routing policy

Move path selection from inline shell regex into a small Python module used by CI
and the landing validator. Handle added, modified, deleted, and renamed paths; for
renames consider both names. Resolve full Git SHAs and use machine-safe path input.

| Change | Required checks |
|---|---|
| CLAUDE.md, scoped agent instructions, skills, workflows, schemas | Instruction audit and instruction validation |
| Instruction audit implementation/tests | Instruction validation and tooling regression tests |
| Landing/routing modules and worker orchestration scripts | Tooling regression tests; instruction validation when contracts are affected |
| Frontend source/config/dependencies | Existing complete frontend unit/lint checks |
| Backend source/config/dependencies | Existing complete backend unit/lint checks |
| Known frontend validation scripts | Frontend checks plus their direct tests |
| Known backend support scripts | Backend checks plus their direct tests |
| Standalone shrink tool | Its own unit job, decoupled from unrelated frontend changes |
| Unknown shared executable/configuration paths | Conservative affected-layer checks; never assume docs-only |
| CI/routing configuration itself | Routing/tooling checks and both application layers for the rollout |
| Ordinary documentation with no executable/instruction impact | Lightweight validation; no app-suite claim |

Start with branch/PR routing. Keep Master CI's existing full sweep in the first
implementation; narrowing post-merge coverage is a separate decision because its
documented purpose is to detect combined-state regressions. Instruction-only PRs
will no longer wait for irrelevant application suites before merge.

Emit a machine-readable routing manifest containing base/head, changed paths, policy
version/hash, expected job names, and reasons. A final aggregate job always runs and
fails if an expected job failed, was cancelled, timed out, or unexpectedly skipped.
Intentional skips are valid only when justified by the routing manifest.

Capture immutable base/head revisions once and pass them to every job. Jobs must not
independently fetch a newer master and lint/test a different comparison. The landing
controller uses trusted installed/default-branch policy, not a weaker validator supplied
by the PR it is judging. Workflow/policy changes require explicit independent review and
cannot self-authorize omitted required checks. Bootstrap the first gate through the
existing human-approved process, then promote reviewed policy versions deliberately.

## 2. Evidence and landing commands

Use a small versioned JSON evidence record outside the worker's editable checkout,
owned by the supervisor. This is a local gate record, not the full archival system.
It contains repository/PR identity, base/head SHAs, acceptance criteria, proof-test
hashes, red/green results and logs, code-review findings, verifier attempt identity,
verdict and scope, and explicit remaining human-only checks.

For behavior changes require the same test to show the intended failure before the
change and success after it. A passing test alone, import failure, or mock that removes
the changed behavior is insufficient. For instruction-only changes require the relevant
static checks and independent review; a human-authorized landing decision remains
available under the existing policy, rather than inventing a behavioral red test.

The supervisor launches a fresh verifier separately from implementation and proof-test
authorship, records its actual output, and binds that output to the evidence digest.
The gate rejects a worker-authored JSON claim of independent approval. This records
provenance within the supervised workflow; it does not magically authenticate a model's
judgment or resist a compromised host/admin credential.

Proposed commands (exact naming can follow repository conventions):

```
python scripts/landing_gate.py check --pr <number> --evidence <record>
python scripts/landing_gate.py land --pr <number> --evidence <record>
```

`check` is read-only and returns eligible/blocked plus specific reasons. It validates:

1. Schema, repository, PR, full revisions, and relevant artifact hashes.
2. Required acceptance evidence and actual independent verification provenance.
3. No unresolved blocking/major findings or missing human-only decision.
4. Exact-head CI runs from the intended workflow, all expected jobs successful.
5. Current PR head/base agree with the evidence; changed state requires refresh.

`land` repeats the checks immediately before invoking the GitHub merge command with
the exact-head precondition. It does not accept `--force`/`--skip-proof` shortcuts.
It never executes shell commands read from evidence records. Verification commands
remain explicit, reviewed inputs to isolated verification work.

Head pinning prevents a different PR revision being merged. A base check before merge
cannot by itself eliminate a concurrent master update; strict up-to-date branch
protection or a merge queue is needed for that stronger server-side guarantee. Do not
claim that a local check makes the base comparison atomic.

## Enforcement decision

Implementing the command makes the normal agent workflow deterministic, but a user or
agent with repository credentials could still merge directly because master currently
has no protection. Required GitHub checks can prevent ordinary bypass. A server-required
proof verdict additionally needs a trusted publisher/identity outside worker control;
an editable branch workflow or a self-authored JSON file is not sufficient.

Recommended incremental scope: implement and prove the routing and supervised gate
first; enable the stable CI aggregate as a protected-branch requirement after it has
passed on real PRs. Decide separately whether to add a trusted proof-check publisher
and remove bypass permissions. This avoids claiming stronger isolation than exists.

## Test-first acceptance plan

| Test | Required outcome |
|---|---|
| Instruction-only change | Instruction job selected, unrelated app jobs absent |
| Shared script / unknown configuration | Relevant application coverage retained |
| Rename from application source to docs | Original application ownership still considered |
| Stale green CI on another SHA | Block |
| Missing run, pending/cancelled/failed job, unexpected skip | Block with exact reason |
| Passing CI without verifier result | Block |
| Worker substitutes its own approval | Block within the supervised provenance model |
| PR weakens its workflow or gate to omit a check | Trusted controller still requires the original applicable checks; policy changes require reviewed promotion |
| Changed proof log/test/revision after approval | Block and request renewed verification |
| Unresolved review finding | Block |
| Documentation-only change | No fabricated red-to-green behavior required; record applicable checks and any required human authorization |
| PR head changes between check and merge | GitHub head precondition rejects merge |
| Base changes | Pre-merge recheck blocks if observed; document remaining race without server enforcement |
| Fully valid evidence and checks | Exactly one merge call for the expected head |
| Evidence includes shell metacharacters or traversal paths | No arbitrary command execution or escape from declared evidence roots |

Write these failing tests before gate implementation. Use isolated fixture Git repositories
and a fake GitHub transport for deterministic failure cases, then exercise a real PR for
workflow integration. Have a separate verifier replay the decisive tests and challenge
missing coverage. A mock transport tests gate decisions, not actual GitHub enforcement;
the integration check must confirm the real boundary behavior.

## Delivery sequence

1. Approved design and failing routing/gate tests.
2. PR A: instruction validation, tested routing, standalone tooling jobs, aggregate result.
3. PR B: evidence record, verifier capture, exact-revision check/land commands, supervisor integration.
4. Independent proof review and real-PR integration checks.
5. Configure protected-branch requirements only after the exact check names and rollout
   are reviewable; do not silently change repository-wide merge permissions.

Full archival/cleanup, toolchain pinning, durable execution state, scheduling, and live
agent-quality evaluations remain later work. This design does not claim static checks
prove semantic prompt quality.
