# T1701: Core Analytics -- Full Event Taxonomy + L2 Dashboard + Session Replay

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-05-13
**Epic:** [Analytics System](EPIC.md)
**Depends on:** [T1700](T1700-foundation.md) (OpenPanel deployed, SDK integrated, activation events flowing)

## Problem

After T1700, we have OpenPanel running with 8 activation events and a basic L1 dashboard. But we're only tracking the start of the funnel. We can't see:
- Where users drop off in the Annotate -> Framing -> Overlay -> Export pipeline
- Quest completion rates or which quest steps stall users
- Retention patterns (daily vs. weekly vs. per-game-event)
- Feature adoption (upscaling, team sharing, overlay effects)
- What users actually do in session replays

## Solution

Instrument the remaining 33 events (reaching 41 total), build the L2 Weekly Health dashboard with 7 sections, enable session replay, configure quest funnels, and replace admin panel stats with OpenPanel links.

See [analytics-system-plan.md](../../analytics-system-plan.md) Sections 3.3, 4.1 (full catalog), 4.2 (user properties), 10.3 (session replay) for full spec.

## Scope

### 1. Engagement Events (14 events)

Reuse T1700's `track.ts` pattern -- typed wrapper functions in `src/frontend/src/analytics/track.ts`.

| Event | Handler Location | Key Properties |
|-------|-----------------|---------------|
| `video_uploaded` | Upload handler, annotate mode | `duration_seconds`, `file_size_mb`, `sport`, `credits_cost`, `game_video_count`, `is_first`, `lifetime_count` |
| `clip_created` | Clip creation handler, annotate mode | `clip_duration`, `game_id`, `star_rating` (1-5), `tags[]`, `has_note`, `is_first`, `lifetime_count` |
| `clip_rated` | Star rating widget | `rating` (1-5), `rating_label` (brilliant/good/interesting/mistake/blunder) |
| `crop_applied` | Framing mode save/export | `aspect_ratio`, `keyframe_count`, `has_speed_changes`, `is_first` |
| `overlay_applied` | Overlay mode save/export | `highlight_count`, `effect_type`, `has_transition`, `is_first` |
| `export_started` | Export button handler | `format`, `resolution`, `has_upscale`, `clip_count` |
| `export_completed` | Backend export completion | `duration_seconds`, `output_size_mb`, `format`, `resolution`, `aspect_ratio`, `has_upscale`, `is_first`, `lifetime_count` |
| `export_failed` | Backend export failure | `error_type`, `stage` (ffmpeg/upscale/encode) |
| `clip_shared` | Share button handler | `method`, `recipient_count`, `is_first` |
| `team_share_sent` | Team share handler | `tag_count`, `recipient_count`, `clips_per_recipient_avg` |
| `gallery_viewed` | Gallery/My Reels mount | `reel_count`, `filter_applied` |
| `project_opened` | Project open handler | `project_age_days`, `clip_count`, `current_mode` |
| `auto_project_created` | Auto-project logic (5-star clip) | `clip_count`, `trigger` |
| `segment_speed_changed` | Framing segment speed control | `speed_value`, `segment_count` |

### 2. Retention Events (4 new events)

| Event | Handler Location | Key Properties |
|-------|-----------------|---------------|
| `game_created` | Game creation handler | `sport`, `video_count`, `game_count_lifetime`, `is_first` |
| `profile_created` | Profile creation handler | `sport`, `is_additional`, `profile_count` |
| `profile_switched` | Profile switcher | `from_sport`, `to_sport` |
| `recap_mode_viewed` | Recap mode entry | `game_age_days`, `clip_count`, `credits_expired_days_ago` |

(`session_started` already instrumented in T1700)

### 3. Quest Events (3 events)

| Event | Handler Location | Key Properties |
|-------|-----------------|---------------|
| `quest_step_completed` | Backend `GET /api/quests/progress` (when step transitions to completed) + `POST /api/quests/achievements/{key}` | `quest_name`, `step_number`, `total_steps`, `time_since_prev_step_hours` |
| `quest_completed` | Backend (when all steps in a quest are done) | `quest_name`, `total_time_hours`, `is_first_quest` |
| `streak_milestone` | Frontend streak tracker | `streak_days`, `milestone` (3/7/14/30) |

### 4. Feature Adoption Events (4 events)

| Event | Handler Location | Key Properties |
|-------|-----------------|---------------|
| `ai_upscale_requested` | Upscale toggle/button | `resolution`, `estimated_time`, `clip_duration` |
| `teammate_tagged` | Teammate tag handler in annotate | `tag_name`, `clip_count_for_tag`, `is_new_tag` |
| `shared_annotation_viewed` | Shared annotation page load | `viewer_is_registered`, `time_to_view_hours`, `clips_in_share` |
| `aspect_ratio_selected` | Aspect ratio picker in framing | `ratio`, `platform_intent` |

### 5. User Properties

**Set on identify** (update T1700's `identifyUser` function):
- Add: `athlete_count`, `activation_status`, `total_games`, `last_game_upload_date`, `quest_progress`

**Increment calls** (add to relevant handlers):
- `total_exports` -- on each `export_completed`
- `total_shares` -- on each `clip_shared`
- `total_games` -- on each `game_created`
- `total_credits_purchased` -- on each `credits_purchased` (Phase 3, but add the increment infrastructure now)
- `lifetime_revenue_cents` -- on each purchase

### 6. L2 Weekly Health Dashboard (7 sections)

Build in OpenPanel as dashboard "Weekly Health":

**L2-A Growth:**
- WAU trend (Linear, 8 weeks)
- New signups per week (Linear, 8 weeks)
- Signup method breakdown (Bar, 4 weeks) -- Google vs. OTP
- Signup sources breakdown (Bar, 4 weeks)

**L2-B Activation & Funnels:**
- Activation funnel: `signup_completed` -> `first_video_uploaded` -> `first_clip_created` -> `first_export_completed` -> `first_share_completed`
- Pipeline funnel: `video_uploaded` -> `clip_created` -> `crop_applied` -> `overlay_applied` -> `export_completed`
- Activation rate ticker (Linear, 8 weeks): % completing first export within 7d
- Time-to-first-export (Histogram, 4 weeks)

**L2-C Retention & LTV:**
- Retention grid: initial=`signup_completed`, return=`session_started`, weekly cohorts, segment by `has_purchased`
- Weekly active rate DAU/WAU (Linear, 8 weeks)
- D14/D7 retention ratio (Linear, 8 weeks)

**L2-D Monetization:** Placeholder -- built in T1702

**L2-E Quality & Stability:**
- Error rate ticker (Linear, 4 weeks)
- Top errors table (Bar, 7 days)
- Export success rate: `export_completed` / `export_started` (Conversion, 4 weeks)
- Session duration median (Linear, 4 weeks)

**L2-F Virality & Sharing:**
- Shares per user per week (Linear, 8 weeks)
- Share type breakdown (Bar, 4 weeks): reel shares vs. team shares vs. public links
- Team share adoption (Linear, 8 weeks): % of annotators using teammate tagging

**L2-G Engagement -- Quests & Features:**
- Quest funnel (5-step): upload game -> annotate clips -> create reel -> export highlight -> share highlight
- Per-quest funnels (4 funnels): Quest 1-4 with step-by-step conversion
- Feature adoption by mode (Bar, 4 weeks): Annotate vs. Framing vs. Overlay usage
- Star rating distribution (Histogram, 4 weeks)
- Aspect ratio preferences (Pie, 4 weeks)

### 7. Session Replay

Update T1700's SDK config to enable session replay:
- `sampleRate: 1.0` (record all sessions while <1000 users)
- `maskAllInputs: true`
- `maskAllText: false` (show UI labels for navigation understanding)
- Block video canvas: add `data-openpanel-replay-block` to `<canvas>` and `<video>` elements
- Mask athlete names, game names, clip names
- Show star ratings, tags, aspect ratio labels
- `flushIntervalMs: 10000`

### 8. Admin Panel -> OpenPanel Links

- Remove per-user stats computation from `admin.py` (games annotated, clips, projects, GPU seconds, quest progress)
- Replace stats section with links to OpenPanel per-user profile view (URL pattern: `analytics.reelballers.com/profiles/{user_id}`)
- Keep admin panel for admin actions (credit grants, account management, impersonation)

## Files Affected

| File | Change |
|------|--------|
| `src/frontend/src/analytics/events.ts` | Add ~25 new event constants |
| `src/frontend/src/analytics/track.ts` | Add typed wrapper functions for all new events |
| `src/frontend/src/analytics/identify.ts` | Add new user properties, increment calls |
| `src/frontend/src/analytics/openpanel.ts` | Enable session replay config |
| `src/backend/app/analytics/events.py` | Add matching Python event constants |
| `src/backend/app/analytics/tracker.py` | Add backend track functions (export_completed, export_failed, quest events) |
| Annotate mode handlers | Track clip_created, clip_rated, video_uploaded, game_created, teammate_tagged |
| Framing mode handlers | Track crop_applied, segment_speed_changed, aspect_ratio_selected |
| Overlay mode handlers | Track overlay_applied |
| Gallery handlers | Track gallery_viewed |
| Project handlers | Track project_opened, auto_project_created |
| Share handlers | Track clip_shared, team_share_sent |
| Profile handlers | Track profile_created, profile_switched |
| Quest handlers (backend) | Track quest_step_completed, quest_completed |
| Streak tracker (frontend) | Track streak_milestone |
| Recap mode | Track recap_mode_viewed |
| Upscale handler | Track ai_upscale_requested |
| Shared annotation page | Track shared_annotation_viewed |
| `src/backend/app/routers/admin.py` | Remove stats computation, add OpenPanel links |
| Video/canvas elements | Add `data-openpanel-replay-block` attribute |
| Athlete name displays | Add `data-openpanel-mask` or CSS selector for masking |

## Acceptance Criteria

- [ ] All 41 events instrumented and verified in OpenPanel Event Explorer
- [ ] `is_first` + `lifetime_count` properties on all repeating events
- [ ] User properties set via `identify()` (signup_date, method, sport, athlete_count, etc.)
- [ ] Increment calls wired for total_exports, total_shares, total_games
- [ ] L2 dashboard live with 7 sections (Growth, Activation, Retention, Quality, Virality, Engagement)
- [ ] Activation funnel (5-step) shows conversion at each step
- [ ] Pipeline funnel (5-step) shows pipeline drop-offs
- [ ] Per-quest funnels (4 funnels) show quest step conversion
- [ ] Retention grid configured (weekly cohorts, segmented by has_purchased)
- [ ] Session replay enabled, video canvas blocked, athlete names masked
- [ ] Session replays play back correctly (UI navigation visible, no blocked content leaking)
- [ ] Admin panel links to OpenPanel per-user views
- [ ] Admin panel no longer computes stats from SQLite
