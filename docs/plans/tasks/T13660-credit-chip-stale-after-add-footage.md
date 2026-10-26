# T13660: Credit chip shows the old balance after Add footage until the page is reloaded

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Tier:** S/M (frontend credits store)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 3, 2026-10-26, 1440x900, game "game2-offline-test". Screenshot `.playwright-mcp/p3-addfootage-after.png` (chip reads 132).

## Problem

Add footage charges 2 credits (server balance 132 -> 130, `GET /api/credits` returns 130), but the header credit chip keeps showing 132 until a full reload. Other charges (game upload, Generate) did update the chip in this session.

## Repro steps

1. Open any game in Annotate, note the chip (title "N credits - click to buy more").
2. Add footage > choose a new small video > Add to this game. Wait for it to finish (game duration grows, "Video 1 of 2" appears).
3. Compare the chip with `GET /api/credits`.

**Expected:** chip shows N-2 as soon as the footage is added.
**Actual (before fix):** chip still shows N; correct only after reload.

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro, record chip vs API values; write a test that the add-footage success path refreshes the balance; see it fail.
2. **After the fix:** same steps on a new file: chip equals API immediately.

## Acceptance Criteria

- [ ] Chip updates right after Add footage (check every charging flow: upload, add footage, Veo game, generate)
- [ ] Test fails before, passes after
