# T18020: Deploy archive step removes the headers of sections that still have work

## In plain words

After a production deploy, the tasks that shipped are moved out of the plan into the archive, and a section left with no tasks gets one line saying its rows were archived. On the 2026-11-20 deploy that line was also written into 10 sections that still had tasks, in place of the table's two header lines. A table with no header cannot be read by the task board, so those sections vanished from it: AI Coach, the Referral programme, the Highlight reel builder and seven more. The owner opened the board and the AI Coach milestone was gone. No task was lost and no unfinished row was archived; the headers were put back by hand the same day (commit `b5f2813c9`). The archive step is done by the AI following written instructions, with nothing that checks the result, so the same mistake can happen on the next deploy. We will add a check that runs before the deploy's plan commit and refuses a plan in which any section has task rows without a header, or the "all complete" line next to task rows. Done when a plan with that mistake fails the check, and the deploy instructions say to run it.

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** S
**Created:** 2026-11-20

## Problem

`.claude/skills/deploy/SKILL.md` Step E tells the AI to move promoted rows to `docs/plans/PLAN-archive.md` and, when a section empties, to replace its table with the archive-pointer line. On 2026-11-20 (commit `968aed43c`, 192 rows promoted) the pointer line replaced the header and separator rows of 10 tables that still held live rows. Every one of those sections starts with an epic row (a row with an empty ID cell), which is the likely trigger: the section looked empty of task ids near the top.

Every removed row was STAGING or DONE; the damage was the headers only.

## Solution

1. A small check, `scripts/check_plan_tables.py`: for every section of `docs/plans/PLAN.md`, a line starting with `|` must belong to a table that begins with the header row and the separator row, and the "All tasks in this section are complete" line must not be followed by a table row. It prints the section heading and line number of each failure and exits non-zero.
2. Step E of the deploy skill runs the check before its auto-commit and fixes what it reports; the instruction for the pointer line is reworded to "only when the section has no table rows left, epic rows included".
3. Branch CI runs the check wherever plan edits are routed today (the `tooling` or instructions job), so a hand edit cannot break the board either.

## Why this and not something else

Scripting the whole archive move would remove the cause, but it is a larger task and the reconciliation in Step E has judgement in it. A check on the result is ten times smaller and catches the same damage from any source.

## For the implementer

### Relevant Files (REQUIRED)
- `scripts/check_plan_tables.py` (new) and its test under `scripts/`
- `.claude/skills/deploy/SKILL.md` (Step E)
- `scripts/ci_policy.py` (route the new script and its test to the job that runs them)
- `docs/plans/PLAN.md`, `docs/plans/PLAN-archive.md` (read only; fixtures are copies)

### Technical Notes
- Reproduce with `git show 968aed43c:docs/plans/PLAN.md`: the check must report 10 sections on that revision and none on `b5f2813c9`.
- The board's own parser is the reader that matters; if it exposes a parse function, the test should feed it both revisions too.

## Acceptance Criteria

- [ ] The check fails on the plan as committed in `968aed43c`, naming all 10 sections, and passes on the plan as committed in `b5f2813c9`.
- [ ] The deploy skill's Step E runs the check before committing and says the pointer line is written only when a section has no table rows left.
- [ ] Branch CI runs the check on a change to `docs/plans/PLAN.md`.
