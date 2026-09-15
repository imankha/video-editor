# T10110: Reel Drafts "By Phase" view renders duplicate/overlapping carousel controls

**Status:** STAGING
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

Bug 51 (`bug_reports`, sarkarati@gmail.com, 2026-09-01, build `d9621161`): "Having multiple
carousels on the same row is confusing UI for the user." `page_url`: `/home/reels`.

Screenshot (viewport 2224x1221) confirms this is a real layout defect, not just a preference: the
Reel Drafts "By Phase" view's "Not Started" row shows **two separate sets of prev/next arrow
controls** in the same visual row — one pair around x=427/799 (in the ~2000px-scaled screenshot)
and a second pair around x=821/1196, both apparently scoped to the same card row. It's not
resolvable at a glance which arrows scroll which cards, and the cards themselves appear to belong
to one continuous "Not Started" collection (4 cards visible, badge says "6" total) rather than two
distinct groups that would justify two carousels.

**Root-caused 2026-09-14 (Explore agent, code-only pass — not yet live-reproduced).** Hypothesis 1
was essentially correct, with a precise mechanism: this is by-design behavior (T8080), not a
rendering bug, that happens to read as confusing.

`DraftPhaseAspectRows` (`src/frontend/src/components/ProjectManager.jsx:170-225`) mounts **one
`CardCarousel` per GAME, not one per phase**. `phaseRowsFor`
(`src/frontend/src/utils/draftStage.js:201-230`) buckets "Not Started" drafts into a single
`ratio: null` bucket (`:168-169`) and then **re-splits that bucket by game** (`:219-224`). Each
per-game cluster gets its own subtle 10px gray label (`ProjectManager.jsx:193-197`) and its own
`<CardCarousel>` (`:199-219`), each independently deciding whether to show arrows purely from its
own overflow state (`CardCarousel.jsx:267`, `isOverflowing`) — with no awareness of sibling
carousels. The clusters are `shrink-0 max-w-[420px]` inside a `flex flex-wrap` container
(`ProjectManager.jsx:190`), so two games' clusters can pack onto the same visual line, each
producing its own arrow pair — exactly matching the screenshot (arrows at x=427/799 and
x=821/1196). The phase badge count ("6") is the whole-phase total across ALL games in the bucket;
each carousel only shows its own game's subset (e.g. 3+3) — hence "4 visible, badge says 6."

**This is working as coded, not a bug in the mechanical sense** — but the per-game separator label
is too subtle to read as "these are two different groups," so two legitimate small carousels look
like one broken one. Bug 51's own framing ("confusing UI") matches this diagnosis exactly.

## Solution

Three candidate fixes (UX judgment call, not yet decided):
(a) Make the per-game cluster label more visually distinct (stronger divider/spacing) so two
    adjacent clusters clearly read as separate groups.
(b) Stop letting distinct-game clusters wrap onto the same line within one phase section (force
    each game's cluster onto its own full-width row).
(c) If the real intent is "one carousel per phase," collapse the per-game split for Not Started
    entirely and use the game name as an inline label within a single `CardCarousel` per phase.

Recommend (b) as the smallest, safest fix (one game per row removes the ambiguity without
touching the carousel/grouping data model), but this is a visual/UX call — not making it
unilaterally. Not yet live-reproduced against a real account with multiple Not-Started drafts.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx:170-225` (`DraftPhaseAspectRows` — mounts one
  `CardCarousel` per game), `:190` (flex-wrap container letting clusters share a line), `:2001-2003`
  (phase badge = whole-phase total, not per-carousel)
- `src/frontend/src/utils/draftStage.js:201-230` (`phaseRowsFor` — the by-game re-split), `:168-169`
  (single `ratio: null` bucket for Not Started)
- `src/frontend/src/components/shared/CardCarousel.jsx:267` (`showChevrons`/`isOverflowing` — each
  carousel decides independently, no cross-carousel awareness)

### Related Tasks
- Same reporter as T10070/T10080/T10090, unrelated bug — filed together from the same triage pass

## Implementation

### Steps
1. [x] Root-caused 2026-09-14 (code-only) — see Solution above: `DraftPhaseAspectRows` mounts one
   `CardCarousel` per game, and same-line wrapping makes two games' clusters look like one broken
   carousel.
2. [ ] Live-reproduce against a real account with 2+ games' Not-Started drafts to confirm the
   diagnosis before implementing.
3. [ ] User/UX pick between options (a)/(b)/(c) above — (b), forcing one game per row, is the
   recommended smallest fix.
4. [ ] Implement + frontend test for the chosen fix.

### Progress Log

**2026-09-14**: Filed from `bug_reports` #51 during a full bug-report triage pass. Root-caused
same day (Explore agent): by-design per-game carousel splitting (T8080) plus flex-wrap packing,
not a rendering defect. Deferred implementation — low priority (Impact 3), needs a UX pick between
3 candidate fixes first; see Solution above.

**2026-09-15**: User initially picked option (a), a stronger visual divider. Implemented and
pushed to `feature/T10110-draft-carousel-group-divider` for live testing (a container stack stood
up at the user's request). Partial verification only: the running dev app's only available
account had a single game in its Draft bucket, so only the "divider correctly absent" half was
confirmed live, not the "present" half.

**2026-09-15 (revised)**: After seeing the single-game case live, the user reconsidered and asked
for option (b) instead — one game per row, no shared line at all — saying they're "not a fan of
several carousels on the same line" even with a divider between them. Re-implemented on the same
branch: `DraftPhaseAspectRows`'s container changed from `flex flex-wrap` to `flex flex-col`
(vertical stack), and the per-cluster divider styling from the (a) attempt was removed as
unnecessary — clusters can no longer share a line, so there's nothing to visually separate.
Existing `GameTile.test.jsx`/lint pass clean; no new automated coverage added yet (same gap noted
in the first attempt — no existing test file covers this component's rendering).

**2026-09-15 (verified + merged)**: User live-tested the restarted stack directly (dev-login,
Reel Drafts By Phase) and confirmed two games now stack on separate rows instead of sharing a
line. Merged together with T10140 (same branch, same component) as PR #441.

## Acceptance Criteria

- [x] Each Reel Drafts group/row shows exactly one carousel control set, unambiguous which cards
      it scrolls. User-confirmed live 2026-09-15.
