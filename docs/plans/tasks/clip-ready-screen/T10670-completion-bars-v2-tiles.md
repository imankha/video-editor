# T10670: Completion bars: V2 celebration tiles, headline + Saved chip, "Done for now"

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-19
**Updated:** 2026-09-19
**Epic:** [Clip Ready Screen](EPIC.md) (1/2)

## Problem

After a framing render the completion footer shows: a green sentence "Saved to your drafts. Only
you can see it.", three equal-looking cards each holding a pill button plus a two-sentence italic
caption, then a "Save draft" ghost link with its own caption saying it is already saved. The user
(2026-09-19): the saved/only-you line plus the Save draft link plus its caption are confusing, and
the three real choices "don't look fun", the UI needs "more pop". On a phone the footer is about
520px tall, so the 9:16 video it is supposed to celebrate gets whatever height is left.

## Solution (APPROVED design: V2 Celebration tiles)

Everything is specified in [design-proposal.md](design-proposal.md) sections B, C, D, F; the
mockup the user approved is https://claude.ai/artifact/9w4SKRvSbdNzMLpwFxNWKF (variant V2 pane,
desktop and phone toggles). Implement it exactly. Summary:

1. **Headline row** above the grid: `FOCUS_PUBLISH.HEADLINE` / `OVERLAY_PUBLISH.HEADLINE`
   ("Your clip is ready", `text-lg sm:text-xl font-semibold`, one-shot `readyIn` rise) with the
   retention note rendered as a **one-word chip** ("Saved", `Check` icon, green-500/10 fill,
   `chipIn` pop at 120ms) instead of the green sentence. `data-testid="focus-retention-note"` /
   `"overlay-retention-note"` stays on the chip.
2. **The tile IS the button.** Delete the inner pill `<Button>` in each card. The card `div`
   keeps `role="button"`, `tabIndex={0}`, the existing `handleCardKeyDown` (Enter/Space), and
   gains `aria-labelledby` (title span) + `aria-describedby` (caption span). Each tile: icon disc
   (56px at lg, 48px on phones; tertiary 48/44) + bold nowrap title + one short roman caption.
   Exact class strings per tile per state (default / hover / focus-visible / pressed / loading)
   are in proposal section C; copy them, do not re-derive.
3. **Hierarchy** (T9590, unchanged): Focus primary = Add spotlight (`Sparkles`), secondary =
   Publish without spotlight (`FolderInput`, carries `publishLoading` via `aria-disabled` +
   `Loader` in the disc, and `data-tutorial-target="focus-publish"` MOVES from the pill to this
   tile), tertiary = Edit framing (`Pencil`). Overlay primary = Publish (`FolderInput`,
   `data-testid="overlay-publish-now"` moves to the tile), secondary = Reapply spotlight
   (`Sparkles`), tertiary = Reapply Framing (`Crop`).
4. **Motion**, all `motion-safe:`, nothing loops: `tileIn` stagger 60/120/180ms, single
   `primaryPulse` 1.2s at 400ms on the primary tile only. Keyframes live in a `<style>` block in
   the bar (same pattern as `collectionPlayerTitleFade` in CollectionPlayer).
5. **Mobile**: tiles are horizontal rows (`flex-row` default, `lg:flex-col`), disc left, text
   right. Footer drops from about 520px to about 405px at 390x844.
6. **Exit link**: label `SAVE_DRAFT_LABEL` = "Done for now", icon `ArrowLeft` (not `Clock`),
   **no caption** (`SAVE_DRAFT_CAPTION` key deleted from both blocks). Handlers unchanged
   (`handleAddSpotlightLater` / `handlePublishLater` are navigation-only; the landing toast still
   names Clips/Reels).
7. **Copy**: paste proposal section B into `displayNames.js` verbatim (`FOCUS_PUBLISH`,
   `OVERLAY_PUBLISH`, `RESULT_RETENTION`). `STAGE_REASONS.PUBLISH` stays reused verbatim.
   `STAGE_REASONS.SPOTLIGHT` (the 22-kids sentence) is NOT deleted; it stays the Spotlight-mode
   reason line, it just stops being the Focus caption. No em dashes anywhere.
8. **Grid landmines (T8390) preserved byte-for-byte**: the grid class string
   `mx-auto grid w-full max-w-md grid-cols-1 gap-3 lg:max-w-4xl lg:grid-cols-[repeat(3,minmax(min-content,1fr))]`
   (gap may go 4 -> 3, nothing else), `rounded-xl` on every tile, titles inside
   `whitespace-nowrap`, NO `overflow-x-auto`. Verify no horizontal scrollbar at 1024, 1100 and
   1280px in a real browser (jsdom cannot see this).

Out of scope here (T10680): the play glyph and the header Play/Pause + Fullscreen buttons shown
in the mockup header. This task must not touch `CollectionPlayer.jsx`.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/FocusPublishActionBar.jsx` - rewrite per section C; update the header comment (record T10670 + the pill removal + the anchor move)
- `src/frontend/src/components/OverlayPublishActionBar.jsx` - mirror, Publish primary (section D)
- `src/frontend/src/config/displayNames.js` - `FOCUS_PUBLISH`, `OVERLAY_PUBLISH`, `RESULT_RETENTION` blocks (section B); update the block comments that describe the old layout
- `src/frontend/src/utils/resultRetentionNote.js` - no logic change; comment update (the note is now a chip). Its test stays green as-is if it asserts via the constants
- `src/frontend/src/components/FocusPublishActionBar.test.jsx` - see "Tests that must change"
- `src/frontend/src/components/OverlayPublishActionBar.test.jsx` - same
- `src/frontend/src/utils/focusPublishExit.test.jsx`, `overlayPublishExit.test.jsx` - use `SAVE_DRAFT_LABEL` via the constant; re-run, expect green
- `src/frontend/e2e/T8520-T8530-overlay-choice-and-publish.spec.js` (lines ~87, 137, 148) - `data-tutorial-target` count and `getByRole('button', {name, exact:true})` both still resolve on the tile via `aria-labelledby`; update caption assertions if any
- `src/frontend/e2e/T9110-overlay-publish-exit.spec.js` - Save draft -> Done for now (via constant if it imports it)
- `docs/plans/tasks/T9590-post-focus-choice-hierarchy.md` - append a pointer: pill removed, "Done for now" exception recorded
- `.claude/knowledge/export-pipeline.md` - Stage 7: post-export preview footer description

### Related Tasks
- Epic sibling: T10680 (player transport). File-disjoint; parallel OK.
- Reverses/updates: T9590 (pill primary; "quiet exit states its destination"), T9870 (sentence -> chip), T8390 (grid kept).
- Do NOT touch `FocusScreen.jsx` / `OverlayScreen.jsx` (owned by T10650/T10660 in flight).

### Tests that must change (from proposal section F)
- `getByRole('button', {name: FOCUS_PUBLISH.X_LABEL})` now resolves the tile (works because of `aria-labelledby`); assert `[role=button]` order primary -> secondary -> tertiary -> exit.
- `button.disabled` on loading becomes `aria-disabled="true"` on the Publish tile + `Loader` in its disc.
- "span.whitespace-nowrap inside every button" test queries tiles + the exit link.
- Retention-note test asserts the chip text (`RESULT_RETENTION.PRIVATE_DRAFT` === "Saved") and its omission when null.
- Caption assertions use the new strings; the `SAVE_DRAFT_CAPTION` assertion is deleted.
- `[class*="rounded-xl"]` card count (3), primary-first + cyan-in-class, grid string, no-overflow assertions stay as they are.

### Technical Notes
- Design gate already satisfied: the user approved the decision artifact 2026-09-19. Do not
  spawn the Architect; a Reviewer on the diff is required (this changes roles, anchors and copy
  that the guided tutorial and three e2e specs read).
- Reduced motion: every animation class is `motion-safe:`; `motion-reduce:transform-none` on tiles.
- Known pre-existing gap, log only: on an already-published re-export the Publish caption still
  says "Nobody else can see this until you share a link". Not fixed here.

## Implementation

### Steps
1. [x] Branch `feature/T10670-completion-bars-v2-tiles`
2. [x] `displayNames.js`: paste section B blocks; delete `SAVE_DRAFT_CAPTION` in both; grep proves no other reader
3. [x] Rewrite `FocusPublishActionBar.jsx` per section C (tile anatomy, class tables, keyframes, headline row, exit link)
4. [x] Mirror into `OverlayPublishActionBar.jsx` per section D
5. [x] Update the two unit test files + the two exit tests + the two e2e specs
6. [x] Real-browser check at 390, 1024, 1100, 1280px: no horizontal scrollbar, one row at lg+, rows on phone, motion plays once, hover lift, keyboard order, Enter/Space
7. [x] Reviewer on the diff; fix; curated relevant test set green; push; Branch CI green
8. [x] T9590 task-file pointer + knowledge doc line; commit with `T10670:` subject prefix

### Progress Log

**2026-09-19**: Filed from the approved design. Not started.

**2026-09-19 23:32**: Implemented via container worker (`reel-task-t10670`), commit `dd843785`.
Both action bars rewritten as tile-is-the-button celebration cards; headline + "Saved" chip;
"Done for now" exit; displayNames.js section B pasted verbatim; `SAVE_DRAFT_CAPTION` deleted.
52 relevant tests green, eslint clean. Reviewer APPROVED (0 blocking/0 major, 2 minor fixed).
Live-browser evidence at 390/1024/1100/1280px in `C:\work\tasks\t10670\qa\` (8 screenshots):
1-col @390 with footer 402px (<=420 target), 3-col no-overflow @1024/1100/1280,
`data-tutorial-target="focus-publish"` count = 1 on Focus / 0 on Overlay, primary + exit tiles
visible. Pushed as PR-ready branch; **Branch CI green** (frontend job; backend correctly skipped,
layer-scoped). **Held for user test, not auto-merged** — the acceptance criteria are substantially
visual/subjective ("more pop", primary tile visually dominant, motion feel), the same class of
judgment call as T10620 (see WAVE.md). Manual test steps below.

**User test steps** (branch `feature/T10670-completion-bars-v2-tiles`):
1. Export a Focus framing render and an Overlay render on a test clip; open the completion preview for each.
2. Check the headline reads "Your clip is ready" with a green "Saved" chip (no green sentence, no visible "Save" verb anywhere).
3. Confirm the tiles themselves feel tappable/clickable (no separate pill button inside) and look "fun"/have visual pop — primary tile (Add spotlight on Focus, Publish on Overlay) should stand out with a gradient + glow + a single one-shot pulse.
4. Resize to 390px: tiles stack as horizontal rows, footer fits comfortably above the video (~400px, not ~520px).
5. Resize to 1024/1100/1280px: one row of three tiles, no horizontal scrollbar.
6. Tab through: order should be primary -> secondary -> tertiary -> "Done for now"; Enter/Space activates the focused tile.
7. Click "Done for now": should navigate away with no caption text under it.
8. If everything reads well, merge PR (branch already pushed + CI green) and the status will move to STAGING.

**2026-09-20**: User reviewed on the deployed dev stack and approved. PR #473 merged
(`cc85bf4b`). Status -> STAGING.

## Acceptance Criteria

- [ ] Footer contains the headline, the "Saved" chip and NO occurrence of the word "Save" as a verb; the exit reads "Done for now" with no caption
- [ ] Three tiles, one tab stop each, Enter/Space activate, DOM/tab order primary -> secondary -> tertiary -> exit
- [ ] Primary tile is visually dominant (cyan gradient + glow + single pulse); Publish tile still carries `data-tutorial-target="focus-publish"` (exactly one element) and `publishLoading` disables it with a spinner
- [ ] At 390px wide: tiles are horizontal rows, footer height <= 420px; at 1024px+: one row of three, no horizontal scrollbar at 1024/1100/1280
- [ ] Overlay bar mirrors with Publish primary; both bars read as one system
- [ ] Reduced-motion users see no animation
- [ ] All copy free of em dashes; `STAGE_REASONS.PUBLISH` reused verbatim
- [ ] Unit tests + e2e specs listed above updated and green; Branch CI green
