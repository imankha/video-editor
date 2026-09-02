# T8360: Split single-clip vs multi-clip drafts into separate views

**Status:** TODO
**Impact:** 6
**Complexity:** 6
**Created:** 2026-09-02

## Problem

Split out of T8130 (Annotate primary CTA + Plays/Clips/Highlight Reels naming). That
task's approved naming plan assumed the Home "Reel Drafts" tab holds per-clip work items
(so it could be renamed to "Clips", clearly separate from "Highlight Reels"). T8130's
implementation investigation found this assumption is wrong: the tab actually holds a
**mix** of single-clip and multi-clip unpublished projects.

Evidence (2026-09-02, T8130's Code Expert):
- `DraftTile.jsx:542-543` shows a "Contains N clips" badge whenever `project.clip_count
  > 1` - i.e. some drafts are genuinely multi-clip assemblies, not single clips.
- `ProjectManager.jsx`'s "New Reel" button (:1213) opens `GameClipSelectorModal`, a
  multi-select picker; submitting creates a multi-clip project via `POST
  /projects/from-clips`, which lands back in the SAME Reel Drafts tab (:1701).
- `ProjectManager.jsx:691` comment: "multi-clip drafts sort last" - the codebase already
  treats single-clip and multi-clip drafts as a distinguishable pair within one list.

So today's Reel Drafts tab is genuinely two different kinds of content sharing one
surface: single-clip auto-drafts (created when a user first taps "Create Reel" on one
clip, per T8070's `auto_project_id` mechanism) and multi-clip manually-assembled drafts
(created via "New Reel" + multi-select). Naming the tab "Clips" would misrepresent the
multi-clip entries; naming it "Highlight Reel Drafts" would misrepresent the single-clip
entries as more finished than they are.

**User decision 2026-09-02:** rather than pick one misleading name, split the two content
types into separate views/surfaces.

## Solution (needs a design pass before implementation - NOT scoped in depth here)

This is a real IA decision, not just a rename. Open questions to resolve at pickup:
- What does each split surface look like - two tabs, one tab with two sections, or a
  filter within one list?
- Where does "single-clip auto-draft" content actually belong conceptually - is it
  "Clips" (i.e. exposing a clip's Focus/Overlay stage progress the same way
  `ClipDetailsEditor`'s Reel control does in Annotate), or does it stay under a
  drafts-style surface just without the multi-clip entries mixed in?
- Does the "New Reel" / multi-select assembly flow move, per T8130's approved naming
  table (assembly button relocates to the Highlight Reels surface as "Build Highlight
  Reel")? If so, does a multi-clip draft belong under Highlight Reels (as an in-progress
  reel) rather than under whatever surface holds single-clip content?
- Interaction with T8070/T8350 (reel staleness): a per-clip staleness cue (T8350) would
  most naturally live wherever single-clip drafts end up.

Given the IA scope, this likely needs a `ui-designer` pass (spec the two surfaces + the
transition/empty states) before implementation, similar to how T8350 was scoped.

## Context

### Relevant Files (anticipated)
- `src/frontend/src/components/ProjectManager.jsx` - the Reel Drafts tab, "New Reel"
  button, multi-clip sort-last logic (~L691)
- `src/frontend/src/components/DraftTile.jsx` - per-draft tile, "Contains N clips" badge
- `src/frontend/src/components/GameClipSelectorModal.jsx` - multi-select assembly flow
- `src/frontend/src/config/displayNames.js` - tab labels (extend, don't duplicate)

### Related Tasks
- Split out of [T8130](first-clip-funnel/T8130-annotate-primary-cta-and-naming.md) - that
  task proceeds with its OTHER approved renames (Add Play, Highlight Reels tab, Build
  Highlight Reel button) but does NOT rename the Reel Drafts tab itself, pending this
  task's resolution.
- Related to [T8350](T8350-multiclip-reel-staleness-visual.md) (multi-clip staleness
  visual cue) - both touch the multi-clip draft surface; sequence or coordinate if picked
  up close together.
- Depends conceptually on [T8070](T8070-reel-status-timestamp-staleness.md)'s per-clip
  `reel_source_*` data model for whatever "single-clip" surface emerges.

## Acceptance Criteria

- [ ] Design spec (ui-designer) approved for the two-surface split
- [ ] Single-clip and multi-clip drafts are visually/structurally separated, not
      commingled in one list requiring a "Contains N clips" badge to disambiguate
- [ ] The approved T8130 naming vocabulary (Plays/Clips/Highlight Reels) applies
      consistently once the split lands - no surface left using stale "Reel Drafts"
      terminology if the split makes that name obsolete
