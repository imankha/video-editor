# Supervisor landing gate

The gate is a trusted-supervisor command, not a sandbox or GitHub permission rule.
Workers cannot approve themselves by writing JSON. The supervisor captures fresh
review/proof sessions and stores signed receipts outside the worker checkout. The
signature detects substitutions within that workflow; someone controlling the host
or its credentials can bypass it. Master branch protection is not changed here.

## Bootstrap and trusted policy

First merge/review this implementation through the existing human-approved process.
Then run `scripts/landing_gate.py` from a separate, clean checkout of the approved
default branch. Fetch origin before use. Controller, routing, and review-role files
must match `origin/master`; a candidate PR's edited gate cannot authorize itself.
The controller uses the existing Claude subscription CLI and `gh` authentication.
There is no API-key fallback or new SDK.

The candidate checkout must be clean and at the evidence head SHA. Keep evidence
and the receipt store outside it, in separate supervisor-owned directories. Do not
mount the receipt store/key into worker containers. Filesystem separation here
does not establish Windows ACL protection against another process as the same user.

## Evidence

Create `evidence.json` in the external evidence directory. Paths are relative to
that directory; traversal, missing artifacts, and hash changes block landing.
Use actual observed results and full Git SHAs. No command strings in this record
are executed by the gate. The independent verifier must inspect raw logs and tests
and decide whether the reported failure actually demonstrates the claimed behavior.

```json
{
  "schema_version": 1,
  "repo": "imankha/video-editor",
  "pr": 123,
  "base": "<40-character current master SHA>",
  "head": "<40-character PR head SHA>",
  "mode": "behavioral",
  "criteria": [
    {"id": "C1", "description": "Reject stale CI", "artifacts": ["test", "red", "green"]}
  ],
  "artifacts": {
    "test": {"path": "test.py", "sha256": "<hash>"},
    "red": {"path": "red.log", "sha256": "<hash>"},
    "green": {"path": "green.log", "sha256": "<hash>"}
  },
  "tests": [
    {"criteria": ["C1"], "test": "test", "red_log": "red", "green_log": "green",
     "before": "<same base SHA>", "after": "<same head SHA>",
     "red_exit": 1, "green_exit": 0,
     "red_reason": "Assertion failed: stale CI was incorrectly accepted",
     "same_test_hash": "<same test artifact hash>"}
  ],
  "human_checks": []
}
```

Tests written after the implementation must provide the same counterfactual proof.
Include commands, environment, test content, assertions, exit codes, and provenance
in the hashed logs. Red due to syntax/import/environment failure is not sufficient.
For documentation-only diffs use `mode: documentation`, appropriate artifacts, and
`tests: []`; the gate requires both independent verdicts and a recorded user decision.
It does not demand fabricated failing application behavior for documentation.

## Commands

All commands below run from the trusted controller checkout. Substitute actual
absolute paths. `capture` starts a fresh Opus CLI process, not the implementation
session. The proof verifier must independently reproduce decisive checks. A quota,
authentication, structured-output, or reproduction failure cannot create approval.

```text
python scripts/landing_gate.py capture --role reviewer --checkout <candidate> --evidence <external/evidence.json> --store <external-receipts>
python scripts/landing_gate.py capture --role proof-verifier --checkout <candidate> --evidence <external/evidence.json> --store <external-receipts>
python scripts/landing_gate.py check --checkout <candidate> --evidence <external/evidence.json> --store <external-receipts>
python scripts/landing_gate.py land --checkout <candidate> --evidence <external/evidence.json> --store <external-receipts>
```

`check` does not merge. `land` repeats evidence and live GitHub checks, then uses
`gh pr merge --match-head-commit` for the exact verified revision. Neither command
deletes the checkout or archives it. Archive/cleanup enforcement is later work.

When the user has actually supplied a required human-only verdict or authorized a
documentation merge, the supervisor can record their exact message:

```text
python scripts/landing_gate.py record-human-decision --message-file <actual-user-message.txt> --checkout <candidate> --evidence <external/evidence.json> --store <external-receipts>
```

This is a supervisor attestation of an existing user decision, not a way to invent
one. It cannot waive red-to-green proof, independent review, or applicable CI for
behavioral changes. No `force` or `skip-proof` option exists.

## What blocks landing

- Missing/invalid/stale receipt, same review/proof session, missing criterion coverage.
- Changed candidate revision, base, evidence, captured output, or trusted controller.
- Unresolved blocking/major findings or required human-only observation.
- Wrong-repository, wrong-head, wrong-workflow, pending, cancelled, failed, skipped,
  or missing applicable CI; ambiguous job names or manifest.
- CI routing differs from the trusted policy, including suppressed required jobs.
- Workflow/controller changes lack explicit independent policy review.

Expected jobs come from trusted `ci_policy.py`, not worker assertions. The routing
artifact binds the actual CI run to base/head and policy. Hashes are integrity checks,
not signatures of CI job meaning: independent review must assess altered workflow
commands. Current receipts depend on a trusted host; no GitHub App publisher is added.

The head precondition prevents a different PR commit being merged. Rechecking master
reduces but cannot eliminate a simultaneous base-update race. Strict protected-branch
checks or a merge queue are needed for that stronger guarantee; both remain explicit
later rollout decisions. Direct UI/CLI merges can still bypass this local command.

## Validation

Run `python scripts/test_ci_policy.py` and `python scripts/test_landing_gate.py`.
Tests cover pure decisions, actual temporary Git checkouts, signed receipt/artifact
tampering, manifest changes, and head movement between check and land. GitHub transport
is fake in those boundary fixtures, so they do not prove server-side enforcement.
Use a real PR to exercise the read-only GitHub transport and workflow integration;
capture/live model behavior must be separately validated when subscription quota permits.
