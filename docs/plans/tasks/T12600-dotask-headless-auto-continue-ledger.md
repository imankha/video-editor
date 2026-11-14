# T12600: Headless workers can ask a question

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-10-12
**Updated:** 2026-11-13

## In plain words

A headless /dotask worker that needs an answer from the owner can only stop, and the owner finds out at the next status check. Give workers a way to ask a tagged question that the owner answers and the worker then resumes from. Also sort stops into out of quota, passing fault and hang, and show counts by outcome in the status, so we can see how often and why a task needs a person. Land it between runs, since live groups use these scripts.

## Implementer details

- Already exists in `scripts/dotask_cli.py` and `scripts/task.sh`: headless by default, a `resume` subcommand, a per-phase wall-clock cap, `budget_stop` detection, design-gate refusal at start, stop words, AUTH_DEAD with retry, and a per-dispatch JSON record with `outcome_class` (`scripts/wave_profile.py`).
- Missing: a worker-side `NEEDS_USER <kind>` protocol with a closed list of kinds (only the verifier has `VERIFY_NEEDS_USER`); an answer relay through `--resume <session-id>`; `blocked:quota`, `blocked:transient` and `blocked:hang` classes; a no-progress watchdog; a guard against a stray `ANTHROPIC_API_KEY`; a counts-by-outcome summary in `status`.
- Update `.claude/skills/spawn-worker/SKILL.md` and `.claude/skills/dotask/SKILL.md` in the same PR. Never edit `task.sh` while a group is running.

## Acceptance Criteria

- [ ] A worker that prints a tagged question stops with that question shown in `/dotask status`, and an answer given through resume reaches the same conversation.
- [ ] A quota stop, a network fault and a hang each get their own outcome class in the run record.
- [ ] `/dotask status` shows counts by outcome over recent runs.
