# Supervisor landing gate

This gate only runs when `/dotask` is invoked with `--capture`; the default `/dotask` flow
pushes, waits for green CI, builds an evidence directory with `scripts/dotask_evidence.py`,
and hands the PR to the user without running anything below (see the dotask SKILL's
`--capture` section). The gate is a trusted-supervisor command, not a sandbox or GitHub
permission rule.
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
absolute paths. `capture` starts a fresh Sonnet CLI process, not the implementation
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

## Resolved: reviewer captures using the wrong verdict word (T11310)

**History.** `REPORT_SCHEMA` originally listed both roles' vocabularies in one shared
`verdict` enum (`VERIFIED, MORE_PROOF_REQUIRED, HUMAN_VERIFICATION_REQUIRED, APPROVED,
NEEDS_REVISION`) and the `capture()` prompt did not spell out which words belonged to
which role. A `capture --role reviewer` session was repeatedly observed returning
`verdict: "VERIFIED"` (the proof-verifier's word) instead of the correct
`APPROVED`/`NEEDS_REVISION`, even with clean review content (0 blocking, 0 major) —
`check` then refused with `Code review has not approved` on a vocabulary technicality.
Observed 2026-09-25 landing T11210/T11170 (4 consecutive mis-worded captures on one
PR) and again 5+ times landing T11320, where a narrow interim mitigation was authorized
mid-landing: `evaluate()` temporarily accepted `verdict in ('APPROVED', 'VERIFIED')`
for the reviewer role. That widened the reviewer's accepted vocabulary rather than
constraining it, so it was never the real fix.

**Structural fix (T11310, pending-landing as of 2026-10-03).** `REPORT_SCHEMA` is
replaced by a per-role `report_schema(role)`: the `reviewer` role's verdict enum is
`APPROVED`/`NEEDS_REVISION` and the `proof-verifier` role's is
`VERIFIED`/`MORE_PROOF_REQUIRED`, so the model literally cannot emit the other role's
word at generation time. `HUMAN_VERIFICATION_REQUIRED` is intentionally valid for both
roles (T10860). The `capture()` prompt now also names each role's required verdict
words (defense in depth), and `evaluate()`'s interim `('APPROVED', 'VERIFIED')`
tolerance for the reviewer role is reverted to strict `APPROVED` (plus the T10860
`HUMAN_VERIFICATION_REQUIRED` allowance when a human decision is recorded). This note
will read "resolved" outright once the supervisor confirms the merge; until then treat
it as landed-pending-merge.

**If a review still comes back wrong,** recapture — a fresh session, same evidence —
rather than hand-editing a receipt; each attempt is independent, so retrying costs a
session but never compromises the gate. If the evidence file's content changes for any
reason (for example fixing a criteria-coverage gap), every prior capture for it is void
regardless of its verdict word: the receipt store keys by the evidence file's content
hash, so a changed evidence file needs fresh captures under both roles. Recapture is
the right move for a genuinely wrong verdict (`NEEDS_REVISION`, `MORE_PROOF_REQUIRED`,
or nonzero blocking/major) — the schema fix only removes the cross-role spelling slip.

## Proof for Postgres-backed tests

A task whose red/green tests use the `pg_conn` fixture (real Postgres) cannot be
proven with an unreachable placeholder `DATABASE_URL` — `pg_conn` needs a live
connection, so an unreachable DSN produces a connection error, not the target
assertion failure. It also refuses staging/prod DSNs by keyword, but does **not**
refuse the shared local dev instance (`reel-ballers-postgres-dev`, port 5432) —
pointing an isolated base/head proof comparison at it risks dropping or mutating
real dev data via the fixture's own `DROP TABLE ... CASCADE` and cleanup.

Use a disposable, throwaway Postgres container instead, mirroring CI's own `ci_test`
setup:

```bash
docker run -d --name <slug>-proof-pg -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ci_test -p <free-port>:5432 postgres:16-alpine
# wait for pg_isready, then point both isolated checkouts' test runs at
# DATABASE_URL=postgresql://postgres:postgres@localhost:<free-port>/ci_test
docker rm -f <slug>-proof-pg   # once the proof is captured or the task lands
```

Never reuse a proof container's data across a different task's proof run without
confirming the schema is clean; a fresh container per proof session is simplest.

## Validation

Run `python scripts/test_ci_policy.py` and `python scripts/test_landing_gate.py`.
Tests cover pure decisions, actual temporary Git checkouts, signed receipt/artifact
tampering, manifest changes, and head movement between check and land. GitHub transport
is fake in those boundary fixtures, so they do not prove server-side enforcement.
Use a real PR to exercise the read-only GitHub transport and workflow integration;
Live capture was also exercised through the production CLI in disposable Git controller
and candidate fixtures: a fresh Claude session returned MORE_PROOF_REQUIRED for
deliberately incomplete proof, and its stored receipt passed integrity validation.
This validates capture, structured output, and receipt storage; it is not a live
GitHub merge test or proof of general agent quality.

## Coherent multi-task candidates and usage

One PR may integrate multiple related tasks. Include `task_ids` and namespace criteria
by task ID (`T123:C1`; the gate rejects an unprefixed criterion or a listed task with no
criterion); provide unchanged-test red/green evidence for every task and interaction
checks for the integrated head. One captured Sonnet reviewer and a distinct Sonnet
proof-verifier cover the whole candidate. Missing criteria or stale receipts still block.
Set `DOTASK_WAVE_ID` for capture; usage is written best-effort to `<store>/profiles/` and
can never create, block or alter a receipt.
Routine duplicate pre-landing reviews are unnecessary. Opus is reserved for a separate,
focused design/root-cause consultation, never the routine capture command.
