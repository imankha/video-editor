# T17070: Marked plays expire with game

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

Once a parent has marked a play, that play is meant to stay usable even after the full game video's storage ends (the Home banner itself says "Your marked plays stay playable"). Today, when a game expires, its marked plays expire with it. Opening such a play's highlight in Frame shows "Game video expired. This game's video is gone because its storage ended, so this highlight can't be edited. Extend storage to keep editing." and the play's video request answers 410 "source_expired". Opening anything in Frame should never say "expired" (owner rule, 2026-11-17): a marked play keeps its own video and can be framed, sharpened again and spotlighted after the game is gone.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as e2e@test.local, at desktop 1440x900. The owner confirmed during the pass: "once a play is clipped it shouldn't expire" and "opening anything in framing should never say expired".

## Repro steps

1. Sign in as e2e@test.local at 1440x900.
2. Home, Highlights tab, open the "varA" group (game varA has storage status expired, 2 marked plays, not kept as "plays only").
3. On its highlight tile tap the menu, then "Edit highlight".

**Expected:** Frame opens the play's video with its box positions, ready to edit; no mention of expiry.
**Actual:** Frame shows "Game video expired ... can't be edited. Extend storage to keep editing." The first time (via the menu) a red card "This highlight has nothing to show. We couldn't find anything to frame for this play. Back to plays" also showed above it, with a live Portrait/Landscape chooser under it.
**Repeats:** "Game video expired" always (3 of 3, including reloads); the extra red card 1 of 3 (only on the first in-app open).
**Also checked at:** phone and iPad not checked for this screen.

## Evidence

- Screenshots: `qa/qa-pass-2026-11-17/bugs/r2-B10-expired-two-messages.png` and `.playwright-mcp/adv-42-edit-highlight.png` copied as `r2-B10-first-open.png` (local, not in git)
- Console: `Failed to load resource: 410 /api/clips/projects/6/clips/6/playback-url`; `[Framing] stuck with no video: project=6 missing=videoUrl`
- Network: GET /api/clips/projects/6/clips/6/playback-url -> 410 `{"detail":{"code":"source_expired","game_id":3,"can_extend":true}}`
- Server log: not pulled for this request.

## Solution

A marked play stays playable and editable in Frame after its game's storage ends, and Frame never shows an "expired" message.

## Relevant Files

Not investigated. Related history: Keep Only Marked Plays epic (T12910 to T12950).

## Acceptance Criteria

- [ ] C1: For a highlight whose game has expired, "Edit highlight" opens Frame with the play's video and no expiry message, at 1440x900.
- [ ] C2: The same at 390x844 and 768x1024; the play's playback URL no longer answers 410 for a marked play.
