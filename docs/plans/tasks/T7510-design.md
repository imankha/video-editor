# T7510 Design — Activity tracking: attempted vs successful, everywhere

**Status:** DESIGN — awaiting user approval (design gate)
**Tier:** L | **Layers:** Backend + Frontend | **Author:** T7510 worker | **Date:** 2026-08-26

---

## 1. Problem restated (one line)

The admin funnel/journey views count INTENT events as ACCOMPLISHED FACTS. `game_created`
fires on the `pending` game insert *before a byte is uploaded*; `annotation_completed` fires
because a user watched some video, not because clips exist. So five failed uploads across two
users produced dashboards indistinguishable from success. This task makes ATTEMPT and OUTCOME
structurally distinct at every funnel step, surfaces the gap between them, and rebinds every
success/milestone emission to a durable completion point.

---

## 2. Current-state emission-site inventory (Implementation Step 1)

Legend — **Side:** INTENT = fires at gesture/attempt time before the thing durably persists;
OUTCOME = fires only after the result provably persists. **Imp-guard:** every
`record_milestone`/`update_session` call is impersonation-guarded internally
(`get_current_impersonator_id` early-return, `analytics.py:272`, `:403`).

### Backend milestones (`record_milestone` unless noted)

| Event | Site | Fires on | Side | Notes |
|---|---|---|---|---|
| `game_created` | `games.py:455` (`create_game`) | after `INSERT games` commit — game is usually `pending`, **no R2 bytes yet** | **INTENT** ❌ | **The core lie.** Funnel "Uploaded" step reads this. |
| `clip_created` | `clips.py:1289` (`save_raw_clip`, new-clip branch) | after `INSERT raw_clips` commit | OUTCOME ✅ | Durable (TrackedConnection R2 sync). |
| `annotation_completed` | `games.py:1909` (`finish_annotation`) | `viewed_duration>0` AND rowcount>0 (T7500 404-guarded) | OUTCOME-of-*viewing* ⚠️ | Tracks "left annotate having watched video", **not clips produced**. Mislabeled as content. |
| `export_started` | `exports.py:453` (`create_export`) | after `create_export_job` returns id | INTENT (by design) | The framing-export attempt. |
| `export_completed` + `framing_exported` | `export_worker.py:185-186` | after `update_job_complete`, if `credit_user_id` | OUTCOME ✅ | Render finished. **Activation metric (T7460) reads `export_completed` — keep stable.** |
| `export_failed` | `export_worker.py:199` | on export exception | OUTCOME (failure) ✅ | No machine-readable reason today. |
| `export_completed` + `overlay_exported` | `overlay.py:279-280` (`_finalize_overlay_export`) | after `INSERT final_videos` commit; R2 render already up | OUTCOME ✅ | |
| `export_completed` (recovered) | `exports.py:247` | `result['finalized'] and not already_finalized` | OUTCOME ✅ | Idempotent-gated. |
| `credits_consumed` | `credit_ledger.py:481` (`confirm_reservation`) | after reservation consumed | OUTCOME ✅ | |
| `video_downloaded` | `downloads.py:727` | after `SELECT final_videos` found (404 else) | INTENT-of-download ✅ | Artifact provably exists. |
| `collection_downloaded` | `collections.py:1061` | members resolved | ✅ | |
| `share_completed` | `collections.py:1595` | after `create_collection_share` | OUTCOME ✅ | |
| `invite_sent` | `collections.py:1628` | per-email after `gather` send | OUTCOME ✅ | |
| `quest_completed` | `quests.py:397` (`claim_reward`) | after atomic PG grant | OUTCOME ✅ | |
| `payment_started` | `payments.py:213` | after Stripe PI created | INTENT (by design) | The payment attempt. |
| `payment_completed` + `credit_purchased` | `payments.py:281-282` (+webhook 350/386/529) | gated on `result['applied']` | OUTCOME ✅ | |
| `pwa_installed` | `auth.py:507` | on POST | OUTCOME ✅ | |
| `session_started` / `pwa_session_started` | `analytics.py:484-502` via `update_session` | `is_new_session` 30-min boundary (T7570 `FOR UPDATE`) | OUTCOME ✅ | |
| `share_viewed` | beacon `POST /api/shared/{token}/viewed` → `record_milestone` | edge share-page view | OUTCOME ✅ | |
| signup segment + `signups` counter | `auth.py:389/649` via `create_user_segment` | `if is_new` | OUTCOME ✅ | |

### The durable point that emits NOTHING (the fix's anchor)

- **`finalize_upload` (`games_upload.py:289`, returns `SUCCESS` at `:404`)** — completes the R2
  multipart, HEAD-verifies bytes+size, deletes the `pending_uploads` row. This is where a game
  upload becomes **durable**, and it emits **no analytics at all**. `activateGame` (status→`ready`
  flip) also emits nothing. So the ONLY upload signal today is the intent-side `game_created`.
- **`list_pending_uploads` reaper (T7490, `games_upload.py`)** sets `games.status='upload_failed'`
  on a stale pending row — a real failure signal that emits no analytics.

### Frontend-fired achievements (`questStore.recordAchievement` → `POST /api/quests/achievement`
→ `record_achievement` → `ACHIEVEMENT_TO_MILESTONE` bridge, `quests.py:446`)

All are session-deduped, fire-and-forget. Classified by whether they represent a **content
outcome** or **UI engagement**:

| Achievement | Bridged milestone | Class |
|---|---|---|
| `moved_to_my_reels` (`DraftTile.jsx:168`) | `moved_to_my_reels` | **CONTENT OUTCOME** (has a durable backend: `move_reels_to_profile`) — misplaced on the frontend |
| `clip_rated` (`questAchievements.js:10`) | (step-only, no milestone) | UI engagement |
| `opened_framing_editor`/`opened_overlay_editor` (`App.jsx:458/465`) | `framing_opened`/`overlay_opened` | UI engagement |
| `add_clip_opened` (`AnnotateContainer.jsx:783`) | `add_clip_opened` → **dropped** (not in `FLOW_EVENTS`, logs "Unknown event") | UI engagement |
| `crop_adjusted`, `speed_segment_created`, `overlay_players_assigned`, `overlay_color_set`, `overlay_shape_set` | same-named | UI engagement |
| `viewed_gallery_video`/`viewed_custom_project_video`/`watched_gallery_video_1s` | `gallery_viewed`/`custom_project_viewed`/`gallery_watched_1s` | UI engagement |
| `played_annotations` (`useAnnotationPlayback.js:284`) | `annotations_played` | UI engagement |
| `previewed_draft_reel_1s` (`DraftTile.jsx:274`) | same | UI engagement |
| `watched_{annotate,framing,overlay,publish}_tutorial` | same → **dropped** (not in `FLOW_EVENTS`) | UI engagement |

**Dashboard read sites** (targets of §5):
- Journey `GET /analytics/journey/{user_id}` (`admin.py:1275`) → `{milestones:[{event,at,count}], session_count,...}`; front `UserDetailPanel.jsx` `PIPELINE_STEPS` keys off `game_created, clip_created, annotation_completed, framing_opened, framing_exported, overlay_exported, share_completed, credit_purchased`.
- Funnel `GET /analytics/funnel` (`admin.py:977`) → `{funnel:[{origin, signed_up, <label_snake>:count}]}`; front `FunnelChart.jsx` reads snake-cased `FLOW_EVENTS` labels.
- Pulse `GET /analytics/pulse` (`admin.py:1416`) → daily_counters cards; front `PulseCards.jsx`.
- User actions `GET /analytics/user/{id}/actions` (`admin.py:1341`) → SQLite `user_action_log` rows.

**Table shapes:** `user_actions` PK `(user_id, action, platform)`, cols `first_at,count` — an
**aggregate** keyed by action name. `daily_counters` PK `(counter_date, origin_type)`, one INTEGER
column per dimension. `user_action_log` (SQLite/user.sqlite): `id, action, context(JSON), created_at`.

---

## 3. Taxonomy — attempt / outcome / failure-reason per funnel action

**Principle:** every funnel action emits an `_attempted` at gesture time and, at its durable
completion point, EITHER `_succeeded` OR `_failed` carrying a coarse machine-readable `reason`.
Success NEVER fires from an intent-side path. Reasons are a closed vocabulary:

```
REASON ∈ { timeout, network, refused, sync_failed, user_abandoned, unknown }
```
(`refused` = server/validation rejection e.g. quota/format; `sync_failed` = R2 CAS/durable-sync
refusal; `user_abandoned` = reaped pending / navigated away; `unknown` = uncaught.)

| Action | `_attempted` site (gesture) | `_succeeded` site (durable) | `_failed:{reason}` site |
|---|---|---|---|
| **game_upload** | `create_game` `games.py:455` (the pending insert IS the attempt) | **NEW: `finalize_upload` `games_upload.py:404`** after R2 HEAD-verify | **NEW: reaper `list_pending_uploads`** (`user_abandoned`) + T7480 failure beacon (`timeout`/`network`/`refused`) |
| **clip_create** | `save_raw_clip` entry (Save Clip gesture) | `clip_created` `clips.py:1289` (existing) | durable-sync 503 (`sync_failed`) / validation (`refused`) |
| **annotation** | enter-annotate (frontend gesture, see below) | `clip_created` is the true content outcome | n/a (viewing has no "failure") |
| **framing_export** | `export_started` `exports.py:453` (existing) | `framing_exported` `export_worker.py:185` (existing) | `export_failed` + reason `export_worker.py:199` |
| **overlay_export** | `export_started` (verify overlay path shares it; else add) | `overlay_exported` `overlay.py:280` (existing) | `export_failed` + reason |
| **publish/share** | **NEW: `share_attempted`** at Share gesture | `share_completed` `collections.py:1595` (existing) | durable-sync 503 (`sync_failed`) |
| **move** | **NEW: `move_attempted`** at move gesture | **NEW server-side: `move_succeeded`** at `move_reels_to_profile` durable sync OK | `sync_failed` on the multi-phase durable failure (T6350) |
| **payment** | `payment_started` `payments.py:213` (existing) | `payment_completed` `payments.py:281` (existing) | **NEW: `payment_failed:{reason}`** on Stripe decline/webhook `payment_intent.payment_failed` |

**annotation_completed** is NOT deleted — it is **relabeled** as an engagement signal
("Annotate session ended", tracks watched-video, not clips). It stays honest as long as the
dashboard renders it under engagement, not under content outcomes (§5).

### Failure-reason storage
`user_actions` is keyed by action name, so a per-reason breakdown is encoded IN the action
string: **`game_upload_failed:timeout`, `game_upload_failed:network`, …** — new rows in the
existing aggregate, queryable per reason with a `LIKE 'game_upload_failed:%'` scan, no new table.
The reason ALSO rides `context` in the per-user `user_action_log` for the journey trail.

---

## 4. Storage shape + the T7400 sequencing decision

### 4a. T7400 sequencing — DECIDED: **do NOT block on T7400; do NOT build `analytics.sqlite` here.**

Confirmed via `git log origin/master`: T7400 is only **filed** (`5f6a502e T7400-T7450: file
Investor-Grade Analytics epic`), **NOT landed** — `src/backend/app/services/analytics_store.py`
does not exist, and `rollup_action_weekly`/`rollup_engagement_monthly` do not exist.

**Decision (kickoff option b, refined):** T7510 lands its attempt/outcome/failure dimensions as
**new action names on the existing PG `user_actions` aggregate** and **new columns on the existing
`daily_counters` table** — exactly what the task file's Constraints section endorses ("Existing
tables … are extended, not paralleled"). This is NOT a second aggregate store: `user_actions` is
already an aggregate (counts + first_at, keyed by action), and adding action names is extension,
not a new table. The memory rule `feedback_analytics_in_house_aggregates_only` forbids **new
Postgres tables** and per-event rows — neither is introduced here.

**Why not build `analytics.sqlite` now (kickoff option a):** T7400's whole deliverable is that
store + its rollup schema. Building a partial `analytics_store.py` here would force T7400 to
reconcile two authors' schemas and risks colliding with its planned
`rollup_action_weekly`/`rollup_engagement_monthly`. T7510's counters are RAW dimensions; T7400's
rollup layer, when it lands, reads FROM `user_actions`/`daily_counters` (as its own tasks already
specify) and will roll up T7510's new action names identically to existing ones — **zero schema
collision, because T7510 adds no rollup tables.** This is the lower-risk ordering and keeps the
P1 diagnostic-honesty fix unblocked by a not-yet-started 6-task epic.

> **This is the one decision that most needs your sign-off.** If you would rather T7510 wait for
> T7400's `analytics_store.py` and put counters there, say so at this gate — but note that leaves
> the misleading dashboard live until a 6-task epic completes.

### 4b. Concrete storage changes

1. **PG `user_actions`** (no schema change — new rows only): new action names
   `game_upload_attempted`, `game_upload_succeeded`, `game_upload_failed:{reason}`,
   `clip_save_attempted`, `clip_save_failed:{reason}`, `share_attempted`,
   `move_attempted`, `move_succeeded`, `payment_failed:{reason}`. `_succeeded`/`_failed` count
   dimensions must be added to `FLOW_EVENTS` (so `record_milestone` accepts them, not "Unknown
   event") with an explicit `daily_col` where a per-day rollup is wanted.
2. **PG `daily_counters`** (additive columns via PG migration + `_SCHEMA_DDL` update — **fresh-DB
   DDL AND a `v0NN` postgres migration, both**, per Invariant 4): add the headline attempt/success/
   fail columns the Pulse view needs — `game_uploads_attempted`, `game_uploads_succeeded`,
   `game_uploads_failed`, `clips_attempted`, `clips_failed`. Per-reason detail stays in
   `user_actions` (not exploded into columns). *(Note: this task is classified Migration=No because
   `analytics.sqlite` was assumed; adding `daily_counters` columns re-introduces a Postgres
   migration — flagged here for the gate. See §8.)*
3. **SQLite `user_action_log`** (no schema change): every new event already flows through
   `record_milestone`, which writes the per-user audit row with `context` (carries `reason`).

---

## 5. Dashboard changes — attempted vs completed, side by side

**Goal:** bigajosue reads *"attempted 4 uploads, 0 succeeded, paid $3.99, lost"* at a glance.

1. **Journey (`admin.py:1275` + `UserDetailPanel.jsx`).** For each funnel action render an
   `attempted / succeeded / failed(by reason)` triple instead of a single milestone dot. Extend
   `PIPELINE_STEPS` so each step reads its `_attempted` and `_succeeded` action counts from the
   `user_actions` aggregate; show the gap and, on hover, the failure-reason breakdown from the
   `game_upload_failed:*` rows. `annotation_completed` moves to a separate **Engagement** band,
   visually distinct from the content-outcome band.
2. **Funnel (`admin.py:977` + `FunnelChart.jsx`).** Each stage renders two series — attempted vs
   completed — with the conversion gap as the delta. Keep the existing `export_completed`-derived
   `exported` column stable (activation metric). New stages: upload attempted vs succeeded.
3. **Pulse (`admin.py:1416` + `PulseCards.jsx`).** Add an "Upload success rate" card
   (`game_uploads_succeeded / game_uploads_attempted`) sourced from the new daily_counters columns.
4. **User actions log** already renders `user_action_log` verbatim — new events + `reason` context
   appear automatically.

Continuity: existing labels (`Uploaded`, etc.) keep rendering; the **"Uploaded" funnel step
re-points from `game_created` to `game_upload_succeeded`** so it stops counting attempts as
successes — this is the single semantic flip that fixes the reported lie. `game_created` keeps
firing and is relabeled "Upload Attempted".

---

## 6. Milestone/quest rebinding plan (per achievement)

- **Content-outcome achievements → move server-side to the durable point:**
  `moved_to_my_reels` — emit `move_succeeded` from `move_reels_to_profile` on durable-sync OK
  (T6350 multi-phase), drop the frontend-fired milestone bridge for it (keep the frontend
  achievement row for quest-step derivation, but it no longer *bridges to a content milestone*).
- **UI-engagement achievements → keep frontend-fired, LABEL as engagement:** `opened_framing_editor`,
  `opened_overlay_editor`, `crop_adjusted`, `speed_segment_created`, `overlay_*`, `played_annotations`,
  `viewed_gallery_video`, `previewed_draft_reel_1s`, tutorial watches. These are honest *attempt/
  engagement* signals — they stay, but the dashboard renders them in the Engagement band, never as
  content outcomes. Fix the two **dropped** milestones (`add_clip_opened`, `watched_*_tutorial`) by
  adding them to `FLOW_EVENTS` as engagement dimensions (`daily_col: None`) so they stop logging
  "Unknown event".
- **`record_milestone` calls already at durable points stay** (`clip_created`, `overlay_exported`,
  `payment_completed`, `quest_completed`). The ONE new server-side success emission is
  `game_upload_succeeded` at `finalize_upload`.
- **Impersonation:** every new emission routes through `record_milestone` (guarded) OR, for the
  frontend-bridged ones, through `record_achievement` (also guarded, `quests.py`). The **client
  error-capture ingest endpoint (§7 tier 2) must add the `get_current_impersonator_id` guard
  explicitly** — it is a new sink that does not go through `record_milestone`. Audited sites needing
  an explicit guard: `finalize_upload` success emission (uses `record_milestone` ✅ guarded),
  reaper failure emission (uses `record_milestone` ✅), move success (uses `record_milestone` ✅),
  error-capture endpoint (**needs explicit guard** ⚠️).

---

## 7. Frustration-signal scope (explicit tier decisions — nothing silently dropped)

The measurement review lists 5 ranked tiers. This task's scope:

| Tier | Signal | Decision |
|---|---|---|
| **1** | Interaction-outcome pairs on critical CTAs (Add Game, Add Clip, Save Clip, Export, Share, Pay): clicked → next stage reached / failed(reason) | **IN SCOPE** — this IS the §3 attempt/outcome taxonomy. Delivers the "tapped and nothing happened vs never tapped" disambiguation (bug #18). |
| **2** | Client error capture: ring buffer of `console.error`/`window.onerror`/unhandled rejections, flushed via the T7480 beacon + attached to bug reports (T7560) | **IN SCOPE (bounded)** — cheap, rides the existing T7480 beacon channel; add a small capped ring buffer + one ingest endpoint (impersonation-guarded, aggregate counts only, no PII payloads beyond error string + route). |
| **3** | Blocking-dialog / error-toast impressions (name + per-session count) | **DEFERRED → follow-up task T75xx** — needs a toast/dialog instrumentation layer touching many components; out of this task's blast radius. |
| **4** | Session-exit breadcrumbs (last screen + per-screen dwell → `user_action_log`) | **DEFERRED → follow-up task T75xx** — overlaps the T7480/bug-report `actions` trail; sequence after that. |
| **5** | Derived frustration flags in journey view (retry-burst ≥3×/60s, repeat-visit-no-progress, rapid-fire) | **PARTIAL — retry-burst only IN SCOPE** as a read-time derivation over the new `_attempted` timestamps (no new storage); repeat-visit + rapid-fire **DEFERRED**. |

Second-tier items (device/UA capture, viewed_duration semantics, UTM attribution, help-seeking
signals) are all **DEFERRED** and named here so they are not silently lost.

I recommend filing the deferred items as **T7520 "Frustration mid-funnel instrumentation"** at
approval time.

---

## 8. Risks / open items for the gate

1. **Migration classification flip.** The kickoff classified Migration=No on the assumption new
   state lands in `analytics.sqlite`. §4b adds **`daily_counters` columns** (Postgres), which DOES
   need a `postgres` `v0NN` migration + `_SCHEMA_DDL` update (Invariant 4). **Recommend adding the
   Migration agent** to the pipeline, OR (leaner) drop the daily_counters columns and derive the
   Pulse "upload success rate" card from `user_actions` at read time — no migration, slightly
   heavier read query. **Need your call.**
2. **`export_started` overlay coverage** — verify overlay export shares the `export_started`
   attempt emission; if not, add it (implementation detail, low risk).
3. **T7460 scorecard** reads `export_completed` (`admin.py:242,1065,1126,1223,1405`) — an OUTCOME
   event left UNCHANGED, so scorecard inputs are unaffected. ✅ constraint satisfied.
4. **Continuity window:** `game_created` keeps firing throughout; only the funnel's read mapping
   flips to `game_upload_succeeded`. No consumer breaks mid-transition.
5. **Scope size.** Even with tiers 3-5 deferred, this touches ~10 files across both layers. If you
   want a smaller first cut, the minimal honest fix is: (a) emit `game_upload_succeeded` at
   `finalize_upload`, (b) flip the funnel "Uploaded" mapping, (c) relabel `annotation_completed`
   as engagement. That alone kills the reported lie; the rest is completeness.

---

## 9. Test plan (Tester Phase 1 targets)

- Backend unit: `finalize_upload` emits `game_upload_succeeded` exactly once, impersonation
  emits nothing; reaper emits `game_upload_failed:user_abandoned`; `record_milestone` accepts the
  new `FLOW_EVENTS` names (no "Unknown event"); funnel read maps "Uploaded" to succeeded.
- Frontend unit: journey/funnel components render attempted vs succeeded columns + gap.
- **Acceptance (task criterion, not optional):** replay the bigajosue scenario on local/staging —
  failed uploads + annotate-without-clips — and confirm the dashboard reads *attempts visible,
  zero completions, failure reasons present*. A green unit suite alone does NOT satisfy this.

---

## Approval

**STOP — user approval required before implementation.** Key decisions needing sign-off:
1. §4a T7400 sequencing (extend existing PG aggregates now vs wait for T7400's `analytics.sqlite`).
2. §8.1 daily_counters migration vs read-time derivation (Migration agent in/out).
3. §7 frustration-tier scope (tiers 1+2 + partial 5 in; 3, 4, rest deferred to T7520).
4. §8.5 full completeness pass vs minimal 3-step honest fix.
