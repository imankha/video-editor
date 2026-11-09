# Acceptance checks (/dotask)

One check per acceptance criterion, committed by the worker with its task (owner decision 2026-11-09).
The /dotask harness runs them before the PR, one reviewer reads each against its criterion's text, and
after merge `scripts/dotask_cli.py staging-check` runs the browser checks against staging.

- `T<id>.checks.json`: `{"criteria": {"T<id>:C1": {"kind": "browser"}, "T<id>:C2": {"kind": "code",
  "command": "<one grep or one targeted test file, run from the repo root>"}, "T<id>:C3": {"kind": "human",
  "why": "..."}}}`
- `T<id>.check.spec.js`: one Playwright test per `browser` criterion, its title starting with the id
  (`T<id>:C1 ...`). Log in with `loginForCheck(page)` and reach the API with `checkApi('/path')`, both from
  `../helpers/checkAuth`, so the same file runs on a dev stack and on staging. Read ids from the API.

Run one locally in a /dotask container: `bash scripts/dev-verify.sh e2e/checks/T<id>.check.spec.js --reporter=line`.
