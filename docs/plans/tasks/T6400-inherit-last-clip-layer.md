# T6400: Drop the "New clips go to" toggle — inherit the last clip's layer

**Status:** WIP
**Impact:** 5
**Complexity:** 1
**Created:** 2026-08-03
**Updated:** 2026-08-03
**Tier:** S-M | **Layers:** Frontend | **Test Scope:** Frontend Unit + real-browser QA

## Problem

The Annotate `ClipsSidePanel` header carries a "New clips go to:" segmented toggle (My Athlete /
Team) added by T5700 (its "Surface (a)"). Per the user (2026-08-03):

> "I'm not a fan of the UI that says default 'new clips go to' and either Team or My Athlete. This
> is taking valuable space. Just default it to wherever the last clip was set to."

The toggle costs sidebar space for little value. This task **removes it** and makes a new clip
**inherit the last layer the user assigned**. This intentionally reverses part of T5700's design —
that is the point, not a regression. The control is not preserved elsewhere.

## Solution

1. **Delete** the "New clips go to:" block from `ClipsSidePanel.jsx` (the label + the
   `LayerSegmentedControl` with `ariaLabel="New clips go to"`), stop threading the toggle's
   `onChange` (`onSetNewClipLayer`) down, and remove the now-dead prop wiring in `AnnotateScreen`
   and the container return. `newClipLayerIsMine` stays (still threaded to the inline add-clip
   overlay); its setter is now internal to the container.

2. **New-clip default = the last layer the user assigned**, resolved in order:
   - **(a)** the last layer assigned this session — creating a clip (`handleFullscreenCreateClip`)
     or changing a clip's layer via either per-clip control (`updateClipRegionWithSync`), each
     calling `setNewClipLayerIsMine` imperatively. The switch path IGNORES imported clips
     (`shared_by` set): their Team layer is forced (epic decision 2) and expresses no intent.
   - **(b)** on game open, seed from the game's most recently created OWN clip — highest raw_clip
     `id`, skipping `shared_by` clips — via `resolveInheritedNewClipLayer(gameData.annotations)`
     (exported from `useAnnotate.js`; legacy-NULL rule `my_athlete ?? true` for the layer read).
   - **(c)** My Athlete for a game with no own clips (today's default, unchanged).

3. **Never persisted**, still **reset per game open** (seeded per 2b). No sessionStorage, no DB
   column, no backend change.

4. **No reactive persistence.** The seed + gesture updates are imperative (in `handleLoadGame` and
   the create/switch handlers), NOT a `useEffect` watching clips — that banned shape would also
   fight the user mid-edit.

### The trap
Changing an **imported** clip is not a signal (its control is disabled and its Team layer is
forced), so `updateClipRegionWithSync` guards on `!region.shared_by` before remembering the layer.

## Relevant Files
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — deleted toggle block.
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` — new exported pure helper
  `resolveInheritedNewClipLayer(annotations)`.
- `src/frontend/src/modes/annotate/index.js` — re-export the helper.
- `src/frontend/src/containers/AnnotateContainer.jsx` — seed on game open + remember on
  create/switch gestures; setter no longer returned.
- `src/frontend/src/screens/AnnotateScreen.jsx` — dropped `onSetNewClipLayer` wiring.
- `src/frontend/src/modes/annotate/hooks/useAnnotateState.js` — comment only (state unchanged).

## Tests
- `resolveInheritedNewClipLayer.test.js` (new) — most-recent Team/My-Athlete/empty/legacy-NULL/
  imported-most-recent/only-imported/id-aliases/no-id cases.
- `ClipsSidePanel.layerFilter.test.jsx` — replaced the toggle test with an absence assertion
  (fails if the "New clips go to" control is reintroduced); filter-pill tests kept.
- Real-browser QA: `e2e/T6400-inherit-last-clip-layer.qa.spec.js` — toggle gone; assign a clip to
  Team then a new clip inherits Team; assign to My Athlete then a new clip inherits My Athlete.
- Updated the T5700 e2e specs (`T5700-team-layer-interactive`, `T5700-two-lanes`) to set a clip's
  layer via the per-clip / add-clip-form control instead of the removed toggle.

## Progress Log

**2026-08-03**: Implemented. Toggle removed; inherit-last-layer via `resolveInheritedNewClipLayer`
(game-open seed) + imperative `setNewClipLayerIsMine` in the create/switch gestures. Targeted
vitest green; build + eslint clean; real-browser QA via `dev-verify.sh`. Docs updated (annotate.md,
T5700 task file). Reviewer run on the diff.

**2026-08-03 (follow-up, same directive owner)**: Removed the `title="Team layer"` hover rollover
from `ClipListItem`'s `LayerChip` (user: "i also dont like that the rollover on the clip says 'My
Athlete' or 'Team', we should rely on coloring"). KEPT `aria-label="Team layer"` (accessible name,
WCAG 1.4.1 — layer must not be color-only). No other clip/timeline element showed a layer-name
rollover (the `AnnotateTimeline` lane titles describe the lane CONTROL, out of scope;
`LayerSegmentedControl`'s title only shows the disabled-reason for imported clips). `layerChip.test.jsx`
extended with a no-title/keeps-accessible-name guard; e2e chip locators moved from `title` to
`[data-testid="clip-row"] [aria-label="Team layer"]` (row-scoped so they don't match the per-clip
control's radio). annotate.md updated.
