# T5654: Annotate reads the proxy (LRF)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-20
**Epic:** [Multi-File Ingest & Prep](EPIC.md) (task 4/7)

## Epic Context
See [EPIC.md](EPIC.md) + study section 0. Annotate = finding clip in/out points; that needs to see
the play, not pixel detail, so it runs on the 720p proxy (fast scrub, cheap streaming).

## Problem
Annotate currently streams the single game video. For dual-asset games it must stream the **proxy**,
while clip in/out times still map exactly to the master for later conform.

## Solution
- Annotate video source resolves to the game video's **proxy ref** (T5651) when present, else the
  single asset (backward compatible).
- Clip in/out are stored as timeline times that are valid against BOTH assets (proxy and master are
  frame-aligned by T5653), so no remap is needed for conform.

## Context
### Relevant Files
- `.claude/knowledge/annotate.md` (load first). Annotate screen/container + video source hook.
- Game-video ref resolution from T5651.

### Related Tasks
- Depends on T5651 (proxy ref) + T5653 (aligned assets). Pairs with T5656 (markers seed candidates).

### Technical Notes
- No behavior change for existing single-asset games. Times must stay master-valid (frame-aligned
  proxy is the invariant that makes this safe - assert frame-count equality on load).

## Acceptance Criteria
- [ ] Dual-asset games annotate on the proxy; single-asset games unchanged.
- [ ] Clip in/out times conform correctly against the master downstream (T5655).
