# T16760: Frame portrait preview too tall

**Status:** WIP
**Impact:** 3
**Complexity:** 2
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

**Today.** In Frame, Preview shows what stays in view after cropping. For a portrait (9:16) highlight on a common laptop window (1440 by 900), the preview player is 835 pixels tall. Its lower part and its play controls sit below the window, under the fixed bar with "Sharpen my highlight".

**The problem.** Found in the staging QA pass on 2026-11-16. With Preview on, the player ran from 198 to 1033 pixels and its controls to 1075, while the window is 900 tall and the bottom bar starts at 812. The parent sees only the top two thirds of their crop and no controls until they scroll the panel, and scrolling with the mouse over the video does not scroll the page.

**What we will do.** Size the portrait preview to fit the space between the header and the bottom bar, so the whole crop and its controls show without scrolling.

**Why this and not something else.** The normal Frame view already fits the same window. Only the portrait preview grows to the column width.

**How we will know it worked.** At 1440x900 and 1366x768, with Preview on for a portrait highlight, the whole preview and its controls are visible above the bottom bar.

## Evidence (staging, build 94928afa1)

- Project 13, viewport 1440x900. Preview container `video-player-container` 470x835 at top 198; bottom bar top 812; scroll container `flex-1 overflow-auto` scrollHeight 1555.
- Screenshots (local, gitignored): `.playwright-mcp/qa-25-preview.png`, `qa-26-preview-scrolled.png`.

## Implementer notes

- Frame screen preview layout under `src/frontend/src/screens/` and `src/frontend/src/modes/` (framing mode view). See `.claude/knowledge/keyframes-framing.md`.

## Acceptance Criteria

- [ ] Portrait preview and its controls fully visible above the action bar at 1440x900 and 1366x768 (browser check on bounding boxes).
- [ ] Landscape preview and mobile layouts unchanged.
