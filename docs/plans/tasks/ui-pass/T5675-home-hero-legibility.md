# T5675: Home header/hero + games-card legibility

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-20
**Epic:** [UI Pass](EPIC.md) — task 5 of 7

## Problem

Audit findings #8–#11, all on the home screen shell (both tabs):

1. **Logo lockup reads broken**: it renders as three stacked lines — "Reel" / play-icon /
   "Ballers" — with the icon splitting the wordmark. On every width it looks like a CSS wrap
   accident, not a brand.
2. **Hero eats the fold**: logo + tagline + "Continue where you left off" + tab toggle + big
   CTA + a boxed two-row filter panel push the actual content ("Your Reel Drafts") to ~470px
   from the top on desktop and further on mobile. The filter box has card-level visual weight
   for what are two rows of chips.
3. **Games-card metadata is cryptic** (finding #10): `6/11/2026 · 13 clips · 5!! · 5! ·
   Quality: 25` — the `N!!`/`N!` rating notation and bare "Quality" score are opaque to the
   target user (a soccer parent, not a power user), and the date is unlabeled (game date?
   upload date? expiry?). The `RATING_NOTATION` constants are a rating-count shorthand only
   the developer understands.
4. **"Continue where you left off" silently disappears on mobile** (finding #11) — decide
   deliberately: either show a compact version or document why not. Mobile users arguably need
   resume-context most.

## Solution

- **Lockup**: one intentional unit — icon left of a single-line "Reel Ballers" wordmark (or a
  designed stacked lockup if UI Designer prefers) that scales down without splitting. One
  component, all widths.
- **Density**: tighten hero vertical rhythm; demote the filter panel to borderless inline chip
  rows (chips are self-explanatory; the box adds weight, not meaning). Target: list content
  visible above the fold at 748px-height desktop and 844px mobile.
- **Legibility**: replace/augment the rating shorthand on `GameCard` with a legible form —
  e.g. star-icon + count chips with `title` tooltips and an `aria-label`, "Quality 25" →
  labeled ("Footage quality 25/100" tooltip), date labeled ("Uploaded 6/11/2026"). Exact
  treatment via UI Designer against the style guide; the bar is "a first-time parent
  understands every token on the card".
- **Mobile continue strip**: render the two continue cards as one compact horizontal row on
  mobile (they are the highest-value tap on the screen). If deliberately excluded, record the
  decision in this task file instead.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — header/logo block `:~594-733` (continue section :594-668, tabs :671-708, action button :711-733), filter chips `:865-977`, `GameCard:1295`, `TagBadges:45`, `RATING_NOTATION`/`RATING_BADGE_COLORS` usages
- Logo/wordmark markup (inside ProjectManager header block; possibly a shared component — locate)
- `.claude/references/ui-style-guide.md` — typography/spacing rules to follow + update

### Related Tasks
- **Do NOT run concurrently with T5672** (same file: `ProjectManager.jsx`)
- Independent of the tile track otherwise

### Technical Notes
- Filters remain ephemeral view state — restyling must not introduce any persistence
  (standing rule: no persisted filters/sort/panel state).
- Pure presentational task; card click/nav handlers untouched.
- The `↳`-style rating semantics live in constants — add labels/tooltips at the View layer,
  don't rename the constants (greppability).

## Implementation

### Steps
1. [ ] UI Designer: lockup + hero density + game-card metadata spec (user approval)
2. [ ] Lockup component fix (all widths)
3. [ ] Hero/filter density pass
4. [ ] GameCard metadata legibility (tooltips/labels/aria)
5. [ ] Mobile continue strip (or documented decision)
6. [ ] Unit tests for changed views; screenshots 390/768/1315

## Acceptance Criteria

- [ ] Lockup renders as one intentional unit at 360, 390, 768, 1280+ px
- [ ] Draft/game list starts above the fold at 1315×748 and 390×844
- [ ] Every token on a GameCard is either self-explanatory or labeled/tooltipped
- [ ] Continue-where-you-left-off resolved on mobile (shown compact, or decision recorded)
- [ ] No new persisted state; frontend tests pass; screenshot evidence at three widths
