# First-Clip Funnel: get uploaders to their first clip

**Status:** STAGING (all 3 tasks implemented, reviewed, CI green, merged to master;
completion criteria are post-ship metrics, not yet measurable)
**Started:** filed 2026-08-31
**Impact:** 8 | **Complexity:** 5 | **Priority:** 1.6

## Goal

Close the decisive activation cliff: upload -> FIRST CLIP. Prod evidence (2026-08-31
ux-investigator investigation, read-only prod data, N=45 last-30d):
last-30d, 11 users watched their uploaded game on Annotate, only 5 ever opened the clip
form, 6 created a clip; `clip_save_failed` = 0 all-time (the system never refuses - users
never arrive). 15 users watched the how-to-clip tutorial; only 3 of them ever clipped.

Evidence base (binding on all children):
- Theory doc: [docs/plans/ux/UX-annotate-first-clip-2026-08-31.md](../../ux/UX-annotate-first-clip-2026-08-31.md)
- Decision artifact (user-approved 2026-08-31): https://claude.ai/code/artifact/7e991364-3568-477c-81dd-1a3eff9a20bc
- Screenshots: docs/plans/ux/screenshots/

User decisions recorded 2026-08-31:
- Naming approved (refined 2026-08-31): **Plays -> Clips -> Highlight Reels**. The
  assembly button becomes "Create Highlight Reel" and moves to the Highlight Reels
  surface ("New Clip" rejected - reserved for T7860's future direct-clip upload). UI
  strings only, no identifier or schema renames.
- Quest/tutorial surface collapses to a **Help button**; the full guided-help system is
  the [Tutorial Redesign epic](../tutorial-redesign/EPIC.md) (updated same day with the
  Help-button directive). This epic ships only the mechanical de-occlusion + collapse.
- Credits awarded **upfront** instead of dripped per quest step.

## Tasks (row order = experiment order from the theory doc)

| ID | Task | Status |
|----|------|--------|
| T8120 | [Quest overlay yields: collapse to Help button + upfront credits](T8120-quest-overlay-help-collapse.md) | STAGING |
| T8130 | [Annotate primary CTA + Plays/Clips/Reels naming](T8130-annotate-primary-cta-and-naming.md) | STAGING |
| T8140 | [One-tap first clip (form defaults + sticky Save)](T8140-one-tap-first-clip.md) | STAGING |

**2026-09-02**: All 3 tasks merged to master. T8130's mid-flight IA guard split the Reel
Drafts tab rename + assembly-button relocation into a separate follow-up
([T8360](../T8360-split-single-vs-multiclip-drafts.md), needs a ui-designer pass) rather
than force a naming decision the implementation revealed was wrong. Completion criteria
below are post-deploy metrics - review after the next prod deploy.

## Shared leap-of-faith assumption

T8120+T8130 test whether these users still want the clip and are being physically or
perceptually prevented. If mobile file-selection (`upload_file_selected/add_game_opened`)
and `add_clip_opened/annotation_completed` do not move, the residual explanation is
motivational (credits-before-value, or T7860's missing direct-clip-upload path) and
further screen redesign should pause.

## Completion Criteria

- [ ] `upload_file_selected / add_game_opened` (webapp-mobile) rises from 2/6 toward pwa parity
- [ ] `add_clip_opened / annotation_completed` rises from ~1/2
- [ ] `clip_created / add_clip_opened` holds or rises as openers increase
- [ ] `watched_annotate_tutorial` falls (accidental opens disappear)
- [ ] No screen at 390x844 where quest/help UI occludes a tappable control
