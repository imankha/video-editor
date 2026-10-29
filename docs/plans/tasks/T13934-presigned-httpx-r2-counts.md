# T13934: Count server-side presigned-URL R2 fetches in the usage attribution

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

Some backend code fetches R2 objects through presigned URLs with `httpx` (games.py, downloads.py,
clips.py, projects.py, shares.py -- about 13 sites, see T13930-design.md sec 3). Those bypass the botocore
hook, so T13930 does not count them. Browser presigned traffic stays out of scope.

## Solution

Route those fetches through one shared `httpx` client (or response event hook) that calls
`r2_usage.record_r2_call` with the op inferred from the method (GET -> GetObject, HEAD -> HeadObject,
PUT -> PutObject) and the current `r2_source`.

## Context

- Parent: [T13930-r2-usage-attribution.md](T13930-r2-usage-attribution.md), design [T13930-design.md](T13930-design.md)
- Knowledge docs: `.claude/knowledge/backend-services.md`, `.claude/knowledge/persistence-sync.md`

## Acceptance Criteria

- [ ] A server-side presigned GET is counted under the issuing route template as Class B GetObject.
- [ ] Grep proves no remaining server-side presigned `httpx` call bypasses the shared hook.
