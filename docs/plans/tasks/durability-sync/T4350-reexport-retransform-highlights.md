# T4350: Re-Export Must Re-Transform Carried-Forward Highlights

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [durability-sync](EPIC.md) · Audit item B7

## Problem

When a framing export creates a new working_videos row, it carries the previous version's `highlights_data` forward **verbatim** (`routers/export/framing.py:234-254`). But a re-export exists precisely because trim/speed/segments changed — highlight region times are expressed in working-video seconds, so after a re-export they point at the wrong moments (or beyond the new duration). The user's carefully placed highlights silently drift off their targets.

Exposure: edit-reel → re-export is the retention loop T4110 hardened; this is the same flow producing subtly-wrong output instead of lost output.

## Solution

Decide, then implement, one of (write the decision + rationale in the Progress Log before coding):

- **(a) Re-transform (preferred if feasible):** map each region's times through the old→new timeline transform. The transform math exists — `transform_all_regions_to_working` is already imported in overlay.py; check whether the framing export has enough information (old segments vs new segments) to compose old-working→raw→new-working. If segments/trim data for BOTH versions is available at carry-forward time, this is deterministic.
- **(b) Drop + notify:** if the mapping is ambiguous (e.g., a highlighted moment was trimmed out), drop affected regions and surface "N highlights need re-placement" in the overlay screen rather than carrying wrong ones. Hybrid allowed: transform what maps cleanly, flag what doesn't.

Never carry verbatim when timing changed — that's the only banned outcome.

## Context

- Files: `src/backend/app/routers/export/framing.py:234-254`, `src/backend/app/services/highlight_transform.py` (read fully first — it owns raw↔working time mapping and has canonicalization history), `routers/export/multi_clip.py:1387-1415` (detection-seed writer, for contrast)
- Depends on understanding T4340's canonical segments format — implement after it if possible (transform math reads boundaries).

## Steps

1. [ ] Read highlight_transform.py + the carry-forward site; write the old→new mapping feasibility analysis in the Progress Log.
2. [ ] Tests first with concrete fixtures: trim moved by 2s → region moves by 2s; region inside a trimmed-out span → dropped/flagged; speed change → time scaling correct.
3. [ ] Implement chosen strategy; verify with a real re-export on dev (drive-app-as-user: place highlight → re-trim → re-export → highlight still on the action).

## Acceptance Criteria

- [ ] Re-export never carries verbatim highlight times across a timing change
- [ ] Mapped regions land on the same visual moment (manual dev verification recorded)
- [ ] Unmappable regions are dropped LOUDLY (user-visible), never silently wrong
- [ ] Fixtures cover trim-shift, trim-removal, and speed-change cases
