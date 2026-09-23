# Stage 7: Task Complete

## Purpose

Finalize the task after automated proof or, when required, the user's manual verdict. Clean up artifacts and apply the landing policy in `CLAUDE.md`.

## Checklist

### 1. Final Cleanup

**Remove any remaining artifacts:**
- [ ] Implementation comments (e.g., `// T06: moved here`)
- [ ] Temporary logging added during development
- [ ] Debug variables or test data
- [ ] Unused imports from refactoring

**Verify clean code:**
```bash
# Check for console.log (frontend)
grep -r "console.log" src/frontend/src --include="*.jsx" --include="*.js" | grep -v node_modules | grep -v ".test."

# Check for print statements (backend)
grep -r "print(" src/backend/app --include="*.py" | grep -v "__pycache__"
```

### 2. Test Evidence Gate

Before declaring complete, show actual test output (pass/fail counts from the real run), not a claim that tests pass. If any test was skipped or is flaky, say so explicitly. A task without test evidence is not complete.

### 3. Update the Knowledge Base

Update the `.claude/knowledge/*.md` doc(s) for every domain this task touched:
- [ ] New/moved entry points, changed data flow
- [ ] Invariants added or removed
- [ ] Landmines discovered during the task (the thing that cost you an hour goes here)
- [ ] Move the task from "Active/upcoming work" to a one-line entry in "Landmines & history" if it changed behavior
- [ ] Prune any lines the task made stale

This is how the next agent skips re-exploration. Commit the knowledge-doc edits with the task.

### 4. Commit Final Changes

Stage explicit paths (never `git add -A` / `git add .` — the working tree is shared and may hold unrelated WIP).

```bash
git add <changed files>
git commit -m "$(cat <<'EOF'
T{id}: {final cleanup summary}

Co-Authored-By: {actual agent identity} <{appropriate attribution email}>
EOF
)"
```

Do NOT mark the task DONE in this commit. DONE is a user promotion (see CLAUDE.md Task Status Rule).

### 5. Land or Hand Off

Push the branch through the supervisor and wait for Branch CI. Apply `CLAUDE.md`'s Landing
Policy:

- Independent Proof Verifier VERIFIED verdict, resolved code findings, and green CI for the same final SHA: create and merge the PR, then set
  `STAGING` and report the evidence.
- Human-only verification: set `WAITING ON USER`, leave the branch open, and report exact
  verification steps and the expected result.

---

## Merge -> STAGING

When the task branch lands on master — either through the proof-based automatic path or after
the user's manual verdict — set that task's Status to `STAGING` in `docs/plans/PLAN.md`.
Pushing to master auto-deploys staging, so STAGING is factually true at that point.

**Waves.** When several task branches are collapsed into one `integration/*` branch, verify the integrated revision and refresh affected evidence under Landing Policy. Set `WAITING ON USER` only for a required human verdict; otherwise keep active verification `WIP`. When the integration branch lands on master, its tasks go `STAGING` together. Do not record the integration branch name in PLAN.md; it belongs in operational handoffs/WAVE.md: the board derives it from the `T{id}:` commit subjects it carries, which is why those subjects are mandatory.

After merge the user will (optionally) delete the feature branch, verify on staging, then promote `STAGING -> DONE` via the task board "Resolve" button. Being on staging is the test phase — there is no separate TESTING step.

## Summary

For L-tier, the applicable workflow includes (S/M use their shorter paths):
1. **Task Start** - Branch created, knowledge loaded, Code Expert used if needed
2. **Architecture** - Design doc created, user approved
3. **Test First** - Failing tests created for acceptance criteria
4. **Implementation** - Code written following approved design
5. **Automated Testing** - Tester ran tests, all passing
6. **Verification** - Automated proof, or a user verdict when proof is impossible
7. **Task Complete** - Cleanup done and landing policy applied
