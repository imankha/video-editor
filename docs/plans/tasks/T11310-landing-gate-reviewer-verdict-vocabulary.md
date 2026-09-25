# T11310: Landing gate reviewer captures sometimes return the wrong verdict word

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-25
**Updated:** 2026-09-25

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

## Acceptance Criteria

- [ ] Red-then-green: a test asserting a reviewer-role capture with `verdict: "VERIFIED"`
      is rejected (either at schema-validation time, if role-split, or by `evaluate()`)
      fails on current `landing_gate.py`, passes after
- [ ] `python scripts/test_ci_policy.py` and `python scripts/test_landing_gate.py` pass
- [ ] No change to the trusted-controller bootstrap/policy-review requirement itself
- [ ] `docs/plans/landing-gate-usage.md`'s "Known issue" note updated to reflect the fix
