# T10190: Result-surface title consistency, back-to-game backlink, and copy centralization

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Created:** 2026-09-15
**Updated:** 2026-09-15

## Problem

T9890's GATED_DISCOVERY investigation (`docs/plans/tasks/evaluation-2026-09-13/T9890-decision-record.md`,
2026-09-15) found the result-entry-point problem is smaller than the original T13 brief feared,
but real gaps remain:

**Good news first (do not redo):** all finished-result entry points already funnel to one
`CollectionPlayer`; the handoff's E51 concern ("source substituted for finished media") does
NOT reproduce - it was a naming collision between "Preview" on a finished card and "Preview
plays" in Annotate, not a wiring bug. Loading/failure/retry (AC2) is already fully met by T9470
(skeleton -> paintable frame, `onError` + Retry, stall detection, scoped to the requesting
item/page so a late result never renders over the wrong screen).

**Real gaps:**
1. **Title diverges across entry points.** Store-driven paths (DraftTile tap, one-tap publish
   completion, Published tab) promote **game name + game clock**
   (`CollectionPlayer.jsx:371-383`). Focus-completion and Overlay-completion previews instead
   pass `title=project.name`, showing the **clip name**. This contradicts handoff item S08's
   "promote the clip name" guidance on the majority (store) path.
2. **No "back to game plays" backlink.** `CollectionPlayer` closes only via X/Escape, returning
   to `ProjectManager`; the header's game name is static text, not a link. No source-annotation
   context (which game/clip this result came from) is carried back (E44).
3. **5 proposed copy strings are uncentralized.** "Watch finished highlight", "Watch marked
   plays", "Loading your highlight...", "Couldn't load the video. Try again.", "Back to game
   plays" all currently absent from `displayNames.js`; the surface uses ad-hoc inline literals
   instead ("Preview video", "Play video", "Couldn't load this video.").
4. *(Optional hardening, not required for the core fix)* the FOUR independent hand-built reel
   payload shapers (`finishedReelNav.js`, `DraftReelPreview.jsx`, `FocusScreen.jsx`,
   `OverlayScreen.jsx`) are the drift vector behind gap 1 - consolidating them into one shared
   shaper would prevent this class of bug recurring, but is a refactor (characterization tests,
   <200-line units), not a drop-in.

## Solution

Per T9890's decision record §3:

1. **Pick ONE title-promotion rule** (clip-name vs game-name) and apply it uniformly across
   BOTH the store-driven paths and the Focus/Overlay completion-preview paths on the shared
   `CollectionPlayer` header. This is a product-copy decision that must be reconciled against
   T9860's naming work (not a unilateral pick) - it also changes a component ALSO used by
   Published reels, so treat it as cross-surface, behavior-adjacent risk, not a local tweak.
2. **Add a "Back to game plays" backlink** from the result view, carrying source-annotation
   context (which game/clip) back to where the user can resume marking plays. Net-new
   navigation affordance.
3. **Centralize the 5 copy strings** in `displayNames.js`, policy-accurate, folded into T9860's
   sweep if that's still open, or added consistently with its conventions if not.
4. *(Optional, separately schedulable)* the reel-payload-shaper consolidation, if the team wants
   to close off the drift vector rather than just fix today's instance of it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/collections/CollectionPlayer.jsx` (header ~371-383, close
  behavior ~373-380) - title promotion + backlink both attach here
- `src/frontend/src/utils/finishedReelNav.js` (lines 38-48) - one of the 4 hand-built payload
  shapers; natural home for a single payload/title contract if item 4 is pursued
- `src/frontend/src/components/DraftReelPreview.jsx` (lines 93-104) - store-driven payload
  shaper #2
- `src/frontend/src/modes/focus/FocusScreen.jsx` (lines 1448-1468, payload ~1450-1456) -
  completion-preview payload shaper #3 (passes clip name, not game name)
- `src/frontend/src/modes/overlay/OverlayScreen.jsx` (lines 1814-1836, payload ~1816-1822) -
  completion-preview payload shaper #4 (same clip-name behavior)
- `src/frontend/src/config/displayNames.js` - the 5 proposed copy strings
- `.claude/knowledge/annotate.md`, `.claude/knowledge/persistence-sync.md` - read first, T9890
  already did a full audit under these docs

### Related Tasks
- Source: T9890 (GATED_DISCOVERY investigation, source T13/EP03) - full findings, the
  entry-point table, and AC-by-AC evidence in
  `docs/plans/tasks/evaluation-2026-09-13/T9890-decision-record.md`. Read this FIRST.
- Gated on / coordinate with: **T9860** (single copy/concept sweep) - the title-promotion
  decision and the 5 new strings should reconcile with T9860's conventions rather than being
  decided in isolation (T9860 is already merged/STAGING, so this is a coordination check, not a
  hard blocker on starting).
- Settled, do not reopen: T9470 (loading/recovery/retry - already correct), the E51 "source
  substituted for finished" concern (does not reproduce).

### Technical Notes
M-L tier: item 1 (title consistency) is product-gated and cross-surface (touches a component
Published reels also use) - treat as behavior-adjacent risk, not a low-risk local fix, per
T9890's own classification. Item 2 (backlink) is a net-new, design-shaped feature. Item 3 rides
whatever copy-sweep convention is current. Item 4 is optional and separately schedulable - do
not let it block shipping items 1-3. **Live cross-entry validation is mandatory per T13's own
acceptance bar** (open via each entry point, reload/back/forward, compare artifact IDs across
entries, play >=2s of the fixture) - T9890's investigation could NOT do this (no backend
venv/Playwright in its container), so this task's QA phase must include it for real, not just
inherit the "already verified" claim from the investigation.

## Implementation

### Steps
1. [ ] Read T9890's decision record in full - the entry-point table and per-AC evidence are
   already done, do not re-audit.
2. [ ] Decide title-promotion rule (clip-name vs game-name), reconciled with T9860's
   conventions if still open for discussion; get product sign-off if the decision isn't
   obviously implied by existing T9860 conventions.
3. [ ] Apply the title rule uniformly to `CollectionPlayer.jsx`'s header across all 4 payload
   shapers.
4. [ ] Add the "Back to game plays" backlink + source-context navigation.
5. [ ] Centralize the 5 copy strings in `displayNames.js`.
6. [ ] Live cross-entry validation: open via DraftTile/one-tap/Published/Focus-completion/
   Overlay-completion, reload/back/forward each, compare artifact IDs across entries, play
   >=2s of the fixture per entry.
7. [ ] (Optional) if pursuing item 4, characterization tests before consolidating the 4 payload
   shapers into one.

## Acceptance Criteria

- [ ] Every finished-result entry point shows the SAME title-promotion rule (not divergent
      clip-name vs game-name)
- [ ] A "Back to game plays" backlink exists on the result view and correctly returns to the
      source game's plays/annotate context
- [ ] All 5 proposed copy strings are centralized in `displayNames.js`, policy-accurate
- [ ] Live cross-entry validation performed and evidenced (not just inherited from T9890's
      investigation, which could not run it)
- [ ] Existing loading/retry/recovery behavior (T9470) unregressed
- [ ] Relevant test set + live-drive evidence per criterion
- [ ] Branch CI green
