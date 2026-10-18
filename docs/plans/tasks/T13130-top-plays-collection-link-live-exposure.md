# T13130: Top Plays collection link is live and may expose highlights never shared (verify)

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** M (backend share membership; verify first)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T9720 staging release check, 2026-10-18 ([T9720-RESULTS.md](../ux/2026-10-18-release-check/T9720-RESULTS.md)). Screenshots are local only, in the session scratchpad `t9720/shots/` on the host that ran the check.

## Problem

The Top Plays collection share link is live: its copy says it "always shows the current top highlights", and during the check the shared collection grew from 4 to 7 members. If a highlight that the user finished but never shared enters the top set, anyone holding an old collection link can see it. This is inferred: every test highlight had already been shared when it was checked.

## Solution

Reproduce: share Top Plays, then finish a new high-rated highlight without sharing it, and fetch the old link signed out. If it appears, decide with the user whether a live collection may include unshared highlights; if not, limit membership to highlights the user has made visible, or freeze membership at share time.

## Context

### Relevant Files
- Collection share endpoint and membership query (backend)
- Collection player (frontend)

### Related Tasks
- Found by T9720 (2026-10-18)

## Acceptance Criteria

- [ ] A test proves whether an unshared highlight appears through an existing collection link
- [ ] Behavior matches the user's decision and the share copy says it
