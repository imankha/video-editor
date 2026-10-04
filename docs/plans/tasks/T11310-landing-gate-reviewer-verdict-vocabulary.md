# T11310: Landing gate reviewer captures sometimes return the wrong verdict word

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-25
**Updated:** 2026-10-04

## Problem

`scripts/landing_gate.py`'s `REPORT_SCHEMA` uses one shared `verdict` enum for both
independent-capture roles:

```python
'verdict': {'type': 'string', 'enum': ['VERIFIED','MORE_PROOF_REQUIRED',
    'HUMAN_VERIFICATION_REQUIRED','APPROVED','NEEDS_REVISION']}
```

`VERIFIED`/`MORE_PROOF_REQUIRED`/`HUMAN_VERIFICATION_REQUIRED` belong to
`proof-verifier`; `APPROVED`/`NEEDS_REVISION` belong to `reviewer`
(`.claude/agents/reviewer.md:266`). `capture()`'s prompt (`landing_gate.py:272-281`)
tells the model to "Read {agents}/{role}.md ... Act as an independent {role}" and
"Return the structured verdict", but never states which literal words are valid for
which role — it relies on the agent doc alone, and the schema itself accepts either
role's vocabulary for either call.

**Observed 2026-09-25**, landing T11210 and T11170 (see
`docs/plans/tasks/single-clip-editor/T11210-...md` and
`docs/plans/tasks/quest-removal/T11170-...md`): a `capture --role reviewer` session
returned `verdict: "VERIFIED"` instead of `APPROVED`, even though the review content
itself was clean (0 blocking, 0 major, thorough independent reproduction). `check()`
(`landing_gate.py:51`, `need(review.get('verdict') == 'APPROVED', ...)`) then refuses
with `Code review has not approved` — a vocabulary technicality, not a real finding.
On T11170 this happened **4 times in a row** on the same PR before a correctly-worded
capture landed. Each capture is a ~10-15 minute independent Opus session; four in a
row on one PR is real cost for zero information (the content didn't change).

## Solution (needs independent policy review — this is the trusted controller)

Pick one, or both for defense in depth:

1. **Split `REPORT_SCHEMA` per role.** `capture()` already knows `args.role`; pass a
   role-specific schema to `--json-schema` so the model literally cannot emit the
   other role's enum values (schema-level rejection, not just downstream `evaluate()`
   rejection).
2. **State the literal required word in the prompt.** Add to the `capture()` prompt:
   "For role=reviewer, verdict must be exactly APPROVED or NEEDS_REVISION. For
   role=proof-verifier, verdict must be exactly VERIFIED, MORE_PROOF_REQUIRED, or
   HUMAN_VERIFICATION_REQUIRED. Never use the other role's words."

Option 1 is the structural fix and should be preferred; option 2 is cheap insurance
if 1 has a gap. This touches `scripts/landing_gate.py` (the trusted controller) — per
CLAUDE.md's Landing Policy and `docs/plans/landing-gate-usage.md`, controller changes
need explicit independent policy review before they can authorize their own landing.
Route this through the normal Architect/Reviewer process; do not hotfix it inline
during an active landing run (which is exactly how it was found — do not repeat that).

## Context

### Relevant Files
- `scripts/landing_gate.py` (`REPORT_SCHEMA`, `capture()`, `evaluate()`)
- `scripts/test_landing_gate.py` (existing boundary fixtures)
- `.claude/agents/reviewer.md`, `.claude/agents/proof-verifier.md` (verdict vocab source)
- `docs/plans/landing-gate-usage.md` (has a workaround note added 2026-09-25; remove or
  update it once this lands)

## Progress Log

**2026-09-26 (interim mitigation landed, task NOT closed)**: While landing T11320, this exact
bug recurred repeatedly (5+ mis-worded reviewer captures across the landing, on top of the
T11210/T11170 occurrences this task was originally filed from) and became a real blocker. The
user explicitly authorized a direct, narrow fix mid-landing — `evaluate()`
(`landing_gate.py:51`) now accepts `verdict in ('APPROVED', 'VERIFIED')` for the reviewer role,
instead of strict `== 'APPROVED'`. This unblocks landings but is explicitly NOT the structural
fix this task calls for: it doesn't reject a reviewer emitting the wrong role's vocabulary
(a reviewer that returns `MORE_PROOF_REQUIRED` or `HUMAN_VERIFICATION_REQUIRED` by mistake would
still correctly fail, but the acceptance-criteria's red-then-green test asserting `"VERIFIED"`
specifically gets REJECTED from a reviewer no longer holds — this interim fix makes that
scenario pass instead of fail, the opposite of what this task's own acceptance criteria wants).
**This task stays open** for the real fix (schema split per role, or explicit word-in-prompt) so
the reviewer role's vocabulary is actually constrained, not just widened to tolerate the known
failure mode. Note for whoever picks this up: yes, this interim fix was hotfixed inline during
an active landing, which is exactly what this task's own Solution section said not to do -
logged here for transparency, not as a precedent.

**2026-10-03 (structural fix implemented, branch `feature/T11310-...`, not yet merged)**:
Implemented both options. (1) Replaced the shared `REPORT_SCHEMA` with a per-role
`report_schema(role)` builder (`landing_gate.py`): reviewer enum is
`APPROVED`/`NEEDS_REVISION`, proof-verifier enum is `VERIFIED`/`MORE_PROOF_REQUIRED`;
`HUMAN_VERIFICATION_REQUIRED` stays valid for both roles because T10860 relies on either
role being able to flag a disclosed human-only gap it cannot authenticate itself — removing
it from the reviewer enum would silently regress that capability at capture time even though
the `evaluate()`-level T10860 test still passes. `capture()` now builds the schema from
`args.role`, so the model cannot generate the other role's verdict word. `REPORT_SCHEMA['required']`
became a `REPORT_REQUIRED` constant (the required-key set is role-independent); grepped `src/`,
`e2e/`, `scripts/`, `.claude/` — no other `REPORT_SCHEMA` callers. (2) Added the role's literal
required words to the `capture()` prompt as cheap insurance. (3) **Reverted** `evaluate()`'s
interim `verdict in ('APPROVED', 'VERIFIED')` back to strict `('APPROVED',)` for the reviewer
role (kept the T10860 `HUMAN_VERIFICATION_REQUIRED`-when-human-recorded allowance). Kept a
`evaluate()`-level check rather than relying on schema alone: it is cheap defense in depth and
is what the acceptance-criteria red-green test exercises directly (schema validation happens in
the live CLI, not in-process). Red-then-green proven: `test_reviewer_role_cannot_use_proof_verifier_verdict_word`
failed against the interim-mitigation revision (`AssertionError: 'Code review has not approved'
not found in []`) and passes after. `test_landing_gate.py` 20/20 and `test_ci_policy.py` 14/14
green; no regressions. No change to the bootstrap/policy-review gate (`check()`'s
`policy_changes_approved` requirement untouched). Trusted-controller landing is the supervisor's
job, not self-certified by this branch.

**2026-10-04 (merged)**: Reviewer APPROVED (0 blocking/0 major, 4 minor) + Proof Verifier
VERIFIED, both independently reproducing red-then-green. Per CLAUDE.md's Landing Policy this
is a trusted-controller change, so it could not be self-landed on agent scrutiny alone -- the
user gave explicit sign-off after a plain-language explanation of the diff. Merged PR #560
(`f89c239ab`).

## Acceptance Criteria

- [x] Red-then-green: a test asserting a reviewer-role capture with `verdict: "VERIFIED"`
      is rejected (either at schema-validation time, if role-split, or by `evaluate()`)
      fails on current `landing_gate.py`, passes after
- [x] `python scripts/test_ci_policy.py` and `python scripts/test_landing_gate.py` pass
- [x] No change to the trusted-controller bootstrap/policy-review requirement itself
- [x] `docs/plans/landing-gate-usage.md`'s "Known issue" note updated to reflect the fix
