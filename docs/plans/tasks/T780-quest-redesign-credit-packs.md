# T780: Redesign Quests 3 & 4 + Credit Pack Pricing

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-03-31
**Updated:** 2026-03-31

## Problem

Quest 3 currently asks users to upload a second game immediately after their first export — too much friction too early. Users who just learned the pipeline need to build the annotation habit on their current game before being asked to upload more content. Additionally, credit pack pricing needs to be set based on market-validated price points ($3.99 / $6.99 / $12.99).

## Solution

### Quest Redesign

**Quests 1 & 2 are unchanged** (already updated in prior work this session — titles/descriptions only, not rewards).

**Quest 1: "Get Started"** (reward: 15 credits) — unchanged steps
**Quest 2: "Export Highlights"** (reward: 25 credits) — unchanged steps

**Quest 3: "Find More Highlights"** (reward: 40 credits) — Build the annotation habit on the SAME game. No new uploads, no new concepts. Just rewatch and clip more.

| # | Step ID | Title | Description | Completion Condition |
|---|---------|-------|-------------|---------------------|
| 1 | `annotate_5_more` | Clip 5 More Plays | Go back to your game and clip 5 more plays — any rating. | 6+ total raw_clips on first game |
| 2 | `annotate_second_5_star` | Find Another 5 Star Moment | Every game has more than one highlight — find it! | 2+ clips rated 5 on first game |
| 3 | `export_second_highlight` | Export Another Highlight | Pick any 5-star project, frame it, and click "Frame Video". | 2+ framing export jobs started (any status) |
| 4 | `wait_for_export_2` | Wait For Export | Wait for the framing export to finish. | 2+ completed framing export jobs |

**Quest 4: "Highlight Reel"** (reward: 45 credits) — Second game + multi-clip reel. The payoff. User must purchase credits to complete (reel export exceeds remaining balance). Reward = 45 credits (more than the $3.99 Starter pack, reinforcing the purchase felt "free").

| # | Step ID | Title | Description | Completion Condition |
|---|---------|-------|-------------|---------------------|
| 1 | `upload_game_2` | Add a Second Game | Add another game — more highlights, bigger reel! | 2+ games |
| 2 | `annotate_game_2` | Annotate a Good or Great Play | Find a 4 or 5 star moment in your new game. | 1+ clip rated ≥4 on second+ game |
| 3 | `create_reel` | Create a Highlight Reel | Go to Projects → New Project. Pick clips from both games to build your reel. | 1+ non-auto project with clips from 2+ games |
| 4 | `export_reel` | Frame Your Reel | Frame your multi-clip highlight reel and click "Frame Video". | 1+ framing export started on non-auto project |
| 5 | `wait_for_reel` | Wait For Export | Wait for the export to finish. | 1+ completed framing export on non-auto project |
| 6 | `watch_reel` | Watch Your Reel | Open the Gallery and watch your finished highlight reel! | `viewed_custom_project_video` achievement |

### Quest Reward Structure

| Quest | Title | Reward | Multiplier |
|-------|-------|--------|------------|
| 1 | Get Started | 15 | — |
| 2 | Export Highlights | 25 | 1.67x |
| 3 | Find More Highlights | 40 | 1.6x |
| 4 | Highlight Reel | 45 | 1.125x |
| **Total** | | **125 credits** | |

**Economics:** 80 credits free in Q1–Q3. User consumes ~45 per game (1 game through Q1–Q3). ~35 credits remain entering Q4. Multi-clip reel export exceeds balance → user buys Starter ($3.99 = 40 credits). Completes Q4 → earns 45 credits. Net: user spent $3.99, has ~80 credits, feels the purchase was free. Hooked.

### Credit Pack Pricing

Market-validated consumer price points ($3.99 / $6.99 / $12.99):

| Pack | Price | Credits | Per Credit | Key |
|------|-------|---------|------------|-----|
| Starter | $3.99 | 40 | $0.100 | `starter` |
| Popular | $6.99 | 85 | $0.082 | `popular` |
| Best Value | $12.99 | 180 | $0.072 | `best_value` |

## Context

### Relevant Files

**Frontend:**
- `src/frontend/src/config/questDefinitions.js` — Quest step definitions (titles, descriptions, IDs, rewards)
- `src/frontend/src/components/BuyCreditsModal.jsx` — Credit pack UI (PACKS array)
- `src/frontend/src/components/QuestPanel.jsx` — Quest UI (may need Quest 3/4 completion modal update)

**Backend:**
- `src/backend/app/routers/quests.py` — `QUEST_DEFINITIONS`, `_check_all_steps()`, `KNOWN_ACHIEVEMENT_KEYS`
- `src/backend/app/routers/payments.py` — `CREDIT_PACKS` dict

### Related Tasks
- Follows: T540 (original quest system)
- No blockers

### Technical Notes

**New backend completion queries needed:**

Quest 3 (first game only):
- `annotate_5_more`: `SELECT count(*) FROM raw_clips WHERE game_id = (SELECT MIN(id) FROM games)` → ≥6
- `annotate_second_5_star`: `SELECT count(*) FROM raw_clips WHERE rating = 5 AND game_id = (SELECT MIN(id) FROM games)` → ≥2
- `export_second_highlight`: `SELECT count(*) FROM export_jobs WHERE type = 'framing'` → ≥2
- `wait_for_export_2`: `SELECT count(*) FROM export_jobs WHERE type = 'framing' AND status = 'complete'` → ≥2

Quest 4 (second game + custom project):
- `upload_game_2`: `SELECT count(*) FROM games` → ≥2
- `annotate_game_2`: `SELECT 1 FROM raw_clips WHERE rating >= 4 AND game_id != (SELECT MIN(id) FROM games) LIMIT 1`
- `create_reel`: Check for a non-auto project whose working_clips (via raw_clips) span 2+ distinct game_ids
- `export_reel`: `SELECT 1 FROM export_jobs ej JOIN projects p ON ej.project_id = p.id WHERE ej.type = 'framing' AND p.is_auto_created = 0 LIMIT 1`
- `wait_for_reel`: Same but with `status = 'complete'`
- `watch_reel`: Reuses existing `viewed_custom_project_video` achievement

**Old Quest 3 steps to remove from backend:** `upload_game_2` (moves to Q4), `annotate_brilliant_2`, `annotate_4_star`, `create_mixed_project`, `frame_custom_project`, `start_custom_framing`, `complete_custom_framing`, `overlay_custom_project`, `watch_custom_video`

**Old backend queries to remove:** Lines 114-195 in quests.py (entire old Quest 3 section) — replace with new Quest 3 + Quest 4 queries.

**Credit pack changes:** Update both `CREDIT_PACKS` in payments.py AND `PACKS` in BuyCreditsModal.jsx. The `key` names change: `starter` stays, `popular` stays, `pro` → `best_value`. Price cents: 399, 699, 1299. The `minutes` display field in BuyCreditsModal needs updating to reflect seconds of video (40s / 85s / 180s = "~3 clips" / "~6 clips" / "~14 clips" at ~13 credits/clip average).

## Acceptance Criteria

- [ ] Quest 1 reward = 15, Quest 2 reward = 25 (updated from 25/50)
- [ ] Quest 3 = "Find More Highlights" with 4 steps, reward = 40
- [ ] Quest 4 = "Highlight Reel" with 6 steps, reward = 45
- [ ] All Quest 3 completion conditions query first game only (not second+ game)
- [ ] Quest 4 `annotate_game_2` accepts rating ≥ 4 (not just 5)
- [ ] Quest 4 `create_reel` verifies clips from 2+ games in the project
- [ ] Old Quest 3 steps and queries fully removed
- [ ] Credit packs: Starter $3.99/40cr, Popular $6.99/85cr, Best Value $12.99/180cr
- [ ] Frontend BuyCreditsModal matches new pack pricing
- [ ] Backend CREDIT_PACKS matches new pack pricing
- [ ] Backend import check passes
- [ ] Frontend build passes
- [ ] All unit tests pass
