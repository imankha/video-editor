# T11175: Reroute funnel analytics off the quest achievements endpoint

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-24
**Epic:** [Remove the Quest System](EPIC.md)

## Problem

The quest achievements POST (`routers/quests.py`, `ACHIEVEMENT_TO_MILESTONE` at `:77-109`) is
also how gesture events reach the admin funnel (`user_actions`). Deleting quests without a new
transport drops these events (owner decision G4).

## Solution

Extend `CLIENT_FUNNEL_EVENTS` (`analytics.py:332`) and call `recordFunnelEvent`
(`utils/funnelEvents.js:79`) from each call site, keeping milestone names identical so history
stays continuous. **Keep per-session dedup**: `crop_adjusted` fires on every drag and
`recordAchievement` deduped it (`questStore.js:167`).

Call sites: `add_game_opened` (`ProjectManager.jsx:1016`), `upload_file_selected`
(`GameDetailsModal.jsx:99`), `add_clip_opened` (`AnnotateContainer.jsx:1522`),
`opened_framing_editor` / `opened_overlay_editor` (`App.jsx:540-551`), `crop_adjusted`
(`FocusContainer.jsx:442`), `speed_segment_created` (`:1052`), `overlay_players_assigned`
(`OverlayContainer.jsx:435`), `overlay_color_set` / `overlay_shape_set`
(`OverlayScreen.jsx:1059,1108`), overlay offered/deferred/declined (`FocusScreen.jsx:1143,1221,1267`,
`focusCompletionOffer.js:32`, `resumeFocusCompletion.js:95,110`, `FocusCompletionRecovery.jsx:85`),
`previewed_draft_reel_1s` (`DraftReelPreview.jsx:91`), `played_annotations`
(`useAnnotationPlayback.js:284`), gallery events (`PublishedReelsPanel.jsx:520-528`),
`watched_*_tutorial` (`TutorialVideoModal.jsx:10-13,97`).

Delete the quest-only triggers outright: `App.jsx:569-582` (`returned_home`, a reactive
useEffect write), `usePublishProject.js:111` (`moved_to_my_reels`; server already emits
`move_succeeded`), `clip_rated` (`ClipDetailsEditor.jsx:9`, `AnnotateFullscreenOverlay.jsx:5`),
`ProjectManager.jsx:1180-1184`, `OverlayContainer.jsx:447-457`.

## Acceptance Criteria

- [ ] Each rerouted event lands in `user_actions` with the same milestone name (test per event family)
- [ ] `crop_adjusted` recorded once per session, not per drag
- [ ] `test_overlay_offer_events.py` rewritten for the new transport
