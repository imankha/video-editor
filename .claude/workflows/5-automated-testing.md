# Stage 5: Automated Verification

Follow CLAUDE.md Test Scope Policy and `.claude/skills/run-tests/SKILL.md`.
The driver may verify S/M work directly; use `subagent_type: tester` when
classification includes a Tester. L performs final verification after review fixes.

1. Read task criteria, approved design when applicable, and implementation/review
   evidence. Name the curated feature, regression, affected-consumer, and E2E set.
2. Add missing behavioral coverage for acceptance criteria/failure modes, not a
   blanket test-per-function or arbitrary coverage percentage.
3. Run named tests and applicable lint/build checks. Record revision, command,
   exit code, counts, and log/evidence paths. Hook silence is not lint evidence.
4. On failure, distinguish production bug, incorrect test, environment failure,
   and substantiated pre-existing failure. The implementor fixes production code.
   Rerun failing tests and tests affected by the fix; use the expert after one
   failed focused correction. Never weaken assertions merely to pass.
5. Drive changed user flows live per spawn-worker/drive-app-as-user and map each
   criterion to an observation/test. Include mobile and desktop for UI changes.
6. Return passed/failed/skipped/unverified cases explicitly. A curated set passing
   does not mean every suite passed. Branch CI runs full affected-layer unit suites;
   Master CI checks the merged state. Neither replaces task-specific E2E evidence.

Example commands (resolve real paths for the task):

```bash
cd src/frontend && npx vitest run <named-test-files>
cd src/frontend && npx playwright test <named-spec>
cd src/backend && python -m pytest <named-test-files> -v --tb=short --capture=sys
```

Use CLAUDE.local.md for environment-specific Python paths. Destructive fixtures
require an authorized disposable database, even inside a container.

Before landing, a separate `subagent_type: proof-verifier` examines the final revision
and red/green evidence under CLAUDE.md Landing Policy. It may require additional proof.
The orchestrator stages only assigned paths and commits the verified changes.
Apply CLAUDE.md Landing Policy. Stage 6 is conditional on unresolved human-only
verification; a passing local test does not itself authorize merging.
