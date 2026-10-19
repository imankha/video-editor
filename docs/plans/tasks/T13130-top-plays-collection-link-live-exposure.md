# T13130: Say in the Top Plays share copy that the link includes every current top highlight

**Status:** TODO
**Impact:** 3
**Complexity:** 1
**Tier:** S (copy only)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T9720 staging release check, 2026-10-18 ([T9720-RESULTS.md](../ux/2026-10-18-release-check/T9720-RESULTS.md)). Screenshots are local only, in the session scratchpad `t9720/shots/` on the host that ran the check.

## Problem

The Top Plays collection share link is live: its copy says it "always shows the current top highlights", and during the check the shared collection grew from 4 to 7 members. If a highlight that the user finished but never shared enters the top set, anyone holding an old collection link can see it. This is inferred: every test highlight had already been shared when it was checked.

## Solution

**User decision 2026-10-18**: the live link is intended. A Top Plays link always shows the current top highlights, including ones never shared individually. No behavior change. Make the share copy say so plainly at the moment the link is created (for example: "Anyone with this link sees your current top highlights, including new ones you finish later").

## Context

### Relevant Files
- Collection share endpoint and membership query (backend)
- Collection player (frontend)

### Related Tasks
- Found by T9720 (2026-10-18)

## Acceptance Criteria

- [ ] The Top Plays share copy states that the link includes new top highlights, shared or not
- [ ] No change to collection membership
