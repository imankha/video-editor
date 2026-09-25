# Remove the Quest System

**Status:** TODO (all questions answered 2026-09-24)
**Started:** 2026-09-24
**Impact:** 6 **Complexity:** 5 **Priority:** 1.2
**Decision artifact:** https://claude.ai/artifact/CWHnjGEUCzqMhgeyQGrzwB

## Goal

Owner ruling 2026-09-24: "Remember there are no more quests, I want you to remove that whole
system and just save information we will need to make a 'guided' system later (user can turn on
guided and gets a guided experience to progress them to the next step)."

## Audit findings (2026-09-24, master @ 968ce965)

1. **Credits (the one dangerous part).** Quests still pay **80 of the 88 free credits** a new
   user gets: `session_init.py:314-329` -> `credit_ledger.grant_quest_chain_credits`
   (`credit_ledger.py:761-792`) grants `QUEST_CHAIN_CREDIT_TOTAL = 80` (`quest_config.py:24`)
   minus what was already granted, source `quest_upfront`, key `questbank:{user_id}`,
   "already granted" = `SUM(amount)` over sources `('quest_reward','quest_upfront')`
   (`credit_ledger.py:744-758`). Signup bonus is separate (`NEW_ACCOUNT_CREDITS=8`,
   `storage_credits.py:26`). The landing page advertises 88 (`landing/src/site.ts:72-73`).
   - Deleting `quest_config.py` or the grant silently cuts new signups to 8 and makes the
     landing claim false.
   - **NEVER rename** the `quest_upfront` source, the `questbank` key prefix or the summed
     source set: the remainder calc would see 0 and pay 80 again to every account.
2. **The quest UI is already gone.** `QuestPanel.jsx` no longer exists; `QuestIcon.jsx` and
   `config/questDefinitions.jsx` have no live importers. What remains is invisible plumbing
   (progress derivation, `/api/quests` achievements endpoint, bootstrap fields) plus ~40 refresh
   calls sprinkled through the app. Knowledge docs are stale here
   (`backend-services.md:158-174,477`, `annotate.md:1970,2450`).
3. **The achievements POST doubles as the admin-funnel analytics bridge**
   (`ACHIEVEMENT_TO_MILESTONE`, `quests.py:77-109`): `add_game_opened`,
   `upload_file_selected`, `add_clip_opened`, `opened_framing_editor` /
   `opened_overlay_editor`, `crop_adjusted`, `speed_segment_created`, overlay steps, overlay
   offered/deferred/declined, `previewed_draft_reel_1s`, `played_annotations`, gallery events,
   `watched_*_tutorial`. It must be rerouted (with per-session dedup) before deletion, or the
   admin funnel loses those events (G4).
4. **Guided mode needs nothing from quests.** Every T7620 fact (hasGame, clipCount, hasDraft,
   hasExported, hasWorkingVideo, hasPublishedReel, hasShared) is derivable from games,
   raw_clips, projects, export_jobs / `user_activity.last_export_at`, final_videos and shares.
   Keep: `shared_by` provenance columns and the "facts exclude shared-in content" rule (T5330),
   the `user_settings` KV table, `FLOW_EVENTS` history labels. This **amends the approved
   T7620 design** (§13.1 and T10330:40-41 said the quest milestone ledger survives); needs the
   owner's sign-off (G3).
5. **Migration landmine:** user_db v005/v006 read `completed_quests`. If `_USER_DB_SCHEMA`
   stops creating it, any user.sqlite below v005 fails "no such table" -> 503. Keep the DDL
   until the floor prune passes v006, or guard v005/v006 with a table-exists check.

## Tasks (strict order)

| ID | Task | Tier | Status |
|----|------|------|--------|
| T11170 | [Welcome credits no longer depend on quests](T11170-welcome-credits-decouple.md) | M | STAGING (merged PR #508, proof VERIFIED, CI green) |
| T11175 | [Reroute funnel analytics off the quest achievements endpoint](T11175-funnel-analytics-reroute.md) | M | TODO |
| T11180 | [Delete the quest system, frontend](T11180-delete-quests-frontend.md) | M | TODO |
| T11185 | [Delete the quest system, backend (+ optional table drops)](T11185-delete-quests-backend.md) | M | TODO |

Backend deletion ships in the same deploy as the frontend deletion or later, never earlier:
old cached frontends read the bootstrap quest fields.

## Decisions (owner, 2026-09-24)

| # | Decision |
|---|---|
| G1 | New users keep **88** free credits (8 + 80), the 80 now a "welcome" grant. |
| G2 | The T9760 admin backfill was **never run on prod**, but the per-login grant (`session_init`) pays the remainder to every user on their next session, which is the just-in-time path the owner wants. **Delete the admin backfill endpoint** (`admin.py:1400-1419`, `credit_ledger.py:795-861`). |
| G3 | **Amend T7620**: no quest milestone ledger; guided facts come from games, clips, exports, final_videos, shares. |
| G4 | **Keep** the admin funnel's engagement events (T11175 reroutes them). |
| G5 | **Drop** the quest tables via JIT migrations, after guarding v005/v006. |
| G6 | **Keep** `TutorialVideoModal`, re-keyed by topic. |

## Completion Criteria

- [ ] A fresh signup still ends at the advertised credit total; repeat logins never double-grant
- [ ] No `/api/quests` route, quest store, quest config or quest UI remains
- [ ] Admin funnel events still recorded (per G4)
- [ ] Knowledge docs and T7620/T7630/T10330 amended
