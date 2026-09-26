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

## Known issue: reviewer captures sometimes use the wrong verdict word

`REPORT_SCHEMA`'s `verdict` enum lists both roles' vocabularies together
(`VERIFIED, MORE_PROOF_REQUIRED, HUMAN_VERIFICATION_REQUIRED, APPROVED, NEEDS_REVISION`),
and the `capture()` prompt does not spell out which words belong to which role. A
`capture --role reviewer` session has been observed to return `verdict: "VERIFIED"`
(the proof-verifier's word) instead of the schema-correct `APPROVED`/`NEEDS_REVISION`,
even when the review content itself is clean (0 blocking, 0 major) — `check` then
refuses with `Code review has not approved` on a vocabulary technicality, not a real
finding. Observed 2026-09-25 landing T11210 and T11170: 4 consecutive mis-worded
reviewer captures on one PR before a correctly-worded one landed.

**Do not hand-edit a receipt to fix this.** Recapture — a fresh session, same
evidence — until the verdict word matches the role; each attempt is independent, so
retrying costs a session but never compromises the gate. If the evidence file's
content changes for any reason (for example fixing a criteria-coverage gap), every
prior capture for it is void regardless of its verdict word: the receipt store keys
by the evidence file's content hash, so a changed evidence file needs fresh captures
under both roles, not just the one that changed. See T11310 for the real fix
(split the schema per role or state the literal required word in the prompt) — this
touches the trusted controller, so route it through independent policy review rather
than hotfixing mid-landing.

**2026-09-26 interim mitigation (landing T11320):** the bug recurred 5+ times in one
landing on top of the earlier T11210/T11170 occurrences, and the user explicitly
authorized a narrow direct fix mid-landing rather than more retries: `evaluate()`
now accepts `verdict in ('APPROVED', 'VERIFIED')` for the reviewer role. Recapturing
is no longer strictly necessary purely for the wrong word — `check()` accepts either
spelling now. **This is explicitly not T11310's real fix** — it widens the reviewer's
accepted vocabulary rather than constraining it, so a reviewer session that drifts
into the proof-verifier's whole mental model (not just its one word) would now also
pass. T11310 stays open for the structural fix (schema split per role). Recapturing
is still the right move if a review comes back with a genuinely wrong verdict
(`NEEDS_REVISION`, `MORE_PROOF_REQUIRED`, etc., or nonzero blocking/major) — this
mitigation only affects the specific `APPROVED` vs `VERIFIED` spelling ambiguity.

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
