# T10330: Guided mode, next iteration: post-publish advanced tier, remaining forks, ledger cleanup

**Status:** TODO (next iteration, AFTER the Deploy Candidate ships)
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-17
**Updated:** 2026-09-17
**Epic:** [Tutorial Redesign](EPIC.md)
**Blocked by:** T7630, T7640 (the essential-path core must be live and user-approved first)

## Why this is split out

User ruling 2026-09-17: the Tutorial Redesign epic is built in concert with the Deploy Candidate.
Whatever supports the next deploy is front-loaded into that milestone (T7630 re-scoped to the
essential-path core, plus T7640's matrix and rollout); whatever is left lands here, in the next
iteration. The split follows the design's own deferral boundary (`T7620-design.md` §19, "Copy
volume: 69 rules"): the post-publish advanced tier is pull-first and never auto-engages on screen
entry, so shipping without it changes nothing about how a new parent gets to a shared clip.

## Scope (carved out of T7630)

1. **Post-publish advanced tier A1 to A10** (design §3.1, 21 rules, `rung: 'A'`): Play your
   annotations, Share the whole game, Share annotations with a teammate's family, Athlete Intro
   Card, Rank your reels (gated on ranking being deployed and unlocked), Trim/rate/tag a play,
   Slow motion and the dim check, Style the spotlight/titles/cover frame, Compilations and
   downloads, Build a Highlight from several clips. Includes the three surfaces: fork F8's second
   answer ("Show me what else I can do"), the Help chip becoming a menu once unlocked, and the
   one-earned-nudge-per-set-per-account engagement rule with its `guidanceMap.unlock.test.js` /
   `engagement.test.js` guards. Until this ships, T7630's Help panel lists only the ladder, the
   toggle, "Watch the walkthrough" and Report a problem; F8's second answer opens that panel.
2. **Fork F7 (expired source)** and any other non-essential fork the core did not need. Fork F6
   (stuck check after two dismissals) is OBSOLETE under ruling 1 (no per-step dismissals exist;
   the stall pulse covers the stuck case) and should be deleted from the map, not built.
3. **Ledger and legacy cleanup** the core deliberately leaves in place to keep its diff small:
   delete `POST /quests/panel-collapsed` + `get/set_quest_panel_collapsed` (`services/user_db.py`),
   delete `utils/modalOcclusion.js` (T8120's second positioning system, subsumed by the anchor
   engine per design §2.2), retire the dead `TUTORIAL_VIDEOS_ENABLED` flags on both sides once the
   Help-panel video entry point (T7630/T10320) is the only path, and the e2e specs that assert the
   old quest panel (`T4780-tutorial-quest-steps.spec.js`, `T8120-quest-overlay-modal-occlusion.qa.spec.js`).
   `quest_config.py` step ids, achievements, `/api/quests/progress` and `questStore.recordAchievement`
   SURVIVE as the milestone ledger (identifiers never renamed, T7930 lesson).
4. **Voice-readiness audit** (design V2): every rule's `say` copy is a short spoken-style sentence;
   TTS itself stays out of scope.
5. **Per-rule measurement readout**: impression beacons already ship with the core; add the admin
   readout of per-rule engagement / completion so the map can be revised from evidence.

## Context

### Relevant Files
- `src/frontend/src/guide/guidanceMap.js` (A-rules), `engagement.js`, `HelpPanel.jsx`, `GuideLadder.jsx`
- `src/frontend/src/utils/modalOcclusion.js` (delete), `src/backend/app/services/user_db.py`,
  `src/backend/app/routers/quests.py`, `src/backend/app/quest_config.py:44`,
  `src/frontend/src/config/questDefinitions.jsx:50`
- `docs/plans/tasks/T7620-design.md` §3.1, §8 (F6/F7), §13.1, §14, §19

### Related Tasks
- Depends on: T7630 (core), T7640 (matrix + rollout), T10320 (videos in the Help panel)
- Sibling: T7620 (design, DECIDED) is the spec for both halves

## Acceptance Criteria

- [ ] A1 to A10 resolve only after first publish, never auto-engage on screen entry, nudge at most
      once per set per account; Help chip lists current-screen sets first
- [ ] F6 removed from the map; F7 built; monotonic + coverage tests still green
- [ ] Legacy quest-panel endpoints, `modalOcclusion.js`, and the video flags deleted; ledger intact
- [ ] Per-rule engagement readout visible in admin
