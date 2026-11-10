# T15350: dotask frees a merged group's container and app stack

## In plain words

Stop a finished group's container as soon as its PR merges so it stops using the host's cores. On staging.


**Status:** STAGING
**Impact:** 5
**Complexity:** 1
**Tier:** S (tooling: scripts/dotask_cli.py and its test)
**Created:** 2026-11-08
**Updated:** 2026-11-08

## Ruling

Owner 2026-11-08: "please free up all merged groups. we should do this on merge."

## Problem

A group's container and app stack stay up after its PR merges. On 2026-11-08 five merged groups
(g-t15230-1, g-t15200-1, g-t14940-1, g-t14930-3, g-t15280-3) kept their stacks running on a 4-core
host while three live groups ran slowly. Their containers also still counted as owning their files
in `start`'s overlap check.

## Solution

The merge happens on GitHub, so dotask frees a group the next time it runs after the merge: `status`
and `start` (before its overlap check) run `task.sh down` on any running group whose PR merged. The
checkout stays, and `task.sh nuke` clears it.

## Context

### Relevant Files (REQUIRED)
- `scripts/dotask_cli.py` - `free_group`, `status`, `start`
- `scripts/test_dotask_cli.py`
- `.claude/skills/dotask/SKILL.md`

## Acceptance Criteria

- [ ] `status` stops the container of a running group whose PR merged and says so; a stopped one is left alone.
- [ ] `start` frees merged groups before its overlap check.
