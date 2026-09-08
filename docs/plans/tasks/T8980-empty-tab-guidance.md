# T8980: Empty tab guidance - use blank tab space to explain the flow

**Status:** STAGING
**Impact:** 7
**Complexity:** 4 (raised from 3 on 2026-09-07 when the tab-bar label + iPad tap-target work was folded in; the e2e locator sweep is the cost)
**Created:** 2026-09-07
**Updated:** 2026-09-07

## Problem

When any of the four home tabs (Games, In Progress Clips, In Progress Reels, Published) has
nothing in it, the blank space is wasted. Today's empty states are dead ends that name the
absence but not the purpose:

| Tab | Today (verbatim) | Where |
|-----|------------------|-------|
| Games | "No games yet" + Add Game | `ProjectManager.jsx:1546-1564` |
| In Progress Clips | "No clips yet. Start a clip in one of two ways." + Add Video + "Tap 'Clip Play' on a play in Annotate..." | `ProjectManager.jsx:1722-1752` |
| In Progress Reels | "No reels in progress" + disabled Build New Reel; reason lives in a hover `title` | `ProjectManager.jsx:1993-2011` |
| Published | "No reels yet. Publish reels to see them grouped by game here." + link that says "the Clips tab" (stale label) | `CollectionsTab.jsx:131-150` |

None of them say how the tab fits in the path to a published clip or reel, and none point
to the closest next action based on what the account already has. This is activation work:
the first-clip funnel evidence (T8120-T8140 epic) shows people stall between upload and
first clip; empty tabs are exactly where a confused user lands.

Two latent defects surface on the same screens:
- `hasClips = games.some(g => g.clip_count > 0)` (`ProjectManager.jsx:494`) counts only
  clips cut from games, so an account whose clips came from Add Video sees a disabled
  Build New Reel button with no reason on touch.
- Published's empty state links to "the Clips tab"; the label has been "In Progress Clips"
  since T8555.

## Solution

One shared `EmptyTabGuide` component, rendered by all four tabs, with:

1. **Flow strip**: a compact 4-step row (1 Games, 2 Clips, 3 Reels, 4 Published) with the
   current tab lit in its own tab color (`themeColors.js` GAME/REEL/HIGHLIGHT/PUBLISHED).
   Numbered because the order is real (no game, no clip; no clip, no reel). Collapses to
   numbered dots with only the current step named below `sm`.
2. **Headline** that defines what lives on this tab.
3. **Body** (two sentences max) that says what you can do with the items and where they go
   next, always ending on the path to Published.
4. **Action block** with the primary CTA always enabled, or a visible reason plus a
   cross-tab button to the step that unblocks it. Never a silent disabled button.
5. **Footer hint** naming the next tab in the flow.

Copy branches on what the account already has (games, clips, drafts). Cross-tab buttons are
plain `setActiveTab(...)` calls, no new routes.

Design mockup (decision artifact, user confirmation pending as of filing):
https://claude.ai/code/artifact/1168e4dd-02b1-4d45-87f0-274094ba1229

### Copy (APPROVED 2026-09-07, binding)

| Tab | Headline | Body | Action block | Footer hint |
|-----|----------|------|--------------|-------------|
| Games | Every highlight starts with a game | Upload a full game recording, then open it and tap Add Play at each moment worth keeping. Those plays become your clips, and clips become the reels you share. | **Add Game** (success). Caption: "Video from your phone or computer. 2 credits, stored for 30 days." | Already have a short clip? *Add it directly on In Progress Clips* (tab switch) |
| In Progress Clips | Clips are the plays you cut from a game | Each clip gets a Focus pass to follow your athlete and an optional Spotlight. Then publish it on its own, or build several into a reel. | games>0: "Open a game and tap Add Play." **Go to Games**. games=0: "Add a game and tap Add Play." **Add Game**. *or* "Upload a short video you already have." **Add Video** (success) | Published clips show up on the Published tab. |
| In Progress Reels | Reels stitch several clips into one highlight video | Pick the plays you want, put them in order, and export once. A single clip can be published on its own; a reel is for a full game or a season. | **Build New Reel** (cyan). clips=0: disabled + visible reason "You need at least one clip first" + **Cut a clip from a game** (to Games, or Clips when games=0). clips>0: "You have N clips ready to use." | Finished reels move to Published when you share them. |
| Published | Published reels are ready to share | When a clip or reel is finished, Publish moves it here, grouped by game, with a link you can send to coaches, family and recruiters. | drafts>0: "You have N clips in progress. Publish one to see it here." **Open In Progress Clips**. drafts=0,games>0: "Cut your first clip from a game to get started." **Go to Games**. nothing: "Add a game to get started." **Add Game** | Every published reel gets its own link. Share it from the player or the card. |

Vocabulary: T8130's approved nouns (Plays, Clips, Highlight Reels) and `displayNames.js`
(`SECTION_NAMES`, `LIBRARY`). UI strings only; no identifier or schema renames.

### Decisions (all four APPROVED by user 2026-09-07)

1. Keep the 4-step strip in every empty state: **Yes.**
2. Cross-tab buttons vs text links: **Buttons** (touch-visible).
3. Mention cost on the Games empty state: **Yes** (matches T8500's disclose-before-pick).
4. Copy length: **as shown** (one headline, two sentences, one action block).

## Tab bar considerations (user question 2026-09-07, recommendations IN SCOPE)

The user asked whether the segmented tab bar is the right navigation at every screen size,
whether the tap targets are right, and whether users are used to tabbing like this on every
device. Assessment from the code, with the recommendations folded into this task:

**The pattern is right.** Four peer sections with count badges is what a segmented control /
top tab bar is for, and it is conventional on every platform (iOS segmented control, Material
top tabs, desktop tabs). The stacked icon-over-label form below `sm` is the iOS tab-bar shape
placed at the top. Do NOT replace it with bottom navigation in this task: bottom nav is more
thumb-friendly but is a bigger change (safe-area handling, collision with the T8120 Help chip
and the sticky bottom bars T8140/T8790 add, and it would exist only on the home hub since the
editor screens have none). It is evidence-gated: a ux-investigator question against prod
`user_actions` (do mobile users switch tabs today, and do they miss the bar) before any design.

**Phones (< 640px, the `sm` breakpoint): fix the labels, keep the bar.**
`ProjectManager.jsx:428` sets `text-[10px]` with wrapping so "In Progress Clips" / "In Progress
Reels" fit a ~70px column at 320px. Three problems: 10px is below both platform floors (iOS
11pt, Material 12sp); the shared "In Progress" prefix eats the width and carries no
distinguishing information (the word that differs lands on line two); and it is a documented
compromise (no `xs` screen in tailwind.config, so 10px then `sm:text-sm` with nothing between).
- Below `sm`: labels **Games / Clips / Reels / Published**, one line, 12px. "Published" next
  to "Reels" is what makes the middle two read as in-progress, the same disambiguation the
  empty-state strip uses. Desktop keeps the full `SECTION_NAMES` labels (responsive label
  shortening, not a rename; `SECTION_NAMES` constants and the DraftTile/toast vocabulary are
  untouched).
- Accessible name still reads "{label}{count}" (T8545 DOM-order landmine); the short label is
  a `sm:hidden` span, the full label `hidden sm:inline`, both inside the same button.
- Tap targets are already fine below `sm` (~70x55px at 320px); this is a legibility fix, not a
  target-size fix.
- e2e blast radius: locators that match the full label text at mobile viewports (T8555's rename
  sweep touched 46 files) must be re-pointed to the short label or to the tab's testid/role.
  Grep before estimating.

**iPads / tablets (744 to 1366px): the bar is legible but the tap targets are too small.**
Every iPad width (portrait 744/768/810/834, landscape 1024 to 1366) is above `sm`, so the bar
takes the DESKTOP form: content-width row, `text-sm`, `px-4 py-2`. That is ~36px tall, below
the 44pt touch minimum, on a device whose primary pointer is a finger. Split View and Slide
Over also apply: a Slide Over pane is ~320px (gets the phone form, fine), a 1/3 split is
~438-507px (phone form), a 1/2 split is ~507-678px (straddles `sm`).
- Use the existing `coarse-pointer:` variant (tailwind.config.js:17, `hover: none` and
  `pointer: coarse`) to raise the tab's vertical padding to a 44px minimum height on touch
  tablets at `sm+` (e.g. `coarse-pointer:py-3` or `coarse-pointer:min-h-[44px]`), leaving the
  desktop mouse form untouched. NEVER detect iPad by user agent (T7350 landmine: the share
  UA-sniff broke twice; capability queries are the rule). Note iPadOS with a trackpad reports
  `pointer: fine` and gets the desktop form, which is correct.
- The `hover:` variants on inactive tabs are harmless on touch (no sticky state); the empty
  state itself must have NO hover-only affordances (already required: reasons are visible
  text, never `title`).
- Verify at 320 (Slide Over), 507 (1/3 split), 768 (portrait), 1024 (landscape). Two of these
  are the same breakpoints as the phone check, so it is two extra viewports, not four.

**Buttons (all sizes):** `size="lg"` is `px-6 py-3` (~48px tall) and full width below `sm`;
fine everywhere. No change.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` - three inline empty states (`:1546`, `:1722`, `:1993`), `hasClips` (`:494`), `gamesEmptyConfirmed` (`:503`), `setActiveTab`
- `src/frontend/src/components/collections/CollectionsTab.jsx` - Published empty state (`:131-150`), `onViewDraftClips`
- `src/frontend/src/components/PublishedReelsPanel.jsx` - `draftClipCount` (`:64`), `onViewClips` plumbing
- `src/frontend/src/components/shared/EmptyTabGuide.jsx` - NEW shared component (strip + headline + body + action block + hint)
- `src/frontend/src/config/displayNames.js` - section names; add the new empty-state strings here or a sibling `emptyStates.js`
- `src/frontend/src/config/themeColors.js` - GAME/REEL/HIGHLIGHT/PUBLISHED for the strip's current-step color
- `src/frontend/src/components/ProjectManager.jsx` `SegmentedTabButton` (`:401-441`) - short mobile label span + `coarse-pointer:` tap-target height at `sm+`
- `src/frontend/tailwind.config.js` - `fine-pointer` / `coarse-pointer` variants (`:13-18`), already defined, reuse not extend
- `src/frontend/src/components/ProjectManager.fourTabIA.test.jsx` - canonical 4-tab suite; extend
- `src/frontend/e2e/` - the empty-state assertions in the new-user flow specs that currently match "No games yet" / "No clips yet" / "No reels in progress" / "No reels yet" need updating

### Related Tasks
- Builds on: T8555 (four-tab IA), T8780 (empty-state CTA order, `gamesEmptyConfirmed`), T8380 (Add Video entry point)
- Related: First-Clip Funnel epic (T8120-T8140), First Reel Funnel epic (T8460-T8790), T7840 (quest step actionable empty state)
- Knowledge doc: `.claude/knowledge/annotate.md` (T8555 section, `:320-357`)

### Technical Notes
- `data-tutorial-target="clips-add-video"` must stay on exactly one node at a time (T8380
  invariant); the new Clips empty state keeps it on its Add Video button.
- `gamesEmptyConfirmed` (not `games.length === 0`) gates the Games empty state so it never
  flashes mid-load or on error (T8780).
- Fix `hasClips` to include direct-upload clips (`clipDrafts.length > 0 || games.some(...)`)
  or derive from the store's clip list; do not add a second source of truth.
- Cross-tab buttons call the existing `setActiveTab` (ids `games` / `projects` /
  `inProgressReels` / `published`); no new routes, no persisted view state.
- Mobile: verify at 320/375/390/428 that the primary button is in the viewport without
  scrolling (reuse T8550's `assertCtaInViewport` helper).
- No em dashes in shipped copy.

## Implementation

### Steps
1. [x] User confirms copy + the 4 decisions on the mockup (2026-09-07, all recommendations approved)
2. [ ] Branch `feature/T8980-empty-tab-guidance`
3. [ ] Add `EmptyTabGuide` shared component + strings module
4. [ ] Replace the four inline empty states; fix `hasClips`; fix Published's stale "Clips tab" link
5. [ ] Update `ProjectManager.fourTabIA.test.jsx` + affected e2e empty-state locators
6. [ ] Tab bar: short one-line labels (Games / Clips / Reels / Published) below `sm`, full labels at `sm+`, accessible name unchanged; `coarse-pointer:` 44px tab height at `sm+`; re-point affected e2e locators
7. [ ] Live check on all four tabs (new account via test-login) at 320, 390, 507, 768, 1024; pointer-emulated coarse at 768/1024
8. [ ] Reviewer pass on the diff, commit

### Progress Log

**2026-09-07**: Filed from user request. Code audit done (four inline empty states, no
shared component, `hasClips` games-only bug, stale "Clips tab" link). Mockup artifact
published with copy and 4 decisions. **Same day: user approved all four recommendations and the
copy as shown.** Ready to implement. User also asked whether the top segmented tab bar itself is
the ideal navigation at every screen size, including iPads. Assessment + recommendations
recorded in the "Tab bar considerations" section above and FOLDED INTO THIS TASK by user
request (short one-line phone labels, coarse-pointer 44px tab height for tablets, bottom nav
explicitly deferred behind evidence). Complexity raised 3 -> 4.

## Acceptance Criteria

- [ ] All four tabs render `EmptyTabGuide` when empty; the four inline empty states are deleted
- [ ] Flow strip shows 4 numbered steps with the current tab lit in its tab color; collapses to dots below `sm`
- [ ] Every empty state has either an enabled primary action or a visible reason + a working cross-tab button (no hover-only reasons)
- [ ] Copy branches match the table (games / clips / drafts conditions)
- [ ] Build New Reel is enabled when the account has clips from Add Video (no games)
- [ ] Published empty state no longer says "the Clips tab"
- [ ] Primary button in viewport at 320/375/390/428 without scrolling
- [ ] Tab labels are one line, at least 12px, on every viewport below `sm`; full labels unchanged at `sm+`; accessible name still "{label}{count}"
- [ ] Tab buttons are at least 44px tall on coarse-pointer devices at `sm+` (iPad portrait 768 and landscape 1024), unchanged for fine-pointer desktop
- [ ] No user-agent sniffing anywhere in the change (capability media queries only)
- [ ] Bottom navigation explicitly NOT introduced; the evidence question is recorded for ux-investigator, not built
- [ ] `clips-add-video` tutorial target on exactly one node
- [ ] Unit + affected e2e tests green; Branch CI green
