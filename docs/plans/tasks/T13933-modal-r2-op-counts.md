# T13933: Count Modal containers' R2 operations in the usage attribution

**Status:** WIP
**Impact:** 5
**Complexity:** 4
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

T13930's counts cover only the backend process's boto3 clients. Modal functions
(`app/modal_functions/*`) download and upload directly to R2 with their own clients, so render and
upscale traffic is invisible in the per-source usage.

## Solution

Have each Modal function count its own R2 ops (op name + class, same table as `app/r2_usage.py`,
mirrored self-contained since the Modal image cannot import `app`) and return them in the job result;
the backend credits them under `modal:{function}` when it records the result. Needs a Modal redeploy
(staging first, then prod, per src/backend/CLAUDE.md).

## Context

- Parent: [T13930-r2-usage-attribution.md](T13930-r2-usage-attribution.md), design [T13930-design.md](T13930-design.md)
- Knowledge docs: `.claude/knowledge/backend-services.md`, `.claude/knowledge/persistence-sync.md`

## Acceptance Criteria

- [ ] A Modal render's R2 downloads/uploads appear under `modal:{function}` in analytics.sqlite.
- [ ] Old Modal deploys that return no counts are tolerated without fabricating zeros (logged).
