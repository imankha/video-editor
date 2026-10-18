# T13080: Clip size limit modal did not appear for an oversize clip upload (verify)

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Tier:** S (frontend; verify first)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

With the bootstrap `max_clip_upload_bytes` mocked to 1 MiB, setting a 45 MB file on the Clips upload input did not show `clip-size-limit-modal` within 15 s. The mock may not reach where the limit is read, so this is unconfirmed.

## Solution

Check where the client reads the clip size limit, then reproduce with a real oversize file against the real limit (or a correct mock). If the modal does not show, fix it; otherwise close as a test-setup artifact.

## Context

### Relevant Files
- `src/frontend/src/` clip upload input and `clip-size-limit-modal`

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

## Acceptance Criteria

- [ ] An oversize clip shows the limit modal before any upload starts
- [ ] A test covers it with the limit read from its real source
