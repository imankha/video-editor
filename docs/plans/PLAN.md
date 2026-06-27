# Project Plan

## Current Focus

**Phase: Feature** — Season Highlights & Collections epic: My Reels becomes the curation home (annotate → publish → rank → share). Spec: [season-highlights-spec.md](season-highlights-spec.md) · Tech notes: [season-highlights-tech-notes.md](season-highlights-tech-notes.md)

**Landing Page:** Already live at `reelballers.com`

### Production Reported Bugs

Bugs reported by users on production. Populated from Postgres `bug_reports` table via task board API. Use "Copy Kickoff Prompt" to investigate.

| ID | Description | Reporter | Status | Created | Description |
|------|------|------|------|------|------|

### Staging Reported Bugs

Bugs reported or discovered on staging. Populated from Postgres `bug_reports` table via task board API. Use "Copy Kickoff Prompt" to investigate.

| ID | Description | Reporter | Status | Created | Description |
|------|------|------|------|------|------|

### Next Up

Queued for the next working session.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T3900 | [My Reels Badge = Unseen/New Count](tasks/T3900-my-reels-number-meaning.md) | 5 | 2 | 2.5 | DONE | [ ] | DONE (diverged from investigate-only framing): both My Reels badges (home button + panel header chip) rebound to the unseen/new count (reels with `watched_at IS NULL`); dropped the "9+" cap, added a "(N new)" label, and wired the watched-decrement via an idempotent `fetchCount()` recompute (gesture-based). Backend `/api/downloads/count` returns `count` + `unwatched_count`. |
| T3910 | [Multi-Clip Aspect Ratio Applies to All Clips](tasks/T3910-multiclip-aspect-ratio-all-clips.md) | 7 | 4 | 1.8 | DONE | [ ] | DONE: reel-level aspect-ratio gesture — the Framing selector applies the ratio to all clips via `POST /api/clips/projects/{id}/aspect-ratio`; server-side center-preserving crop re-fit (`refit_crop_keyframes`, clamped to frame bounds, preserves origin/frame), surgical persistence, single-clip unchanged. Design doc T3910-design.md; backend + frontend tests added. |
| T3920 | [Reel Drafts Show Clip Game Time (Soccer Notation)](tasks/T3920-reel-draft-clip-game-timestamp.md) | 5 | 3 | 1.7 | DONE | [ ] | Reel Draft cards don't show where in the game a clip came from. Show the clip's start position in soccer notation (e.g. `38'45"`) derived from existing clip start time. Decide single- vs multi-clip card display; handle two-half unified video (T2750). Display-only derivation, no new persisted field. |
| T3930 | [Ranking Card Game Minute: Apply 2nd-Half Offset](tasks/T3930-ranking-card-game-minute-secondhalf-offset.md) | 4 | 2 | 1.6 | DONE | [ ] | Follow-up from T3920. The ranking card (`ReelMatchCard` via `rank.py _minute()`) shows a 2nd-half clip's minute as file-relative (e.g. `6'` instead of `~50'`) because it reads `clip_start_time` directly without the half offset. Switch it to the frozen unified `final_videos.clip_game_start_time` (added in T3920) so both surfaces agree. |
| T3940 | [Re-edit This Reel From Any Player](tasks/T3940-re-edit-reel-from-player.md) | 6 | 5 | 1.2 | DONE | [ ] | While watching a reel (single clip, inside a collection, or in the ranker replay), give a 1-click "re-edit" that opens that reel's project editor — resuming its last mode (Framing/Overlay) and restoring it if archived. Reuses the existing `restore-project` → `onOpenProject` flow (which already resumes mode). Gaps: thread `project_id` into `toPlayerReel` + `/api/rank/next`; prop-gate the button so the public shared viewer never shows it. Navigation only, no new persistence. |
| T3950 | ["Made with Reel Ballers" Outro on Exports](tasks/T3950-made-with-reel-ballers-outro.md) | 7 | 5 | 1.4 | TODO | [ ] | Append a short branded "Made with Reel Ballers" end card (~1.5-2s) to exported clips AND collection/compilation videos, like CapCut's end card — every shared reel becomes free organic reach (pairs with T442 Web Share API). Render-time FFmpeg concat in `modal_functions/video_processing.py`, per aspect ratio (9:16/1:1/16:9), once (no double-outro), no working-data writes. Future hook: paid branding removal behind a single flag. |
| T3960 | [Annotate From Draft Reel Selects Source Clip](tasks/T3960-annotate-from-reel-selects-source-clip.md) | 5 | 3 | 1.7 | DONE | [ ] | Clicking Annotate from a draft reel returns to the Annotate screen but selects nothing in the Clips sidebar. Thread the reel's source clip (`raw_clip_id`) through the `pendingNavigation` breadcrumb (App.jsx `handleEditInAnnotate`) and auto-select it once `clipRegions` load (AnnotateScreen -> `selectAnnotateRegion`). UI state only, no persistence; graceful if source clip deleted; matches by `rawClipId` so two-half videos work. |
| T3970 | [Expired Game: Block Share, Allow Playback](tasks/T3970-expired-game-block-share-allow-playback.md) | 6 | 3 | 2.0 | DONE | [ ] | An expired game can still be shared (it shouldn't) and its annotations aren't easily playable (clicking opens the Extend modal). Gate the Share affordance (ProjectManager expired GameCard) + add a backend expiry guard to share_game + share_playback (games.py); expose a "Playback annotations" action on the expired card (backend already serves annotations/recap for expired). storage_status flag; grace-period video may be gone (degrade gracefully). |
| T3980 | [Dev-Login: Faithful Account Impersonation](tasks/T3980-dev-login-faithful-impersonation.md) | 7 | 4 | 1.8 | TODO | [ ] | No way to drive the app AS a real account with real data in Playwright (the X-User-ID/test-login bypass skips session-init -> empty/wrong profile). Add dev/staging-only `POST /api/auth/dev-login {email\|user_id, profile_id?}` that runs the real `user_session_init` (R2 sync + profile select) + issues a session cookie, plus a `loginAsRealUser` Playwright helper. Unblocks faithful automated testing (e.g. watching an expired game's playback as the real user). |
| T4030 | [Flag Reel for Re-Ranking (Author)](tasks/T4030-flag-reel-for-re-ranking.md) | 6 | 3 | 2.0 | STAGING | [ ] | While watching a collection ("Top Plays") as the author, a single one-tap "Re-rank this" button tells the ranking game the reel's position is in question. New `POST /api/rank/reopen` (rank.py): twin-synced SET that leaves `rating` UNCHANGED, sets `rd=RD_MAX` and `match_count=0`, so the clip re-enters `/next` and the Confidence banner % drops (progress = match_count-based coverage, not rd). Author-only control prop-gated OFF for the public shared viewer (T3940 pattern); hidden on Mixes. Builds on T3630 Glicko engine; gesture-only (EPIC #5); no schema change. |
| T4000 | [Parallelize Game Video Fetch With /load](tasks/T4000-parallelize-game-video-fetch.md) | 6 | 4 | 1.5 | DONE | [ ] | DONE (deployed 2026-06-26, frontend): opening a game was two sequential round-trips (`/api/games/{id}/load` returned the presigned `playback_url`, then the `<video>` started fetching ~762ms total). Diagnosed from prod HAR: backend NOT slow and NOT a Fly wake (ruled out via live timing + machine event log) - a chained dependency. Fix: seed the `<video>` src from the stable gameId-only `/video` URL (302->direct R2) at first paint via a lazy useState init, so the byte fetch overlaps `/load` instead of waiting; resume = t=0 then seek when `/load` lands; in-flight dedup; `PROFILING_ENABLED` timing logs. Parallelism confirmed on staging (video starts +28ms with `/load`). Frontend-only; no reactive persistence. |

### Bugs

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T4020 | [Export Creates Empty "Shadow" Working-Clip Version (Loses Framing)](tasks/T4020-framing-shadow-version-on-export.md) | 9 | 4 | 1.0 | DONE | [ ] | DONE (deployed 2026-06-26 prod). After exporting a reel, the editor shows blank framing on return. Root cause (reproduced live on dev, project 39): the export->overlay transition fires a SECOND full-state save (`FramingScreen.jsx:896` `framingSaveCurrentClipState`) AFTER the export, when `useCrop`/`useSegments` have reset to defaults, persisting empty crop + default segments as a NEW working-clip version that shadows the real one (latest = `MAX(version)`). Exported video is correct; only the editor's latest version is empty. Violates "full-state saves only on explicit gesture, never reactive". Frontend-only; NOT T4010 (backend-only). Likely a core piece of the "buggy edit path". Fix test-first: guard/remove the redundant transition save. Then recover dev project 39 (drop empty working_clip v2 id 59). |
| T4010 | [Atomic Re-Export-In-Place (No Lost Final-Video References)](tasks/T4010-atomic-reexport-in-place.md) | 9 | 5 | 1.0 | DONE | [ ] | DONE (deployed 2026-06-26 prod). Editing a published reel + re-exporting can destroy the old final video (row + R2 object + `final_video_id`) BEFORE the new one is built, with no rollback — a failed re-export leaves a "Done" reel that's unplayable + unpublishable. Reproduced on prod (project 30). Root cause: framing pre-step speculatively NULLs `final_video_id` at job-accept (framing.py:367 et al) and the failure path never restores it; `auto_export` deletes-before-inserts. Fix (no schema migration — `final_videos` is already versioned): stop the speculative NULL + restore on failure, atomic version swap, delete old R2 object only AFTER the new pointer commits, reorder auto_export. Then targeted prod recovery of project 30 (game-6 source intact, expires 2026-07-09). |
| T3990 | [First Reel-Draft Click Refreshes the App](tasks/T3990-first-draft-click-page-refresh.md) | 6 | 3 | 2.0 | DONE | [ ] | DONE (deployed 2026-06-26, frontend): first click on a reel draft after the tab has been open across a deploy did a full-page refresh instead of opening it (works after). Root cause (HAR-confirmed): lazy `import()` of the editor chunk hits a purged old-build hash, server returns index.html (text/html), `import()` rejects, `lazyWithReload` reloads. Fix: eagerly preload editor chunks on home-screen idle so the first click reuses the cached module; keep lazyWithReload+breadcrumb as fallback. Frontend-only. |
| T3540 | [Framing "In Progress" Visual Ambiguity](tasks/T3540-framing-in-progress-visual-ambiguity.md) | 5 | 2 | 2.5 | DONE | [ ] | Reel draft card renders any framing edit as a fully-filled solid blue bar - indistinguishable from complete except by hue. One accidental crop nudge reads as "framed, ready for overlay". Fix: half-fill treatment for in-progress segments + "Editing" -> "Framing started" wording. Frontend-only, SegmentedProgressStrip. |
| T3090 | [Multi-Video Controller Abstraction](tasks/T3090-multi-video-controller-abstraction.md) | 7 | 5 | P1 | DONE | [ ] | Multi-video mode leaks dual-element implementation to consumers via raw videoARef. Components directly manipulate the wrong DOM element when video B is active. Fix: seal the abstraction behind a unified videoController interface. Bugs: 10p, 11p. |
|  | **[Video Proxy Layer](tasks/VIDEO-PROXY-EPIC.md)** | 9 | 8 | P1 |  |  | DRY consolidation: eliminate duplicated video element management. T3120 dropped (different timeline model, risk > benefit). T3150 merged into T3140. |
| T3100 | ↳ [Extract useVideoProxy](tasks/VIDEO-PROXY-EPIC.md#t3100-extract-usevideoproxy-from-usemultivideoscrub) | 9 | 5 | P1 | DONE | [ ] | Create useVideoProxy hook: video-element management, ping-pong swap, cross-boundary seek, error handling, videoController interface. |
| T3110 | ↳ [Migrate useMultiVideoScrub](tasks/VIDEO-PROXY-EPIC.md#t3110-migrate-usemultivideoscrub-to-consume-usevideoproxy) | 7 | 4 | P1 | DONE | [ ] | Refactor useMultiVideoScrub to delegate video management to useVideoProxy; keep RAF loop + navigation. ~200 lines of duplicated seek/swap/error logic. Biggest DRY win. |
| T3130 | ↳ [Migrate PlaybackControls](tasks/VIDEO-PROXY-EPIC.md#t3130-migrate-playbackcontrols-to-use-videocontroller) | 4 | 2 | P1 | DONE | [ ] | Replace raw ref volume/mute in PlaybackControls + RecapPlayerModal with videoController.setVolume/setMuted. ~10 line change. |
| T3140 | ↳ [Unify videoController + remove effective* wrappers](tasks/VIDEO-PROXY-EPIC.md#t3140-remove-singlevideocontroller-from-annotatescreen) | 5 | 3 | P1 | DONE | [ ] | Remove singleVideoController from AnnotateScreen (useVideoProxy handles single-video mode). Then remove all 8 effective* wrappers from AnnotateContainer that become unnecessary. |
| T2040 | [Connection-Aware Cache Warming](tasks/T2040-connection-aware-cache-warming.md) | 8 | 5 | P0 | DONE | [ ] | Cache warming holds R2 sockets during video load. For reels (proxy), warming is FREE (different origin) but we stop it anyway. Split FOREGROUND_ACTIVE into proxy-aware vs direct modes; warm sibling clips during first-clip proxy load. |
| T2010 | [VACUUM Blocks Server During Archive](tasks/T2010-vacuum-blocks-server.md) | 9 | 2 | P0 | DONE | [ ] | `archive_project()` calls VACUUM synchronously, acquiring exclusive DB lock that blocks ALL other requests. Causes recurring "Failed to Fetch" on prod. Fix: move VACUUM to signout. |
| T2030 | [Archive Sync Regression in Publish](tasks/T2030-archive-sync-regression.md) | 7 | 2 | P0 | DONE | [ ] | `publish_to_my_reels()` calls `archive_project()` synchronously (no `asyncio.to_thread`). Regression from 9e58feb0 — old export path used threading. Blocks event loop during R2 upload + DB deletes. |
| T2020 | [On-Machine Log Retention](tasks/T2020-fly-log-retention.md) | 6 | 2 | P1 | DONE | [ ] | Fly.io log buffer retains ~47 lines. Lost all evidence from prod outage. Add `TimedRotatingFileHandler` to `/tmp/logs/` with daily rotation + debug endpoint to read remotely. |
| T2000 | [Overlapping Crop Keyframes](tasks/T2000-overlapping-crop-keyframes.md) | 6 | 4 | P1 | DONE | [ ] | Two crop keyframe diamonds overlap at clip start on framing timeline. `ensurePermanentKeyframes` duplicates frame-0 keyframe on restore when saved keyframes already include one; dedup logic from T1400 doesn't cover restore path. |
| T1190 | [Session & Machine Pinning](tasks/session-scaling/T1190-session-machine-pinning.md) | 9 | 6 | P0 | DONE | [x] | Pin sessions to machines via fly-replay; includes session expiry, single active session enforcement (absorbs T420). Import progress stuck at 0% on staging due to multi-machine routing. |
| T2700 | [Export Retry UX Deception](tasks/T2700-export-retry-ux-deception.md) | 7 | 3 | P1 | DONE | [ ] | Retry button during WS disconnect gives zero feedback; progress bar frozen; user assumes export is broken. Fix: loading state, show poll progress, distinguish reconnecting vs polling. |
| T2710 | [Keyframe Invariant Violations on Restore](tasks/T2710-keyframe-invariant-violations-on-restore.md) | 5 | 3 | P2 | DONE | [ ] | Dev-only validation fires on framing screen entry -- keyframe state violates boundary/origin invariants during clip restoration. Signals data integrity issue in framing pipeline. |
| T2720 | [Post-Export R2 Sync Stall](tasks/T2720-post-export-sync-stall.md) | 8 | 4 | P0 | DONE | [ ] | Export worker's _sync_after_export holds R2 upload lock for ~14s; all frontend requests during framing-to-overlay transition block behind it. User sees frozen UI for 14s after export completes. |
| T3230 | [Auto-Materialize Pending Shares](tasks/T3230-auto-materialize-pending-shares.md) | 9 | 3 | P0 | DONE | [ ] | Pending teammate shares never resolve unless recipient clicks exact share link. Auto-materialize in user_session_init() for single-profile users on login/signup. |
| T2600 | [Archive Msgpack Migration](tasks/T2600-archive-msgpack-migration.md) | 7 | 3 | P1 | DONE | [x] | Archives stored as JSON cause lossy roundtrip for binary columns. Switch to msgpack end-to-end + migrate all live user archives. |

### Keyframe Identity Cleanup (follow-ups from crop/overlay duplicate-keyframe fix)

Surfaced while fixing the keyframe-identity divergence (display snaps an edit to a nearby keyframe, but the surgical persistence sent the raw clicked frame/time, so the backend accumulated near-duplicate keyframes that, on delete, stripped a permanent boundary). Root fix + profile_db v014 heal shipped on branch `fix/crop-keyframe-dup-snap`; these are the remaining DRY/UX cleanups.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T3800 | [Shared Keyframe Persist Wrapper](tasks/T3800-shared-keyframe-persist-wrapper.md) | 5 | 4 | 1.3 | DONE | [ ] | Crop (FramingContainer) and overlay (OverlayScreen) hand-roll the same resolve→optimistic-store→surgical-backend→rollback sequence, so the snap-vs-raw bug landed in both. Extract one keyframe-persistence helper that makes the mistake unrepresentable. DRY, no behavior change. |
| T3810 | [Delete Dead useHighlight Hook](tasks/T3810-delete-dead-usehighlight-hook.md) | 2 | 1 | 2.0 | TODO | [ ] | `useHighlight.js` is exported from overlay/index.js but never instantiated (live system is useHighlightRegions). A third keyframe implementation that adds confusion. Confirm no callers, delete hook + re-export + dead test. |
| T3820 | [Reconcile Keyframe Snap Directions](tasks/T3820-reconcile-keyframe-snap-directions.md) | 4 | 4 | 1.0 | TODO | [ ] | Crop snaps by KEEPING the old frame (10-frame window); overlay snaps by MOVING to the clicked frame (5-frame window). Opposite UX for the same gesture. Needs a UX decision, then unify direction + window across both modes (guard permanent boundaries). |

### Prior Bug Fixes (Complete)

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T1100 | [Remove Dead Overlay Debounce](tasks/T1100-remove-dead-overlay-debounce.md) | 5 | 2 | P0 | DONE | [x] | Dead `saveOverlayData` with 2s debounce in OverlayContainer; remove + audit overlay persistence |
| T1540 | [Gesture Persistence During Upload](tasks/T1540-gesture-persistence-during-upload.md) | 9 | 5 | P0 | DONE | [ ] | Clips added during game upload are silently not saved — `annotateGameId` gate prevents all persistence until upload completes + game is created. User loses clips on navigation. |
| T1570 | [Admin Panel Missing Users](tasks/T1570-admin-panel-missing-users.md) | 5 | 3 | P1 | DONE | [ ] | Some users (e.g., sarkarati@gmail.com) don't appear in admin panel even though they exist in auth.sqlite |
| T1590 | [Admin Panel Data Accuracy](tasks/T1590-admin-panel-data-accuracy.md) | 5 | 4 | P2 | DONE | [ ] | Activity/quest/GPU stats wrong on staging/prod: admin endpoint reads local filesystem but user DBs only sync from R2 on user request. Display bug (0 shown as dash) fixed. |
| T1660 | [Framing Gesture Persistence](tasks/T1660-framing-gesture-persistence-audit.md) | 8 | 4 | P1 | DONE | [ ] | All framing gesture API calls are fire-and-forget with no error recovery. Deleted keyframes reappear on reload if backend rejects the delete. Also: delete/paste/split/detrim don't sync clip store. |
|  | **[Post-Export Video Loading](tasks/post-export-video-loading/EPIC.md)** |  |  |  |  |  | Fix "video not loading" after framing export: broken proxy 206 + frontend race condition |
| T1690 | ↳ [Video Stream Proxy Error Masking](tasks/post-export-video-loading/T1690-video-stream-proxy-error-masking.md) | 7 | 4 | P1 | DONE | [ ] | Stream proxies commit to 206+video/mp4 headers before R2 responds. R2 failures produce broken streams browser reports as "format not supported". Diagnostic logging added, needs deploy. |
| T1670 | ↳ [Overlay Stuck Loading After Export](tasks/post-export-video-loading/T1670-overlay-stuck-loading-after-framing-export.md) | 8 | 5 | P1 | DONE | [ ] | After framing export, overlay shows "Loading working video..." forever. Race between onProceedToOverlay and onExportComplete; retry path skips overlay transition; effect has dead zone with stable proxy URL. |
| T1710 | [Export R2 Sync Never Fires](tasks/T1710-export-r2-sync-never-fires.md) | 10 | 2 | P0 | DONE | [ ] | Duplicate `_sync_after_export` definition shadows working version; every export silently fails R2 sync. Framing data lost on machine restart. |
| T1720 | [Gallery Badge Count Clobbered](tasks/T1720-gallery-badge-count-clobbered.md) | 4 | 2 | P2 | DONE | [ ] | DownloadsPanel useEffect overwrites gallery store count with empty `downloads.length` on mount, clobbering fetchCount result. Badge shows 0 until panel opened. |
| T1870 | [Video Stream Cache-Control](tasks/T1870-video-stream-cache-control.md) | 6 | 2 | P1 | DONE | [ ] | Stream proxy responses missing `Cache-Control: no-store` — browser caches error responses (502/timeout), "Retry" button fails, user must hard-refresh |
| T1880 | [Video Load Error Diagnostics](tasks/T1880-video-load-error-diagnostics.md) | 5 | 3 | P2 | DONE | [ ] | "Video format not supported" error logs raw code but not HTTP status/content-type/body — can't distinguish server error page from actual codec issue |
| T1890 | [Multi-Clip Cache Warming](tasks/T1890-multiclip-cache-warming.md) | 7 | 4 | P1 | DONE | [ ] | FOREGROUND_ACTIVE latch kills warming worker before clips 2-5 are warmed; switching clips in multi-clip project causes 10-48s cold loads |

### Milestone: Season Highlights & Collections (DONE)

Curation paradigm: collections = (scope, filter, ratio) evaluated live; one global rank; Season Highlights flagship. Shipped as a dynamic per-tag collection model with a couple of curated combos per sport (e.g. "Top Plays", "Top Goals & Assists") rather than the originally-specced hardcoded set. The "Top Plays" collection serves as the Season Highlights surface; the separate full-screen unlock-moment modal and stitched-MP4 "Video" verb were dropped as not worth building. Reel Order Editor (was T3635) deferred to For Alpha - Polish.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Season Highlights & Collections](tasks/season-highlights/EPIC.md)** | 9 | 6 | 1.5 |  |  | My Reels becomes the home of all end-product actions: game/season/smart collections, live share links, ranking. Spec + tech notes in docs/plans/. |
| T3600 | ↳ [Freeze Collection Metadata at Export](tasks/season-highlights/T3600-freeze-collection-metadata.md) | 7 | 4 | 1.8 | DONE | [x] | Stamp duration/aspect_ratio/tags on final_videos at export-finalize (publish archives working data). profile_db v007 + backfill reads R2 archives for already-published reels. Foundation for every other task. |
| T3610 | ↳ [Collections Tab + Game Collections](tasks/season-highlights/T3610-collections-tab-game-collections.md) | 8 | 6 | 1.3 | DONE | [ ] | My Reels default tab groups reels by game: summary-first data layer (O(games) GROUP BY endpoint, members lazy-loaded on expand), CollectionHeader (ratio pills, verbs slot), touch-first story player (tap/swipe + auto-advance), Mixes & compilations bucket. Mobile pass at 360-428px. |
| T3620 | ↳ [Collection Share Links + Public Viewer](tasks/season-highlights/T3620-collection-share-links.md) | 8 | 6 | 1.3 | DONE | [x] | share_type='collection' + definition JSONB (postgres v016); live evaluation against sharer profile DB (new R2-download fallback helper); /shared/collection/{token} viewer reusing CollectionPlayer. |
| T3630 | ↳ [Reel Ranking Model + Insertion UX](tasks/season-highlights/T3630-reel-ranking.md) | 8 | 5 | 1.6 | DONE | [x] | season_rank sparse REAL + collection_settings (profile_db v008); surgical rank endpoint; insertion-at-publish prompt (bottom sheet on mobile), batch swipe-through, top-50 repair list with search-to-place + button reordering. Rank-where-set, quality-score-where-not ordering everywhere. |
| T3640 | ↳ [Season Highlights + Unlock Moment](tasks/season-highlights/T3640-season-highlights-unlock.md) | 9 | 5 | 1.8 | DONE | [ ] | Shipped as the "Top Plays" collection (rank-ordered, duration-budgeted) which serves as the Season Highlights surface. The separate full-screen unlock-moment modal + pref.seasonHighlightsChoice opt-in were dropped as not worth building. |
| T3670 | ↳ [Smart Collections: Top Goals/Assists/Dribbles](tasks/season-highlights/T3670-smart-collections.md) | 7 | 3 | 2.3 | DONE | [ ] | Per-(tag,ratio) collections, 30s eligibility, locked near-miss progress rows. Shipped as dynamic per-tag collections + a couple of curated combos per sport (diverged from the hardcoded Top Goals/Assists/Dribbles spec). |

### Milestone: Framing/Overlay Clarity

Outcome-first UX pass on the two steps where non-technical parents fall off. P0 guarantees a zero-effort valid export and kills keyframe jargon; P1 fixes button naming, hides pro readouts, makes hints replayable; P2 adds presets + clearer manual affordances. Each phase is independently shippable.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T3705 | [Quest split: Framing/Overlay into separate quests](tasks/T3700-framing-overlay-clarity.md) | 8 | 5 | 1.6 | DONE | [x] | DONE (commit on feature/T3700-quest-framing-overlay-split): 3-quest restructure (Q1 Get Started, Q2 Frame Your Highlight, Q3 Spotlight Your Player; the old repeat-everything Q4 was dropped, Vamos fires after Q3) with per-step triggers; 6 new achievement events (crop_adjusted, speed_segment_created, opened_overlay_editor, overlay_players_assigned, overlay_color_set, overlay_shape_set) wired in framing/overlay editors; terminal buttons renamed (Export Highlight / Add Spotlight); v005 user_db migration marks new Q3 complete for users who did the old bundled Q2. Remaining T3700 editor-UX phases tracked below. |
| T3700 | [Framing & Overlay Clarity (Outcome-First UX)](tasks/T3700-framing-overlay-clarity.md) | 8 | 5 | 1.6 | DONE | [ ] | P0 shipped: default crop guarantees a zero-effort valid export + non-blocking framing hint; terminal buttons renamed (Export Highlight / Add Spotlight). P1 split out to T3780. P2 (Subtle/Bold presets, keyframe affordance) dropped as not worth doing. |
| T3710 | [Framing Preview (Advance Organizer)](tasks/T3710-framing-preview-advance-organizer.md) | 6 | 4 | 1.5 | DONE | [ ] | Closed: the auto-play finished-result organizer concept was dropped (GPU cost). Dim mode in the editor serves as the lightweight "what does done look like" preview; accepted as-is. |
| T3720 | [Auto-Advance Framing -> Overlay](tasks/T3720-auto-advance-framing-to-overlay.md) | 6 | 3 | 2.0 | DONE | [ ] | On framing-export complete, auto-routes into Overlay (setEditorMode('overlay')) so Q3 `open_overlay` starts without hunting; quest achievement fires automatically. Navigation only, no write-back. |
| T3780 | [Framing/Overlay Clarity P1: Reduce On-Screen Noise](tasks/T3780-framing-overlay-clarity-p1.md) | 6 | 4 | 1.5 | DONE | [ ] | Removed Overlay confidence % badge (kept "N players detected" count + Framing crop readout); `open_framing` now offers a clickable "Open your reel" deep link; CropLayer placeholder rewritten outcome-first ("Keep your player in frame"). Diverged: the replayable quest hint was dropped during review (commit 94e03f8a); `open_overlay` copy reword was minimal (still references the Drafts card). |

### Milestone: Performance

Ordered: instrumentation first so we can measure what we fix; then the two user-visible stalls we already traced; then the structural infra wins.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Page Load Optimization](tasks/page-load-optimization/EPIC.md)** |  |  |  |  |  | Cut page load time in half: eliminate duplicate fetches, sequential waterfalls, and missing indexes |
| T2500 | ↳ [Deduplicate Page-Load Fetches](tasks/page-load-optimization/T2500-deduplicate-page-load-fetches.md) | 9 | 3 | P0 | DONE | [ ] | Auth subscription + initSession().then() both fire same 7 store fetches on page load. Guard subscription so it only fires for login-during-session. |
| T2510 | ↳ [Store Fetch Dedup Guards](tasks/page-load-optimization/T2510-store-fetch-dedup-guards.md) | 5 | 2 | P0 | DONE | [ ] | creditStore.fetchCredits() and authStore.checkAdmin() lack _fetchPromise dedup. Add module-level promise guard matching other stores. |
| T2520 | ↳ [Parallelize Export Recovery Fetches](tasks/page-load-optimization/T2520-parallelize-export-recovery-fetches.md) | 6 | 2 | P0 | DONE | [x] | useExportRecovery chains exports/active → exports/unacknowledged sequentially. Fire both in parallel with Promise.allSettled. |
| T2530 | ↳ [Index Export Jobs Unacknowledged](tasks/page-load-optimization/T2530-index-export-jobs-unacknowledged.md) | 7 | 1 | P0 | DONE | [x] | 487ms server wait on /exports/unacknowledged — no index on acknowledged_at or completed_at. Add composite index. |
| T2540 | ↳ [Verify HTTP/2 on Fly.io Edge](tasks/page-load-optimization/T2540-verify-http2-fly-edge.md) | 6 | 2 | P1 | DONE | [ ] | No-op: HTTP/2 already active. All 34 API requests use h2 with conn=-1.0ms (multiplexed). 40-60ms overhead was R2/third-party domains. |
| T1530 | [Comprehensive Profiling Strategy](tasks/T1530-comprehensive-profiling-strategy.md) | 8 | 5 | 1.6 | DONE | [ ] | Backend cProfile-on-breach + R2 call timing + frontend User Timing API for function-level attribution of slow requests. Backend landed T1531, frontend landed T1570. |
| T1531 | [Quests Achievement 60s Stall](tasks/T1531-quests-achievement-60s-stall.md) | 9 | 3 | 3.0 | DONE | [ ] | Achievement routes skip R2 sync entirely (SKIP_SYNC_PATHS). Frontend fire-and-forget already landed. |
| T1533 | [Overlay Working Video Slow First-Load](tasks/T1533-overlay-working-video-slow-load.md) | 7 | 3 | 2.0 | DONE | [ ] | Root cause was Chrome's Low-priority `<video>` defer (~15s `_blocked_queueing`), NOT moov placement. Fixed by `fetchpriority="high"` on VideoPlayer + fetch-based metadata extractor (bypasses video-element defer entirely). Desktop verified via HAR. |
| T1535 | [Mobile Video Load Verify](tasks/T1535-mobile-video-load-verify.md) | 7 | 2 | 2.0 | DONE | [ ] | Verified on Chrome Android (1.7Mbps 4G): time-to-first-frame 2.0s, metadata fetch 716ms (moov at head), no 15s stall. Metadata extractor + video element run concurrently. No iOS Safari device available. |
|  | **[Quests Latency](tasks/quests-latency/EPIC.md)** |  |  |  |  |  | Quests endpoints looked like the slowest non-video calls in the framing/overlay loop (HAR 2026-06-17). HAR re-attribution corrected this: `/progress` server time ≈ baseline (the "699ms" was 312ms client connection-queueing + 386ms server wait), so T1536 is a correctness/DRY cleanup, NOT a latency win. The real hotspot (achievement POST's synchronous `record_milestone`) needs fire-and-forget → T1537 moved to the Session Scaling epic. Branch `feature/perf-quests-latency`. |
| T1536 | ↳ [Quests /progress + /achievements Latency](tasks/quests-latency/T1536-quests-progress-endpoint-latency.md) | 6 | 3 | 2.0 | DONE | [ ] | Merged the two user.sqlite opens in `/progress` (+ `bootstrap.py`) into one (`get_completed_and_claimed_quest_ids`); deterministic connection-count test (2→1). **Latency claim retracted after HAR re-attribution** — `/progress` had no above-baseline server cost to recover; shipped as a correctness/DRY cleanup. Step 3 (skip profile.sqlite) dropped. No persistence-model change. Deployed 2026-06-18. |
| T1539 | [R2 Concurrent-Write Rate Limit](tasks/T1539-r2-concurrent-write-rate-limit.md) | 7 | 2 | 3.5 | DONE | [ ] | Per-user per-key upload lock (`threading.Lock`) inside `sync_database_to_r2_with_version` and `sync_user_db_to_r2_with_version` serializes PutObject calls. Prevents export worker vs middleware sync race (the actual 429 source -- not request-to-request races, which the asyncio write lock already prevents). tryLock optimization skips redundant retry_pending_sync when upload already in progress. |
| T1538 | [Per-Resource Locks](tasks/T1538-per-resource-locks.md) | 4 | 4 | 1.0 | DONE | [ ] | T1539 shipped the R2 push lock; remaining handler-level parallelism gated on `[WRITE_LOCK_WAIT]` evidence that hasn't materialized. |
| T3250 | [Non-Blocking R2 Sync](tasks/T3250-non-blocking-r2-sync.md) | 9 | 5 | 1.8 | DONE | [ ] | Write lock held during R2 sync (~600ms) serializes all write requests per user. Rapid navigation queues requests behind each other (115s DELETE observed on prod). Narrow write lock to handler only; fire R2 sync as background task. |
|  | **[Initial Load Time](tasks/initial-load-time/EPIC.md)** |  |  |  |  |  | Cut 7.8s initial load to ~2-3s: pre-auth warmup, parallel R2 downloads, collapse fetch phases, bootstrap endpoint |
| T3310 | ↳ [Pre-Auth Machine Warmup](tasks/initial-load-time/T3310-pre-auth-machine-warmup.md) | 9 | 2 | P0 | DONE | [ ] | Warmup fires after auth (Phase 3), providing zero cold-start benefit. Fire unauthenticated warmup before auth/me to pre-wake Fly.io machine. ~1-1.5s saved. |
| T3320 | ↳ [Preconnect + Inline Warmup](tasks/initial-load-time/T3320-preconnect-inline-warmup.md) | 6 | 1 | P0 | DONE | [ ] | Add preconnect hint + inline warmup fetch in index.html. Fires during HTML parse, ~500ms before React loads. |
| T3330 | ↳ [Embed Quest Definitions](tasks/initial-load-time/T3330-embed-quest-definitions.md) | 5 | 1 | P1 | DONE | [ ] | Quest definitions are hardcoded on backend but fetched via HTTP. Embed in frontend bundle to eliminate a round-trip. |
| T3340 | ↳ [Thread-Safe Session Init Cache](tasks/initial-load-time/T3340-thread-safe-session-init-cache.md) | 7 | 2 | P0 | DONE | [ ] | _init_cache has no lock; concurrent requests bypass cache and redundantly download from R2. Add per-user threading.Lock. |
| T3350 | ↳ [Parallelize R2 Downloads](tasks/initial-load-time/T3350-parallelize-r2-downloads.md) | 8 | 3 | P0 | DONE | [ ] | auth/init downloads user.sqlite then profile.sqlite sequentially. Parallelize with speculative profile_id from frontend. ~0.5-1.0s saved. |
| T3360 | ↳ [Collapse Frontend Load Phases](tasks/initial-load-time/T3360-collapse-frontend-load-phases.md) | 9 | 4 | P0 | DONE | [ ] | Data fetches wait for both auth/me + auth/init. Fire user-id-only requests (credits, settings, admin, profiles) after auth/me, concurrent with auth/init. Fix premature setSessionState. |
| T3370 | ↳ [Bootstrap Endpoint](tasks/initial-load-time/T3370-bootstrap-endpoint.md) | 10 | 5 | P0 | DONE | [ ] | Replace 9 concurrent data fetches with single GET /api/bootstrap. Eliminates thread pool convoy (3.6s uniform wait), CORS preflights, per-request overhead. ~2-3s saved. |
| T3380 | ↳ [Lazy Presigned URLs](tasks/initial-load-time/T3380-lazy-presigned-urls.md) | 7 | 3 | P1 | DONE | [ ] | /api/games generates R2 presigned URLs for all games on every load (~200-300ms each on cache miss). Return metadata only; lazy-load URLs on game navigation. |
| T3390 | ↳ [Reduce Auth Retry Config](tasks/initial-load-time/T3390-reduce-auth-retry-config.md) | 4 | 1 | P2 | DONE | [ ] | fetchWithRetry uses 3 retries with 1s base delay. Reduce to 2 retries / 500ms for auth/me. Risk reduction after T3310 makes cold starts rare. |
| T3400 | ↳ [Defer Stripe JS](tasks/initial-load-time/T3400-defer-stripe-js.md) | 4 | 2 | P2 | DONE | [ ] | Stripe SDK chain (5 requests, 78-1453ms) loads on every page load. Defer to payment flow interaction. Frees bandwidth on slow connections. |

#### Video Load Latency (from HAR 2026-06-17)

Traced from `Downloads/localhost.har`: the framing clip *appeared* to take ~4.3s due to a cold over-fetch from R2. **Debunked by the T3760 spike (2026-06-18):** that 4.3s was a HAR misread (`receive` time = playback-stream duration, not TTFF). Measured cold TTFF is 266 ms; the over-fetch is harmless. T3760 closed WON'T-FIX. The per-file tag/JS "downloads" the user noticed are a dev-mode Vite artifact (bundled+gzipped in prod) and are NOT a bottleneck — no task created for them.

> **Coordination:** T3760 + T3770 ship on branch `feature/perf-page-load` (separate conversations, disjoint files). They're part of the wider perf batch with the quest tasks — see [perf-batch-har-2026-06-17.md](tasks/perf-batch-har-2026-06-17.md).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T3760 | [Framing Clip Cold-Load Over-Fetch](tasks/T3760-framing-clip-cold-load-overfetch.md) | 9 | 5 | 1.8 | DONE | [ ] | **Closed WON'T-FIX (spike, 2026-06-18):** the over-fetch is real but harmless. Measured against the real prod object (clip 48, 3.05 GB, confirmed faststart): cold time-to-first-frame after a deep seek = **266 ms** (warm 16 ms); browser buffers only ~3s (~1.85 MB transferred cold); seeks ~300 ms **even under 8-socket saturation**; R2 TTFB 82-151 ms. The "4.3s / 55.8s / 1.03 GB" were a HAR misread (`receive` time != TTFF; advertised `Content-Length` != bytes downloaded). No `Content-Length` clamp can improve a 266 ms TTFF. Decision doc: [T3760-decision.md](tasks/T3760-decision.md). Resolves T2560 kept-skip; re-scopes T2550/epic off latency. |
| T3770 | [Confirm StrictMode Duplicate Page-Load Fetches](tasks/T3770-strictmode-duplicate-pageload-fetches.md) | 3 | 2 | 1.5 | DONE | [ ] | **MEASURED (2026-06-18):** bootstrap ×2->×1 and health ×2->×1 are StrictMode-only no-ops (health: ServerStatus is dead code; sole checker is ConnectionStatus). projects/{id} ×3->×2: one StrictMode dup collapsed, but a real ×2 residual remains (projectsStore.fetchProject + ProjectContext both fetch same id = redundant state). Carved into T3775; no code changed here. |
| T3775 | [Eliminate ProjectContext Redundant Project Fetch](tasks/T3775-projectcontext-redundant-project-fetch.md) | 3 | 2 | 1.5 | DONE | [ ] | Follow-up from T3770. ProjectContext rewritten as a thin adapter over projectsStore (consumes selectedProject/selectedProjectId; no longer fetches /api/projects/{id}) -> redundant fetch + duplicate state eliminated. Shipped commit 9f06b784, deployed 2026-06-18. |
| T3778 | [Remove Dead ServerStatus Component](tasks/T3778-remove-dead-serverstatus-component.md) | 1 | 1 | 1.0 | DONE | [ ] | Follow-up from T3770. Deleted components/shared/ServerStatus.jsx (dead code, mounted nowhere); verified no remaining imports. Shipped commit 47a21ff2, deployed 2026-06-18. |

---

## Priority Policy

**Bugs are always the first priority, especially infrastructure bugs (sync, data integrity, schema).** New features and structural changes should not begin until known bugs are resolved. The order is:

1. **Infrastructure bugs** - Sync failures, data loss, orphaned records, schema issues
2. **Test failures** - Broken tests indicate regressions; fix before adding more code
3. **UI/UX bugs** - Visible issues that affect the user experience
4. **Pre-deployment blockers** - Structural changes (T85) that must happen before real users
5. **New features** - Only after the above are clear

**Bug prioritization within a tier:** Rank by **infrastructure depth** — the deeper the bug (more systems depend on the affected layer), the higher the priority. A silent sync failure is worse than a slow sync, which is worse than a broken test.

When suggesting the next task, always check the Bug Fix Sprint section first. Do not recommend feature work while bugs remain open.

### Epic Prioritization

**Epics compete with other epics and standalone tasks at the milestone level.** Each epic gets aggregate Impact/Complexity/Priority scores based on the collective value and effort of its tasks.

- **Milestone level:** Epics and standalone tasks are ordered by Priority (Impact / Complexity). Higher priority = do first.
- **Within-epic level:** Tasks are ordered by **dependency** — foundational layers first, since all tasks in an epic touch similar code. DB/model changes before API, API before UI.
- **Impact over complexity:** When prioritizing within a milestone, favor high-impact work even if it's harder. The priority formula (Impact / Complexity) naturally rewards this.

---

## Completed Tasks

See [DONE.md](DONE.md) for all completed, superseded, and won't-do tasks.

---

### Epic: Auth Integrity (IN_PROGRESS) -- BUG FIX
[tasks/auth-integrity/EPIC.md](tasks/auth-integrity/EPIC.md)

Goal: Eliminate orphaned accounts by removing guest accounts entirely. Users must sign in (Google or OTP) before using the app.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T1270 | [Cookie Path + SameSite Fix](tasks/auth-integrity/T1270-cookie-path-fix.md) | 9 | 1 | 9.0 | DONE | [ ] | Add `path="/"` to cookies, fix SameSite to `lax` |
| T1290 | [Auth DB Restore Must Succeed](tasks/auth-integrity/T1290-auth-db-restore-must-succeed.md) | 9 | 4 | 2.3 | DONE | [ ] | Fail startup if auth.sqlite can't restore from R2 |
| T1330 | [Remove Guest Accounts](tasks/auth-integrity/T1330-remove-guest-accounts.md) | 10 | 6 | 1.7 | DONE | [x] | Shipped earlier — init-guest + migration helpers removed; tests/test_auth_no_guest.py guards the removal |

### For Alpha - Video Streaming

Fix playback stalls observed on staging (2026-06-02). Video proxy bottleneck (~590 KB/s) causes buffering during game playback. Must fix before alpha testers hit this.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T3250 | [Direct R2 Video Streaming](tasks/T3250-direct-r2-streaming-fix.md) | 9 | 4 | 2.3 | DONE | [ ] | Fix playback stalls: presigned R2 URLs for game + clip streaming, bypass Fly.io proxy bottleneck (~590 KB/s). Absorbs T3240. |

### For Alpha - Infrastructure

Scale, reliability, and data format changes that must land before alpha users arrive.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Session Reliability Epic](tasks/session-reliability/EPIC.md)** | 9 | 5 | 1.8 |  |  | Sessions survive deploys and route to correct machine |
| T1195 | ↳ [Session Durability on Deploy](tasks/session-reliability/T1195-session-durability-on-deploy.md) | 8 | 3 | 2.7 | DONE | [ ] | Persist sessions as individual R2 objects on login so sessions survive machine restarts (scales independently of auth.sqlite size) |
| T1180 | [Binary Data Format](tasks/for-launch/T1180-binary-data-format.md) | 3 | 4 | 0.8 | DONE | [x] | Replace JSON columns with MessagePack for ~30-50% size reduction |

### For Alpha (IN_PROGRESS)
[tasks/for-alpha/EPIC.md](tasks/for-alpha/EPIC.md)

Goal: Get user feedback. Core functionality works, performance is acceptable, onboarding doesn't block users.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T1950 | [Rename Reels/Gallery Terminology](tasks/for-alpha/T1950-rename-reels-gallery-terminology.md) | 6 | 2 | 3.0 | DONE | [ ] | Rename "Reels" → "Reel Drafts" and "Gallery" → "My Reels" across all UI to clarify that finished reels move to a final collection |
| T1940 | [Remove Redundant Progress Bars](tasks/for-alpha/T1940-remove-redundant-progress-bars.md) | 6 | 2 | 3.0 | DONE | [ ] | Upload progress shown in 3 places. Remove from annotate, framing, overlay main UIs. Keep in toasts and on project cards only. |
| T1900 | [Explicit Create Reel Toggle](tasks/for-alpha/T1900-explicit-create-project-toggle.md) | 7 | 3 | 2.3 | DONE | [x] | Replace auto-5-star reel creation with explicit "Create Reel" toggle in add clip dialog. Defaults ON for 5-star, OFF for others. Disabled once reel exists. |
|  | **[Core Sharing Epic](tasks/sharing/EPIC.md)** | 8 | 4 | 1.9 |  |  | End-to-end share loop: create share, send link, recipient watches |
| T1750 | ↳ [Share Backend Model & API](tasks/sharing/T1750-share-backend-model.md) | 8 | 4 | 2.0 | DONE | [x] | shared_videos table, CRUD storage ops, share/revoke/list/toggle-visibility endpoints. Foundation for all sharing tasks. |
| T1770 | ↳ [Gallery Share UI](tasks/sharing/T1770-gallery-share-ui.md) | 8 | 4 | 2.0 | DONE | [ ] | Share modal: email input, public/private visibility toggle, copy link, "People with access" list |
| T1780 | ↳ [Shared Video Player Page](tasks/sharing/T1780-shared-video-page.md) | 8 | 5 | 1.6 | DONE | [ ] | /shared/:shareToken route — public links play immediately; private links show auth gate with email pre-fill |
|  | **[Share Engagement Epic](tasks/sharing/EPIC.md)** | 6 | 3 | 1.8 |  |  | Recipient discovery, email notifications — polish on core sharing |
| T1800 | ↳ [User Picker Component](tasks/sharing/T1800-user-picker-component.md) | 6 | 3 | 2.0 | DONE | [x] | Email autocomplete from prior shares, account lookup (green/yellow). Upgrades core share modal input. |
| T1760 | ↳ [Share Email Delivery](tasks/sharing/T1760-share-email-delivery.md) | 7 | 3 | 2.3 | DONE | [x] | Resend integration for share emails (reused by player tagging); fire-and-forget |
| T1790 | [Shared Reel Download Button](tasks/for-alpha/T1790-shared-reel-download-button.md) | 6 | 2 | 3.0 | DONE | [ ] | Add download button to shared video overlay so recipients can save the reel to their device |
|  | **[Storage Credits Epic](tasks/storage-credits/EPIC.md)** | 10 | 5 | 2.0 |  |  | Gates virality -- every shared/invited user adds unmetered R2 cost without this. Must ship before sharing goes live. |
| T1580 | ↳ [Game Storage Credits](tasks/storage-credits/T1580-game-storage-credits.md) | 10 | 5 | 2.0 | DONE | [x] | Size-based upload cost, 30-day expiry, 8cr new accounts |
| T1581 | ↳ [Storage Extension UX](tasks/storage-credits/T1581-storage-extension-ux.md) | 9 | 4 | 2.3 | DONE | [x] | ExpirationBadge on game cards + credit-based extension modal |
| T1582 | ↳ [Upload Surcharge](tasks/storage-credits/T1582-game-recap-on-expiry.md) | 8 | 2 | 4.0 | DONE | [ ] | +1cr surcharge on uploads to pre-fund auto-export GPU costs |
| T1583 | [Auto-Export Pipeline](tasks/T1583-auto-export-pipeline.md) | 8 | 6 | 1.3 | DONE | [ ] | Auto-export 5-star clips + generate recap video before game video deletion. Split from T1582. |
|  | **[Auto-Export Reliability](tasks/auto-export-reliability/EPIC.md)** | 7 | 3 | 2.3 |  |  | Fix 100% failure rate: presigned URLs, pending recovery, sweep keepalive |
| T2460 | ↳ [Pending Status Recovery](tasks/auto-export-reliability/T2460-pending-status-recovery.md) | 8 | 1 | 8.0 | DONE | [ ] | Reset stale `pending` auto_export_status on startup so crashed exports retry |
| T2450 | ↳ [Presigned URL for FFmpeg](tasks/auto-export-reliability/T2450-auto-export-presigned-url.md) | 7 | 3 | 2.3 | DONE | [ ] | Pass presigned R2 URL to FFmpeg instead of downloading full 3GB game video. Same pattern as T1220. |
| T2470 | ↳ [Sweep Keepalive](tasks/auto-export-reliability/T2470-sweep-keepalive.md) | 5 | 2 | 2.5 | DONE | [ ] | Ping localhost health during active sweep to prevent Fly.io auto-suspend |
| T2400 | [Grace Period for Expired Games](tasks/T2400-grace-period-for-expired-games.md) | 7 | 3 | 2.3 | DONE | [ ] | Keep game videos in R2 for 2 weeks after last ref expires. Extend option available during grace period. |
|  | **[Expired Game Experience](tasks/expired-game-experience/EPIC.md)** | 6 | 4 | 1.5 |  |  | Rich playback-mode viewer for expired games: annotations, highlights tabs, brilliant clips in My Reels |
| T2410 | ↳ [Playback-Mode Recap Viewer](tasks/expired-game-experience/T2410-playback-mode-recap-viewer.md) | 7 | 5 | 1.4 | DONE | [ ] | Replace RecapPlayerModal with read-only playback mode showing annotations, clip navigation |
| T2420 | ↳ [Annotations + Highlights Tabs](tasks/expired-game-experience/T2420-annotations-highlights-tabs.md) | 6 | 4 | 1.5 | DONE | [ ] | Two video modes: all annotated clips, or just 5-star highlights |
| T2430 | ↳ [Brilliant Clips in My Reels](tasks/expired-game-experience/T2430-brilliant-clips-in-my-reels.md) | 6 | 2 | 3.0 | DONE | [ ] | Ensure auto-exported 5-star clips are filterable and always accessible in My Reels |
| T2670 | [Upload Slow Connection Optimization](tasks/T2670-upload-slow-connection-optimization.md) | 7 | 4 | 1.8 | DONE | [ ] | 25MB parts (from 100MB), per-part retry with backoff, adaptive concurrency, save every part. Fixes failed uploads on 5-10 Mbps connections. |
| T2680 | [Remove Video Link Import](tasks/T2680-remove-video-link-import.md) | 9 | 3 | 3.0 | DONE | [x] | Remove all Veo/Trace link import code (T2600-T2635). Legal risk: ToS violation, CFAA, no DMCA safe harbor. Adopt CapCut liability profile -- user-upload only. |
|  | **[Team Sharing Alpha](tasks/team-sharing-alpha/EPIC.md)** | 8 | 4 | 2.0 |  |  | Tag teammates during annotation, share filtered clips via email, auto-add to recipient's account |
| T2800 | ↳ [Teammate Tag Data Model](tasks/team-sharing-alpha/T2800-teammate-tag-data-model.md) | 8 | 3 | 2.7 | DONE | [x] | `tagged_teammates` JSON + `my_athlete` boolean on raw_clips. `teammate_emails` table. Autocomplete APIs. |
| T2810 | ↳ [Annotation UI: Tags + My Athlete](tasks/team-sharing-alpha/T2810-annotation-tags-my-athlete-ui.md) | 7 | 3 | 2.3 | DONE | [x] | Free-text tag input with autocomplete + "My Athlete" toggle in annotation dialog |
| T2820 | ↳ [Share with Tagged Players](tasks/team-sharing-alpha/T2820-share-with-tagged-players.md) | 8 | 4 | 2.0 | DONE | [ ] | Button in annotation mode: per-tag email input, stores mappings, multi-email per tag |
| T2825 | ↳ [Shares Table Refactor](tasks/team-sharing-alpha/T2825-shares-table-refactor.md) | 8 | 3 | 2.7 | DONE | [x] | Normalize `shared_videos` into base `shares` + `share_videos` + `share_games`. Migration script. |
| T2830 | ↳ [Game + Annotation Materialization](tasks/team-sharing-alpha/T2830-game-annotation-materialization.md) | 9 | 5 | 1.8 | DONE | [x] | Create game ref + filtered annotations in recipient's profile. Overlap merging. Email delivery. |
| T2840 | ↳ [Shared Annotation View](tasks/team-sharing-alpha/T2840-shared-annotation-view.md) | 7 | 4 | 1.8 | DONE | [x] | Non-user playback with annotations + signup CTA. Materialization on signup. |
| T2845 | ↳ [Scalability Audit](tasks/team-sharing-alpha/T2845-scalability-audit.md) | 7 | 3 | 2.3 | DONE | [ ] | Audit epic PRs for scale: joins vs big tables, ever-growing shares, retention policy, materialization copies. |
| T2847 | ↳ [Scalability Hardening](tasks/team-sharing-alpha/T2847-scalability-hardening.md) | 8 | 4 | 2.0 | DONE | [x] | Fix sharer_email NameError, share retention policy, clip_teammates junction table, UNIQUE constraint, composite indexes. |
| T2850 | ↳ [Share Game](tasks/team-sharing-alpha/T2850-share-game.md) | 7 | 3 | 2.3 | DONE | [ ] | Share button on game cards via UserPicker. Profile picker for recipient. |
| T2855 | ↳ [Shared Game Storage Extension](tasks/team-sharing-alpha/T2855-shared-game-storage-extension.md) | 6 | 2 | 3.0 | DONE | [ ] | Verify + fix recipients can extend storage on shared games independently. No upload cost, just extension credits. |
| T2860 | ↳ [My Athlete Filter in New Reel](tasks/team-sharing-alpha/T2860-my-athlete-reel-filter.md) | 6 | 2 | 3.0 | DONE | [ ] | Filter clips by "My Athlete" in reel creation clip selector |
| T2870 | [SQLite JSON to MsgPack](tasks/T2870-sqlite-json-to-msgpack.md) | 5 | 3 | 1.7 | DONE | [x] | Migrate all JSON TEXT columns (`tags`, `tagged_teammates`, `default_highlight_regions`, etc.) to msgpack for consistency with binary data columns. |
| T2750 | [Unified Multi-Video Experience](tasks/for-alpha/T2750-unified-multi-video-experience.md) | 7 | 6 | 1.2 | DONE | [ ] | 2-half uploads simulate a single combined video: one timeline, one clip list, transparent video switching. No more "First Half" / "Second Half" tabs. |
| T2920 | [Migration System Infrastructure](tasks/T2920-migration-system-infrastructure.md) | 8 | 5 | 1.6 | DONE | [x] | Versioned migration system: `PRAGMA user_version` (SQLite) + `schema_migrations` (Postgres), polymorphic `BaseMigration` class, `POST /admin/migrate` endpoint, Migration agent for Claude workflow. AI writes migrations, never runs them manually. |
| T2930 | [Postgres Data Locality Audit](tasks/T2930-postgres-data-locality-audit.md) | 7 | 4 | 1.8 | DONE | [x] | Audit Postgres for per-user data that belongs in profile.sqlite. `game_storage_refs` is the known case — per-user game expiration stored in Postgres instead of alongside games in SQLite. Move per-user data to SQLite, keep only global indexes in Postgres. |
| T2890 | [Cache Warming Efficiency](tasks/T2890-cache-warming-efficiency.md) | 9 | 4 | 2.3 | DONE | [ ] | Warming system upgrade: 4 concurrent workers (from 1), cross-queue URL dedup, foreground abort signal, viewport-aware priority. Cuts warming from 5.3s to <1.5s (8 games) or 17.5s to <6s (50 games). |
|  | **[Games List Performance](tasks/games-list-performance/EPIC.md)** | 8 | 3 | 2.7 |  |  | Backend presigned URL cache + frontend blink fix. Depends on T2890 for video warming speed. |
| T2880 | ↳ [Backend Presigned URL Cache](tasks/games-list-performance/T2880-backend-presigned-url-cache.md) | 8 | 4 | 2.0 | DONE | [ ] | TTL cache + asyncio.gather() for presigned URLs. Cuts /api/games from 3.2s to <300ms warm, <1s cold. |
| T2885 | ↳ [Games Blink Fix](tasks/games-list-performance/T2885-games-blink-fix.md) | 4 | 1 | 4.0 | DONE | [ ] | Correctness fix: isLoading only on first load + 30s freshness guard eliminates redundant fetches. ~5 lines in gamesDataStore.js. |
|  | **[Invite & Referral](tasks/invite-referral/EPIC.md)** | 8 | 4 | 2.0 |  |  | Invite button + mailto email with landing page link. Referral graph in Postgres tracks who brought whom across invites and shares. |
| T2900 | ↳ [Invite Button + Email](tasks/invite-referral/T2900-invite-button-email.md) | 8 | 3 | 2.7 | DONE | [ ] | "Invite a Friend" button on home screen. Opens mailto: with crafted pitch + reelballers.com?ref={code}. Landing page passes ref through to app signup. |
| T2905 | ↳ [Share Annotated Playback](tasks/invite-referral/T2905-share-annotated-playback.md) | 7 | 4 | 1.8 | DONE | [ ] | Share annotated playback via email link. Reuses shares table + SharedAnnotationView. Non-users see playback + signup CTA. Feeds `annotation_share` referral channel. |
| T2910 | ↳ [Referral Graph](tasks/invite-referral/T2910-referral-graph.md) | 7 | 4 | 1.8 | DONE | [ ] | Postgres `referrals` adjacency table. Attribution on signup from invite codes + share acceptance. Admin queries for leaderboard and channel effectiveness. |
| T2915 | ↳ [Sport Inheritance Through Invite](tasks/invite-referral/T2915-sport-inheritance-through-invite.md) | 6 | 4 | 1.5 | DONE | [x] | **DONE (diverged, shipped + prod-migrated 2026-06-20):** When A invites B, B's default profile inherits A's sport (instead of soccer). Shipped as a **link snapshot**, NOT the spec's live `users.default_sport` mirror (rejected as redundant state). The inviter's sport is frozen onto `referrals.inherited_sport` (Postgres v017) at invite-code fetch / sport edit, and onto `shares.sharer_default_sport` (v018) for share channels; the invitee reads the snapshot via the referrals graph at first init, falling back to soccer. Extended to all share/invite channels (commit c41a13a1). Builds on T2910. |
|  | **[PWA Quick Wins](tasks/pwa/EPIC.md)** | 6 | 2 | 3.0 |  |  | Installable app + native share sheet + screen wake lock. Foundation for all PWA features. |
| T441 | ↳ [PWA Install](tasks/pwa/T441-pwa-install.md) | 6 | 3 | 2.0 | DONE | [ ] | Manifest, service worker, icons, install prompt. Install CTA on share pages. Foundation for all PWA features. |
| T442 | ↳ [Web Share API](tasks/pwa/T442-web-share-api.md) | 8 | 3 | 2.7 | DONE | [ ] | Native share sheet for exported reels -- one tap to Instagram/TikTok/WhatsApp. Post-export toast with share button. |
| T446 | ↳ [Screen Wake Lock](tasks/pwa/T446-screen-wake-lock.md) | 5 | 1 | 5.0 | DONE | [ ] | Prevent screen dimming during Annotate mode. ~20 LOC, no backend. |
|  | **[Landing Page Redesign](tasks/landing-page-redesign/EPIC.md)** | 10 | 4 | 2.5 |  |  | Alpha scope: new hero with CTA above fold, sticky nav + mobile CTA bar, visual refresh |
| T2310 | ↳ [Nav, Hero & CTA Improvements](tasks/landing-page-redesign/T2310-nav-hero-cta.md) | 10 | 4 | 2.5 | DONE | [ ] | Sticky nav + mobile bottom CTA bar + hero copy ("From Upload to IG in 5 minutes.") + specific CTA text. Clear wins only, no visual redesign. |
| T2315 | ↳ [Before/After Asset Pipeline](tasks/landing-page-redesign/T2315-before-after-asset-pipeline.md) | 8 | 4 | 2.0 | DONE | [ ] | Modify admin "Create Before and After" to output 2 separate files + concat script for landing page assets. |
| T2640 | [Local Processing Subprocess](tasks/T2640-local-processing-subprocess.md) | 5 | 4 | 1.3 | DONE | [ ] | Local fallback processors block FastAPI event loop (7s polling delay during 1.4GB download). Run in separate process so dev server stays responsive. |
|  | **[Athlete Profile Epic](tasks/athlete-profile/EPIC.md)** | 6 | 4 | 1.5 |  |  | Profile stores athlete name, team name, sport. Sport drives annotation tags. 6 supported sports + custom. |
| T1610 | ↳ [Profile Fields](tasks/athlete-profile/T1610-profile-fields.md) | 6 | 3 | 2.0 | DONE | [x] | DB schema: athlete_name, team_name, sport (free-text, not enum) + combobox UI with 6 supported sports + custom entry. (Absorbs T1073) |
| T1620 | ↳ [Sport-Specific Tag Definitions](tasks/athlete-profile/T1620-sport-specific-tag-definitions.md) | 6 | 3 | 2.0 | DONE | [ ] | Static tag definition files for Flag Football, American Football, Basketball, Lacrosse, Rugby. Register in tagRegistry.js. |
| T1630 | ↳ [Sport-Driven Tag Selection](tasks/athlete-profile/T1630-sport-driven-tag-selection.md) | 7 | 4 | 1.8 | DONE | [ ] | Annotation UI reads sport from profile and loads tags from tagRegistry. Custom sports with no tags show clean UI. |
| T1960 | [Migrate Global SQLite to Fly Postgres](tasks/for-launch/T1960-migrate-auth-to-fly-postgres.md) | 8 | 6 | 1.3 | DONE | [x] | Move auth.sqlite + sharing.sqlite to Fly Postgres (~$2-4/mo). Eliminates restart fragility, concurrent write contention, and O(users) R2 syncs. Per-user SQLite+R2 stays (correct with session pinning). Gates alpha exit. |
| T1740 | [Privacy & Regulatory Compliance](tasks/for-launch/T1740-privacy-regulatory-compliance.md) | 10 | 6 | 1.7 | DONE | [ ] | Privacy policy, ToS, COPPA/CCPA/CalOPPA compliance, age verification, consumer rights (data export/deletion), vendor DPAs, incident response plan. No biometric processing — BIPA/CUBI not applicable. Must ship before launch. |
| T1040 | [Force Login on Add Game](tasks/for-alpha/T1040-force-login-add-game.md) | 7 | 2 | 3.5 | DONE | [ ] | Guest clicks "Add Game" -> auth gate appears first; ensures persistent identity before investing effort |
| T1030 | [Quest UI Relocation](tasks/for-alpha/T1030-quest-ui-relocation.md) | 6 | 3 | 2.0 | DONE | [ ] | Move quest panel out of floating overlay into dedicated area; currently covers controls user needs (e.g., playback button for Q1S3) |
| T980 | [Clip-Scoped Scrub Bar](tasks/T980-clip-scoped-scrub-playback.md) | 4 | 3 | 1.3 | DONE | [ ] | In Play Annotations mode, add a per-clip scrub bar so users can seek within each clip |
| T1390 | [Rename Projects to Reels](tasks/for-alpha/T1390-rename-projects-to-reels.md) | 6 | 2 | 3.0 | DONE | [ ] | Users understood "Games" but not "Projects" -- rename to "Reels" (UI labels only) |
| T1400 | [Framing Keyframe Dedup](tasks/for-alpha/T1400-framing-keyframe-dedup.md) | 6 | 2 | 3.0 | DONE | [x] | Snap to nearby keyframe within MIN_KEYFRAME_SPACING instead of creating duplicates |
| T1520 | [Export Disconnect/Retry UX](tasks/for-alpha/T1520-export-disconnect-retry-ux.md) | 7 | 3 | 2.3 | DONE | [ ] | Misclassifies WS disconnect as "Export failed"; add retry button and reconcile with Modal job state on reconnect |
| T1650 | [Report a Problem Button](tasks/T1650-report-problem-button.md) | 5 | 3 | 1.8 | DONE | [ ] | "Report a problem" button on auth modal sends browser console errors/warnings + user agent to all admins via Resend |
| T1660 | [Export Failure Card State](tasks/for-alpha/T1660-export-failure-card-state.md) | 3 | 3 | 1.0 | DONE | [ ] | After export fails, project card reverts to blue "Editing" with no failure indication; add distinct failed state to progress strip |
| T1600 | [Mobile Responsive](tasks/for-alpha/T1600-mobile-responsive.md) | 4 | 3 | 1.3 | DONE | [ ] | Make all screens work on mobile (360-428px); move new user flow below the fold on mobile so users scroll to it |
| T1140 | [Production Deploy Script](tasks/T1140-production-deploy-script.md) | 6 | 3 | 2.0 | DONE | [ ] | Single command to deploy frontend/backend to production with pre-flight checks and health verification |
| T1510 | [Admin Impersonate User](tasks/T1510-admin-impersonate-user.md) | 5 | 2 | 2.5 | DONE | [ ] | Clickable email in admin user list -> "login as user" session with banner, audit log, reversible stop. Unblocks support debugging |
| T1515 | [Suppress Analytics During Impersonation](tasks/T1515-suppress-analytics-during-impersonation.md) | 6 | 3 | 2.0 | DONE | [ ] | Follow-up to T1510: request-path impersonation actions are now invisible to analytics. Backend `_current_impersonator_id` ContextVar set in db_sync middleware, guards record_milestone()/update_session()/close_session(); frontend track() early-returns when authStore.impersonator set; unit + integration tests shipped. Audit log still records. Export-job (background-worker) path NOT covered -> split to T1516. |
| T1516 | [Suppress Export-Job Analytics During Impersonation](tasks/T1516-suppress-export-job-analytics-impersonation.md) | 4 | 2 | 2.0 | DONE | [ ] | **Closed WON'T-DO (2026-06-19):** approach (a) was implemented and **verified working** (stamp `impersonated` on `export_jobs` at creation + skip the worker's completion milestones; hello@'s `export_completed`/`overlay_exported` confirmed suppressed during impersonation), but de-prioritized -- not currently needed -- so the branch was abandoned/deleted. The proven approach + column mapping remain in the task file for future revival. (A blank-reels-home issue surfaced during impersonation testing was a separate impersonation-only local artifact -- a T3775-exposed `_resetDataStores` race -- NOT part of this task; not user-facing in normal flows.) Original scope: split from T1515 gap -- export-completion milestones fire from the background worker, outside T1515's request ContextVar, so an export started while impersonating still records on the impersonated user. |
| T1640 | [Archive on Approve](tasks/T1640-archive-on-approve.md) | 4 | 3 | 1.3 | DONE | [ ] | Auto-archive completed projects on login; default to Framing when opening completed reels |
| T1550 | [Unified Navigation](tasks/T1550-unified-mode-navigation.md) | 6 | 3 | 2.0 | DONE | [ ] | Clickable breadcrumbs (Games/Reels -> Home), unified 3-mode tab bar (Annotate/Framing/Overlay), single shared header component |
| T1532 | [Working Clips Deleted After Restart](tasks/T1532-working-clips-deleted-after-restart.md) | 4 | 3 | 1.3 | DONE | [ ] | Fixed: added project_id to PARTITION BY in latest_working_clips_subquery + regression test covering cross-project shared raw_clip. |
| T1534 | [Overlay Render Broken Pipe at Frame 299](tasks/T1534-overlay-render-broken-pipe.md) | 6 | 2 | 3.0 | DONE | [ ] | Fixed: removed `-shortest` from overlay ffmpeg cmd. Mixed-audio concat caused audio (~8s) to truncate output below video length (24s), ffmpeg exited mid-stdin -> BrokenPipe. |
|  | **[Analytics 1](tasks/analytics-1/EPIC.md)** | 7 | 3 | 2.3 |  |  | Fix CF Web Analytics + user milestones with acquisition tracking + migrate admin panel off R2 downloads. Replaces OpenPanel epic. |
| T3000 | ↳ [Fix Cloudflare Web Analytics](tasks/analytics-1/T3000-fix-cloudflare-web-analytics.md) | 6 | 1 | 6.0 | DONE | [ ] | Set VITE_CF_ANALYTICS_TOKEN in CF Pages env, verify beacon on app + landing page |
| T3010 | ↳ [User Milestones + Acquisition Tracking](tasks/analytics-1/T3010-postgres-event-log.md) | 8 | 4 | 2.0 | DONE | [x] | Create user_milestones table with origin tracking (organic/viral), record_milestone() helper, instrument 8 backend handlers |
| T3020 | ↳ [Admin Panel Migration to Milestones](tasks/analytics-1/T3020-admin-panel-event-migration.md) | 7 | 4 | 1.8 | DONE | [x] | Delete ALL R2 SQLite code from admin (~300 lines). Replace with milestones JOIN. Remove quest badges, GPU drilldown, summary cards. Add origin/channel columns. |
| T3030 | ↳ [Analytics Dashboards](tasks/analytics-1/T3030-analytics-dashboards.md) | 7 | 5 | 1.4 | DONE | [x] | Activation funnel, cohort grid, acquisition channels, user journey, daily pulse with daily_counters table |
| T3040 | [Instrument Full User Flow](tasks/T3040-instrument-full-user-flow.md) | 8 | 4 | 2.0 | DONE | [x] | Normalized `user_flow_events` table replaces per-column tracking. Add 6 new events (annotation done, framing opened/exported, overlay exported, gallery viewed, downloaded). Adding an event = one dict entry, no migration. 12-step funnel. |
| T3080 | [Sync User Activity to SQLite](tasks/T3080-sqlite-user-activity.md) | 6 | 3 | 2.0 | DONE | [x] | Dual-write user activity (session counts, event counts, last_active_at) to per-user SQLite alongside Postgres for fast per-user reads |
| T2940 | [Overlay Tuning](tasks/overlay-v2/T2940-overlay-tuning.md) | 8 | 3 | 2.7 | DONE | [x] | Fix invisible/occluding overlay: bold stroke (3-4px) with dark outline, separate stroke/fill opacity, better default colors, dim slider. No architecture changes. |
| T3060 | [Make It Load Fast](tasks/for-alpha/T3060-make-it-load-fast.md) | 8 | 5 | 1.6 | DONE | [ ] | Playwright perf harness complete. Staging: Home 1629ms, Annotate 364ms, Framing 898ms, My Reels 388ms — all under 2.5s. |
| T3100 | [Bug Storage Backend](tasks/bug-tracking/T3100-bug-storage-backend.md) | 9 | 4 | 2.3 | DONE | [ ] | Postgres `bug_reports` table (env-implicit), R2 screenshot upload, admin API endpoints, notification-only email |
| T3110 | [Bug Investigation Skill](tasks/bug-tracking/T3110-bug-triage-skill.md) | 7 | 3 | 2.3 | DONE | [ ] | `/bug {id}` loads full bug context into current Claude session for investigation. No listing -- task board handles that. |
| T3120 | [Task Board Bug View](tasks/bug-tracking/T3120-task-board-bug-view.md) | 8 | 5 | 1.6 | DONE | [ ] | Auto-fetch from both prod+staging Postgres. Deterministic consolidation grouping (no LLM). Copy Kickoff Prompt downloads assets + builds AI prompt. Reporter column. |
|  | **[Bug Report Diagnostic Quality](tasks/bug-report-quality/EPIC.md)** |  |  |  |  |  | Maximize runtime context in bug reports so AI agents can reproduce bugs without asking for more info |
| T3150 | ↳ [Fix Backend NULL Storage](tasks/bug-report-quality/T3150-fix-null-storage.md) | 7 | 1 | 7.0 | DONE | [ ] | Fix Python truthiness bug: `if body.actions else None` stores empty `[]` as NULL. Change to `is not None`. |
| T3160 | ↳ [Screenshot Regression](tasks/bug-report-quality/T3160-screenshot-regression.md) | 7 | 3 | 2.3 | DONE | [ ] | Constrain html2canvas to viewport (not full body), fix video frame capture (dark voids), bump scale to 1.0. |
| T3170 | ↳ [Editor Context Enrichment](tasks/bug-report-quality/T3170-editor-context-enrichment.md) | 8 | 3 | 2.7 | DONE | [ ] | Per-mode state: annotate (game, clips, sequence), framing (keyframes, aspect ratio, segments), overlay (all effect settings). Add viewport, route. |
| T3180 | ↳ [Action Breadcrumbs](tasks/bug-report-quality/T3180-action-breadcrumbs.md) | 8 | 4 | 2.0 | DONE | [ ] | Add ~22 event types via track() calls in gesture handlers. Covers annotate/framing/overlay/video. Buffer 50->200. |

### For Alpha - Polish

Final pre-alpha polish: source material, analytics review, returning-user experience, and landing page refinement.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T3635 | [Reel Order Editor](tasks/season-highlights/T3635-reel-order-editor.md) | 6 | 4 | 1.5 | TODO | [ ] | (Moved from Season Highlights epic.) At Ranking Progress 100% (caught_up), the banner opens a view/edit-order UI (drag desktop + up/down nudge all widths, tap-to-replay). Manual rating override between neighbors, twin-synced; fixes misclick-corrupted sorts. New /api/rank/order + /api/rank/move. |
| T3750 | [Redo All E2E Tests](tasks/T3750-rewrite-new-user-flow-e2e.md) | 7 | 4 | 1.8 | TODO | [ ] | (Moved from Framing/Overlay Clarity; hold until now.) Audit + redo the full E2E suite, not just onboarding: rewrite new-user-flow.spec.js to the 3-quest flow + new event gestures + Export Highlight/Add Spotlight selectors; expect framing->overlay auto-advance; fix gallery/My Reels specs for Collections + ranking-game changes; sweep regression-tests.spec.js label selectors. |
| T1970 | [Annotate Mehdi Source Files](tasks/alpha-marketing/T1970-annotate-mehdi-source-files.md) | 8 | 2 | 4.0 | TODO | [ ] | Annotate, frame, and export Mehdi's game footage end-to-end to produce demo clips and before/after examples |
|  | **[Analytics Power-Up](tasks/analytics-power-up/EPIC.md)** | 9 | 4 | 2.3 |  |  | Normalize schema, origin propagation through viral chains, revenue per campaign, per-user action log, admin redesign |
| T3450 | ↳ [Normalize Postgres Schema](tasks/analytics-power-up/T3450-normalize-postgres-schema.md) | 8 | 5 | 1.6 | DONE | [x] | user_segments (origin + referrer_id + total_spent) + user_actions. Origin propagation: viral inherits inviter's campaign. |
| T3455 | ↳ [Campaign URL Parsing](tasks/analytics-power-up/T3455-campaign-url-parsing-spec.md) | 7 | 3 | 2.3 | DONE | [ ] | Parse ad network URL params (fbclid, gclid, utm_campaign, ttclid) into normalized origin string. Feeds T3450's _determine_origin(). |
| T3460 | ↳ [SQLite Action Log](tasks/analytics-power-up/T3460-sqlite-action-log.md) | 8 | 3 | 2.7 | DONE | [ ] | Per-user user_action_log table: every action timestamped with context JSON. Admin endpoint to read. |
| T3470 | ↳ [Fill Tracking Gaps](tasks/analytics-power-up/T3470-fill-tracking-gaps.md) | 7 | 2 | 3.5 | DONE | [ ] | Instrument 7 missing events: session_started, quest_completed, invite_sent, share_viewed, payment_started/completed, export_started |
| T3480 | ↳ [Admin User Detail Redesign](tasks/analytics-power-up/T3480-admin-user-detail.md) | 9 | 4 | 2.3 | DONE | [ ] | Replace dot timeline with vertical action log: every action, timestamp, delta, context. Power over pretty. |
| T3490 | ↳ [Admin Analytics Upgrade](tasks/analytics-power-up/T3490-admin-analytics-upgrade.md) | 7 | 3 | 2.3 | DONE | [ ] | Funnel with new events, campaigns view with revenue per origin (incl viral), cohorts with revenue + 7d return |
| T3500 | ↳ [Session Duration Tracking](tasks/analytics-power-up/T3500-session-duration-tracking.md) | 8 | 4 | 2.0 | DONE | [x] | Track total time spent per user via session open/close in update_session(). Accumulate total_usage_seconds. |
| T3510 | ↳ [Pulse Sparklines](tasks/analytics-power-up/T3510-pulse-sparklines.md) | 6 | 3 | 2.0 | DONE | [ ] | Real daily sparklines + change_pct for Revenue and Viral Conversion pulse cards (currently stubs) |
| T3520 | ↳ [Fix Migration Counts](tasks/analytics-power-up/T3520-fix-migration-counts.md) | 4 | 1 | 4.0 | DONE | [ ] | Verify and fix migration count assertions in test_migrations.py (off-by-one in postgres track) |
| T3530 | ↳ [Fix SQLite Activity Tests](tasks/analytics-power-up/T3530-fix-sqlite-activity-tests.md) | 5 | 2 | 2.5 | DONE | [ ] | Fix stale user_activity assertions in test_user_activity_sync.py; add user_action_log dual-write tests |
|  | **[Landing Page Polish](tasks/landing-page-redesign/EPIC.md)** | 7 | 4 | 1.8 |  |  | Before/after examples from Mehdi footage + tutorial video |
| T2330 | ↳ [Before/After Examples](tasks/landing-page-redesign/T2330-before-after-section.md) | 10 | 5 | 2.0 | TODO | [ ] | Add more before/after examples to existing section: diverse positions (keepers, defenders), synced loops |
| T3300 | ↳ [Build Tutorial Video for Landing Page](tasks/T3300-tutorial-video-landing-page.md) | 8 | 3 | 2.7 | TODO | [ ] | Build tutorial video and add to landing page |
|  | **[Analytics: Attribution & Access Visibility](tasks/analytics-attribution-viz/EPIC.md)** | 7 | 5 | 1.4 |  |  | Surface origination & access from existing tables: split games uploaded vs accessible, and a full attribution graph (who invited whom + ad campaign roots). |
| T3550 | ↳ [Games Uploaded vs Accessible](tasks/analytics-attribution-viz/T3550-games-uploaded-vs-accessible.md) | 6 | 3 | 2.0 | TODO | [ ] | Split admin "Games" into games uploaded vs games accessible (differ due to sharing). Add accessible count via share_games/shares join; show both in UserTable + UserDetailPanel. |
| T3560 | ↳ [User Attribution Graph](tasks/analytics-attribution-viz/T3560-attribution-graph.md) | 7 | 6 | 1.2 | TODO | [ ] | Node-link attribution graph: users + ad-campaign/origin roots as nodes, referrals as edges, colored by origin. Own lazy-loaded page (code-split) linked from main analytics so the graph lib/payload never slows the main page. New /attribution-graph endpoint + AttributionGraph.jsx (adds first graph viz lib). |
| T3570 | [Track Annotation Playback Frequency](tasks/T3570-annotation-playback-frequency-event.md) | 5 | 2 | 2.5 | TODO | [ ] | Add non-achievement `annotation_playback_started` flow event (once per playback session) so user_actions counts rewatch frequency. Existing `annotations_played` achievement only fires once ever. Feeds lifecycle-email classifier. |
|  | **[Lifecycle Onboarding Emails](tasks/lifecycle-emails/EPIC.md)** | 8 | 6 | 1.3 |  |  | Day 7/14/30 emails: thank, help-by-funnel-stage (no-games -> upload/teammate-share help; has-games-no-annotation -> annotate value; etc.), and beg for feedback w/ free credits. Personalized from activity log. Replies -> imankh@gmail.com. |
| T3580 | ↳ [Lifecycle Email Engine](tasks/lifecycle-emails/T3580-lifecycle-email-engine.md) | 8 | 6 | 1.3 | TODO | [x] | Resend reply_to support + email_sends dedup table (migration) + self-scheduling day-7/14/30 loop (sweep_scheduler pattern) + classify_user_state funnel-stage classifier + admin preview/force-send. |
| T3590 | ↳ [Day 7/14/30 Content & Personalization](tasks/lifecycle-emails/T3590-lifecycle-email-content.md) | 8 | 5 | 1.6 | TODO | [ ] | render_lifecycle_email: appreciation + help block per stuck_at stage + feedback ask (annotate/playback/create/frame/spotlight/share clarity, scoped to steps reached) + free-credit offer. Reuses _build_share_email design system. |
| T3595 | [Share Viewer Opt-In & Viewer Bucket](tasks/T3595-share-viewer-optin-bucket.md) | 7 | 6 | 1.2 | TODO | [x] | Opt-in CTA on shared link viewer pages ("learn how to make clips like this?"); opted-in viewers stored as leads + one-time how-to email. Passive viewers never emailed. share_viewer_leads table buckets viewers separately from users; converted_user_id links viewer->signup. Today share_viewed is sharer-attributed only. |
| T3290 | [Tune NUF for Returning Users](tasks/T3290-tune-nuf-returning-users.md) | 8 | 4 | 2.0 | TODO | [ ] | Differentiate new user flow for returning users vs first-timers. Conversation needed to scope. |

### Milestone: Alpha Marketing

Outreach to our network once alpha milestone is complete. Ordered: create source material first, then compose email, then send.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T1980 | [Alpha Outreach Email](tasks/alpha-marketing/T1980-alpha-outreach-email.md) | 9 | 3 | 3.0 | TODO | [ ] | "Save your best moments before you lose the videos" — email with demo clip link, feature screenshots, CTA to app |
| T1990 | [Alpha List](tasks/alpha-marketing/T1990-alpha-list.md) | 9 | 1 | 9.0 | TODO | [ ] | Contact list for alpha outreach: Zack, Arshia, Chris Choie, WhatsApp group, John Gleaves, Jack's dad, Jett's dad, current team, Shannon |
|  | **[Share Email Redesign](tasks/share-email-redesign/EPIC.md)** | 9 | 4 | 2.3 |  |  | Light-bg design system, sender names (not emails), first-touch vs returning variants, AAA contrast. Fixes conversion-killing spam appearance. |
| T3200 | ↳ [Email Design System](tasks/share-email-redesign/T3200-email-design-system.md) | 8 | 3 | 2.7 | DONE | [x] | Shared template builder: light background, WCAG AAA contrast, responsive layout, dark mode safe, preheader support |
| T3210 | ↳ [Sender Name + Recipient Detection](tasks/share-email-redesign/T3210-sender-name-recipient-detection.md) | 9 | 3 | 3.0 | DONE | [x] | Resolve display names from athlete profiles, detect first-touch vs returning recipients, update all 4 share email callers |
| T3220 | ↳ [Rewrite Share Email Templates](tasks/share-email-redesign/T3220-rewrite-share-email-templates.md) | 9 | 4 | 2.3 | DONE | [x] | Apply design system to all 4 emails: teammate clips, video share, game share, playback share. Two variants per email type. |

### Epic: Video Load Reliability (IN_PROGRESS) -- BUG FIX
[tasks/video-load-reliability/EPIC.md](tasks/video-load-reliability/EPIC.md)

Goal: Robust video loading — no misleading format errors, no oversized preloads, no CORS spam. Ordered by severity to user experience. Orchestrator-driven; each task gets its own branch and merges only after its before/after test proves effectiveness.

| ID | Task | Status | Pri | Migr | Description |
|------|------|------|------|------|------|
| T1360 | [Blob URL Error Recovery](tasks/video-load-reliability/T1360-blob-url-error-recovery.md) | DONE | 4.0 | [ ] | Stale blob URL auto-recovers to streaming URL; no misleading "Video format not supported" overlay |
| T1370 | [Blob Preload Size Gate + Unmount Safety](tasks/video-load-reliability/T1370-blob-preload-size-gate.md) | OBSOLETE | 3.5 | [ ] | 200MB gate on T1262 preload; AbortController + revoke on unmount -- removes root cause of T1360 recurrence |
| T1350 | [Cache Warming CORS Cleanup](tasks/video-load-reliability/T1350-cache-warming-cors-fix.md) | DONE | 3.0 | [ ] | Switch warmUrl to `no-cors`; eliminates console spam on every page load |
| T1400 | [Video Load Contention](tasks/video-load-reliability/T1400-video-load-contention.md) | DONE | 4.5 | [ ] | Narrowed post-T1410: range-fallback watchdog + `[VIDEO_LOAD]` structured logs for prod measurement |
| T1410 | [Video Load Regression Since 04-08](tasks/video-load-reliability/T1410-video-load-regression-since-0408.md) | DONE | 5.0 | [ ] | Warmer aborts on foreground load, StrictMode dedup -- 35-56s -> ~400-950ms cold load |
| T1420 | [Warmup Abort Polish](tasks/video-load-reliability/T1420-warmup-polish.md) | DONE | 2.0 | [ ] | Silence AbortError-as-failure log; dedupe StrictMode double-invoke of init load |
| T1430 | [Range Overbuffer (2151s for 8s clip)](tasks/video-load-reliability/T1430-range-overbuffer.md) | DONE | 1.5 | [ ] | Observability + two-window proxy: cold 20.5s->2.0s, warm 2.2s->0.6s; Step 3 MSE unnecessary |
| T1440 | [Trace multi-video games fail in framing](tasks/video-load-reliability/T1440-trace-multi-video-games.md) | DONE | 1.0 | [ ] | Clips endpoint joined only `games` for blake3_hash; multi-video games store it per-sequence in `game_videos` -> `game_video_url` null -> framing 404 |
| T1450 | [Trace load parity via R2 faststart migration](tasks/video-load-reliability/T1450-trace-load-parity.md) | DONE | 1.5 | [x] | One-shot `ffmpeg -movflags +faststart` rewrite of 13 moov-at-end games on R2; all verified faststart; Trace load 3.2s->2.95s (remaining gap to Veo parity tracked in T1460) |
| T1470 | [R2 objects missing Content-Type](tasks/video-load-reliability/T1470-r2-content-type-missing.md) | DONE | 4.0 | [x] | `CopyObject`-stamp ContentType=video/mp4 on all `games/*.mp4`; fix faststart script to preserve header. Staging: 22/23 migrated |
| T1460 | [Warm-path parity + faststart route choice](tasks/video-load-reliability/T1460-warm-path-parity-faststart.md) | DONE | 1.5 | [ ] | Move direct-vs-proxy decision into `useVideo` so freshest warm state wins; `warm_status` keyed on R2 URL; backend warmup payload includes `clip.id`; `?direct=1` A/B flag for faststart route measurement |
| T1480 | [cacheWarming test asserts stale fetch count](tasks/T1480-cachewarming-test-stale-fetch-count.md) | DONE | 4.0 | [ ] | Pre-existing: T1410 test expects 1 fetch but warmClipRange fires 2 (head-prewarm + body) since T1430. Assertion needs updating. Found during T1460 |
| T1490 | [First clip-stream request returns 401, frontend hangs](tasks/T1490-video-stream-first-request-401.md) | DONE | 5.0 | [ ] | Fix: crossOrigin=use-credentials on same-origin proxy URLs in detached video probe; cacheWarming fetches branched on origin. Backend log confirmed zero 401s on /stream |
| T1500 | [Persist clip dimensions, eliminate metadata probe](tasks/video-load-reliability/T1500-persist-clip-dimensions.md) | DONE | 2.5 | [x] | Follow-up to T1490: persist width/height/fps on working_clips, backfill existing rows, skip frontend metadata probe when fields present. Removes N media probes per project load |

### Epic: For Launch (IN_PROGRESS)
[tasks/for-launch/EPIC.md](tasks/for-launch/EPIC.md)

Goal: Make money, virality, super polished. Most tasks here are yet to be generated based on alpha feedback.

#### Infrastructure

Scale, performance, and reliability — must be solid before feature work.

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
|  | **[Export Pipeline](tasks/export-pipeline/EPIC.md)** | 5 | 4 | 1.3 |  |  | Non-blocking I/O + unify single/multi-clip export paths |
| T1110 | ↳ [Non-Blocking Export I/O](tasks/export-pipeline/T1110-never-block-server.md) | 5 | 3 | 1.0 | DONE | [ ] | Wrap sync subprocess/R2 calls in `asyncio.to_thread()` — Modal calls already async, surrounding I/O blocks event loop |
| T1116 | ↳ [Extract Shared Pipeline](tasks/export-pipeline/T1116-extract-shared-pipeline.md) | 4 | 4 | 1.0 | DONE | [ ] | Extract `_export_clips()` + `ClipExportData` from multi_clip.py; `export_multi_clip` becomes thin adapter. No behavior change. |
| T1117 | ↳ [Route Single-Clip Through Pipeline](tasks/export-pipeline/T1117-route-single-clip.md) | 4 | 5 | 0.8 | DONE | [ ] | `render_project` delegates to `_export_clips([clip])`. Delete 800 lines of duplicated logic. Unify response shapes. |
|  | **[Session Scaling Epic](tasks/session-scaling/EPIC.md)** | 8 | 5 | 1.6 |  |  | Session pinning + write-back R2 sync + data loss recovery. Makes per-user SQLite correct and fast at multi-machine scale. |
| T2250 | ↳ [Write-Back R2 Sync](tasks/session-scaling/T2250-write-back-r2-sync.md) | 8 | 5 | 1.6 | TODO | [ ] | Move R2 sync from blocking-per-gesture to periodic background (~3 min). Sync on sign-out, export, session invalidation. Writes respond in <5ms instead of ~200ms. |
| T40 | ↳ [Single Active Session Handoff](tasks/session-scaling/T40-single-active-session-handoff.md) | 8 | 5 | 1.6 | TODO | [ ] | Auto-signout old device on new login, sync R2 before 401, retry on failure, "signed in elsewhere" UX. Orchestrates device handoff end-to-end. |
| T2260 | ↳ [Data Loss Detection & Recovery](tasks/session-scaling/T2260-data-loss-detection-recovery.md) | 7 | 4 | 1.8 | TODO | [ ] | Detect version gaps on reconnect after crash. Auto-grant goodwill credits, notify user with clear explanation. |
| T1537 | ↳ [Consolidate Achievement POSTs (fire-and-forget analytics)](tasks/session-scaling/T1537-consolidate-achievement-posts.md) | 5 | 3 | 1.7 | BLOCKED | [ ] | Depends on T2250 (write-back). The achievement POST's ~610ms is synchronous `record_milestone` (Postgres + user.sqlite); it's already FE fire-and-forget so the user feels none of it. Fold the achievement INSERT into the action handler AND make the milestone emit fire-and-forget — a persistence-model change deferred until sessions are single-machine + write-back. Design ready: [T1537-design.md](tasks/T1537-design.md). Moved here from the Quests Latency epic. |
|  | **[Analytics System (OpenPanel)](tasks/analytics/EPIC.md)** |  |  |  |  |  | Replace CF Web Analytics with self-hosted OpenPanel: 41 events, 4-tier dashboards, credit-economy metrics, computed intelligence (churn/LTV/tiers), alerts |
| T1700 | ↳ [Foundation](tasks/analytics/T1700-foundation.md) | 6 | 5 | 1.2 | TODO | [ ] | Deploy OpenPanel VPS, SDK integration (frontend + backend), 8 activation events, L1 Daily Pulse dashboard, remove CF Web Analytics |
| T1701 | ↳ [Core Analytics](tasks/analytics/T1701-core-analytics.md) | 6 | 5 | 1.2 | TODO | [ ] | Full 41-event taxonomy, L2 Weekly Health dashboard (7 sections), session replay, quest funnels, admin panel -> OpenPanel links |
| T1702 | ↳ [Monetization + Intelligence](tasks/analytics/T1702-monetization-intelligence.md) | 6 | 5 | 1.2 | TODO | [ ] | Credit events, Stripe revenue tracking, nightly analytics engine (churn risk, engagement tiers, credit health, LTV), hourly/weekly alerts, viral attribution |
| T1703 | ↳ [Optimization](tasks/analytics/T1703-optimization.md) | 5 | 4 | 1.3 | TODO | [ ] | L3 deep-dive template, feature release protocol, aha moment regression, magic number testing (requires 200+ users) |
|  | **[R2 CDN Video Serving](tasks/r2-cdn/EPIC.md)** | 4 | 5 | 0.8 |  |  | Custom domain + HMAC auth + HTTP/2 + CDN caching. Presigned URL streaming done in T3250; this epic adds edge infrastructure. **Re-scoped 2026-06-18 (T3760): latency justification debunked** (measured TTFF 266 ms, seeks don't stall even saturated); surviving value = caching + egress-at-scale + auth = low-urgency infra. Impact 9->4. Depends on T3250. |
| T2550 | ↳ [CDN + Auth Worker](tasks/r2-cdn/T2550-r2-custom-domain-cdn.md) | 4 | 4 | 1.0 | TODO | [ ] | Custom domain (`cdn.reelballers.com`) + HMAC auth Worker + HTTP/2 + CDN caching. Auth-only Worker (no byte proxying). **Re-scoped 2026-06-18 (T3760):** HTTP/2 6-socket-cap latency story is empirically weak (seeks don't stall even saturated; R2 TTFB ~150 ms). Surviving value = CDN caching + egress-at-scale + HMAC auth, not a latency fix. Impact 8->4. |
| T2560 | ↳ [Edge Byte-Range Clamping](tasks/r2-cdn/T2560-edge-video-worker.md) | 7 | 5 | 1.4 | DONE | [ ] | **Resolved KEPT-SKIP (T3760, 2026-06-18): NOT built.** A `Content-Length` clamp has no measured latency benefit (TTFF 266 ms; seeks ~300 ms even under 8-socket saturation) and R2 egress is free. The 2026-06-17 un-skip was a HAR misread. See [T2560](tasks/r2-cdn/T2560-edge-video-worker.md) + [T3760-decision.md](tasks/T3760-decision.md). |
| T2570 | ↳ [Remove Fly.io Video Proxy](tasks/r2-cdn/T2570-remove-flyio-video-proxy.md) | 4 | 3 | 1.3 | TODO | [ ] | Delete proxy endpoints made redundant by T3250 + CDN path. After CDN stable 2+ weeks. |
| T2580 | ↳ [Faststart Upload Validation](tasks/r2-cdn/T2580-faststart-upload-validation.md) | 6 | 2 | 3.0 | TODO | [x] | Validate faststart on upload, auto-remux if needed, store is_faststart flag. Prevents non-faststart regression after T3250 drops proxy moov windows. |
| T2270 | [Session Inactivity TTL](tasks/T2270-session-inactivity-ttl.md) | 5 | 2 | 2.5 | TODO | [ ] | Expire sessions after N days of inactivity using last_seen_at. Absorbs T420 inactivity portion. Depends on T1190. |
| T3420 | [Profile Critical-Path Endpoints](tasks/for-launch/T3420-profile-bootstrap-endpoint.md) | 9 | 3 | 3.0 | DONE | [ ] | 375ms per-request baseline on ALL endpoints (even /api/health). Profile middleware + auth/me + bootstrap to find root cause. Target: baseline < 50ms, page load < 1.5s. |
| T3430 | [Parallelize Game Load](tasks/for-launch/T3430-parallelize-game-load.md) | 7 | 3 | 2.3 | DONE | [ ] | Opening a game fires 4 sequential requests (2.3s). game_id is known upfront -- single /api/games/{id}/load endpoint returns game + playback URLs + teammate data. Target < 1s. |
| T3440 | [Cache CORS Preflight Responses](tasks/for-launch/T3440-cors-preflight-caching.md) | 5 | 1 | 5.0 | TODO | [ ] | No Access-Control-Max-Age header -- browser fires OPTIONS preflight on every cross-origin request. 826ms overhead (17.8% of page time). One-line fix: add max_age=7200 to CORSMiddleware. |
| T1730 | [Performance Optimization Pass](tasks/for-launch/T1730-performance-optimization-pass.md) | 7 | 5 | 1.4 | TODO | [ ] | Pre-launch audit: slow endpoints, UI jank, bundle size, slow queries, unnecessary R2 round-trips |
| T2650 | [Move Sweep Auto-Export to Modal](tasks/T2650-sweep-to-modal.md) | 7 | 4 | 1.8 | TODO | [ ] | Sweep runs FFmpeg/recap on Fly.io via asyncio.to_thread — violates fast-server principle. Move auto-export compute to Modal; server becomes lightweight orchestrator (DB queries + Modal RPC). |

#### Features

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T2050 | [Framing Background Dim Control](tasks/T2050-framing-background-dim-control.md) | 6 | 2 | 3.0 | DONE | [ ] | Add dim/dark/preview toggle for area outside crop keyframe — lets users black out background for faithful reel preview before destructive "Frame Video" export |
| T1080 | [Gallery Player Scrub Controls](tasks/for-launch/T1080-gallery-player-scrub-controls.md) | 6 | 3 | 2.0 | DONE | [ ] | Scrub/seek controls in gallery video player are non-functional; users can't seek through exported videos |
|  | **[Overlay 2](tasks/overlay-2/EPIC.md)** |  |  |  |  |  |  |
| T2950 | ↳ [Ground Spotlight](tasks/overlay-v2/T2950-ground-spotlight.md) | 8 | 4 | 2.0 | DONE | [ ] | Flat ellipse at player's feet instead of body halo. Bbox bottom-edge projection, wide aspect ratio, fill-forward spotlight pool. Shape selector (Body/Ground) in settings. |
| T2180 | ↳ [Manual Telestration](tasks/overlay-v2/T2180-manual-telestration.md) | 6 | 5 | 1.2 | TODO | [ ] | Phase 2: freeze frame + draw arrow/circle/line, hold 1-2s, resume. Recruiting use case. CPU-only. |
| T2130 | ↳ [Player Label Overlay](tasks/overlay-v2/T2130-player-label-overlay.md) | 8 | 5 | 1.6 | TODO | [ ] | Name/number text tag following player tracker. Auto-positions, "minimal" and "broadcast" style presets. |
| T2140 | ↳ [Screen-Anchored Event Overlays](tasks/overlay-v2/T2140-screen-anchored-event-overlays.md) | 7 | 4 | 1.8 | TODO | [ ] | Score bug, GOAL/ASSIST badge, match metadata, time of play. Timestamp-triggered, corner-anchored. |

#### Completed

- T1150 Fix Pending Sync Retry No-Op — DONE
- T1152 Persist Sync-Failed State — DONE
- T1160 Clean Up Unused DB Rows — DONE
- T1170 Size-Based VACUUM on Init — DONE
- T1180 Fix NULL video_filename Root Cause — DONE
- T1200 Modal Job ID Logging & Retry — DONE
- T1380 Recover Orphaned Jobs Per-User at Startup — DONE
- T1390 Process Modal Queue Per-User at Startup — DONE
- T1130 Multi-Clip Stream Not Download — DONE
- T1120 Framing Video Cold Cache — DONE
- T1020 Fast R2 Sync — DONE
- T1010 Slow fetchProgress Response -- DONE

### Milestone: Marketing

Target audience: highly engaged soccer parents with enough technical ability to use the app. Reach them where they already spend attention.

Landing Page Redesign core tasks (hero, nav, visual foundation) in For Alpha -- polish tasks (how-it-works, features cut, sample reels, FAQ) deferred to For Launch. Pricing dropped (freemium model).

| ID | Task | Impact | Cmplx | Pri | Status | Migr | Description |
|------|------|------|------|------|------|------|------|
| T445 | [Vehicle Window Cards](tasks/T445-business-cards.md) | 6 | 2 | 3.0 | TODO | [ ] | Design + print cards to place on vehicle windows at games promoting reelballers.com with QR code. Targets parents already at the field. |
| T1930 | [Influencer Marketing](tasks/marketing/T1930-influencer-marketing.md) | 8 | 4 | 2.0 | TODO | [ ] | Identify top influencers that youth soccer parents follow who align with video technology use. Outreach strategy + partnership plan. |

### Epic: Post Launch (TODO)
[tasks/post-launch/EPIC.md](tasks/post-launch/EPIC.md)

Improvements after real user traffic.

| ID | Task | Status | Pri | Migr | Description |
|------|------|------|------|------|------|
| T710 | [Share with Coach](tasks/post-launch/T710-share-with-coach.md) | TODO | 1.2 | [x] | Coach account type + sharing: roster uploads, assign annotations to players, clip ratings, notes, send-back flow. Absorbs T1060 (Coaches View) |
| T720 | [Art Frames](tasks/T720-art-frames.md) | TODO | 1.1 | [x] | Draw on frozen clip frames (like a telestrator); shown during Play Annotations with a pause |
| T2170 | [Glow & Arrow Primitives](tasks/overlay-v2/T2170-glow-arrow-primitives.md) | TODO | 1.5 | [ ] | Soft radial glow aura + floating arrow pointer for wide shots. |
| T2190 | [Extended Presets](tasks/overlay-v2/T2190-extended-presets.md) | TODO | 2.5 | [ ] | "Recruiting" (minimal + persistent label) and "Social" (pulse + glow + broadcast name) presets. |
| T2200 | [Outline Trace Primitive](tasks/overlay-v2/T2200-outline-trace-primitive.md) | TODO | 0.7 | [ ] | Edge-detect player silhouette outline. Expensive to compute, premium-feel. |
| T2210 | [Spotlight Cone Primitive](tasks/overlay-v2/T2210-spotlight-cone-primitive.md) | TODO | 1.2 | [ ] | Darken/desaturate everything outside player region. High-drama cinematic effect. |
|  | **[Overlay 3](tasks/overlay-v2/EPIC.md)** |  |  |  | Composable overlay system: player labels, pulse rings, score bugs, event badges, presets. Clips look like pro TikTok/IG edits. |
| T2100 | ↳ [Composable Overlay Architecture](tasks/overlay-v2/T2100-composable-overlay-architecture.md) | TODO | 1.3 | [ ] | Refactor single ellipse into composable primitive system with common config, composition engine, stacking rules |
| T2120 | ↳ [Pulse Ring Primitive](tasks/overlay-v2/T2120-pulse-ring-primitive.md) | TODO | 2.3 | [ ] | Animated scale + opacity loop for dramatic moments (goals, big saves). 1-2s duration. |
| T2150 | ↳ [Overlay Presets System](tasks/overlay-v2/T2150-overlay-presets-system.md) | TODO | 2.0 | [ ] | One-click templates: "Spotlight", "Goal", "Custom". Wire up multiple primitives at once. |
|  | **[PWA Epic](tasks/pwa/EPIC.md)** |  |  |  | Background export + push notifications + background uploads + share target + offline playback |
| T443 | ↳ [Background Export Tracking](tasks/pwa/T443-background-sync.md) | TODO | 1.4 | [ ] | Export survives app close -- service worker tracks Modal job, notifies on completion. |
| T444 | ↳ [Push Notifications & Badges](tasks/pwa/T444-push-notifications-badges.md) | TODO | 1.6 | [ ] | Push for export complete + shared clips received. Badge count on app icon for pending items. |
| T447 | ↳ [Background Fetch for Uploads](tasks/pwa/T447-background-fetch-uploads.md) | TODO | 2.0 | [ ] | Multi-GB game uploads survive app close/switch. Parents upload at the field on cellular. THE differentiator. |
| T448 | ↳ [Share Target API](tasks/pwa/T448-share-target-api.md) | TODO | 2.3 | [ ] | Receive videos FROM camera roll directly into Reel Ballers upload flow. Eliminates file picker friction. |
| T449 | ↳ [Offline Reel Playback](tasks/pwa/T449-offline-reel-playback.md) | TODO | 2.0 | [ ] | Cache exported reels for offline viewing + persistent storage. Show reels without cell signal. |
| T1910 | ↳ [Tutorial Video](tasks/for-launch/T1910-tutorial-video.md) | TODO | 2.7 | [ ] | Record walkthrough video: upload game, annotate clips, frame, overlay, export. Embeddable on landing page and in-app onboarding. |

---

## Environment Configuration

### Credentials (Found)

**R2 Storage** (in `.env`):
```
R2_ENABLED=true
R2_ACCESS_KEY_ID=4f5febce8beb63be044414984aa7a3b4
R2_SECRET_ACCESS_KEY=***
R2_ENDPOINT=https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorage.com
R2_BUCKET=reel-ballers-users
```

**Modal GPU** (in `~/.modal.toml`):
```
token_id=ak-Gr72Vz5gr7MYVpcUowSeDB
token_secret=***
```

### Fly.io Secrets (for T100)

```bash
fly secrets set --app reel-ballers-api-staging \
  R2_ENABLED=true \
  R2_ACCESS_KEY_ID=4f5febce8beb63be044414984aa7a3b4 \
  R2_SECRET_ACCESS_KEY=<from .env> \
  R2_ENDPOINT=https://e41331ed286b9433ed5b8a9fb5ac8a72.r2.cloudflarestorage.com \
  R2_BUCKET=reel-ballers-users \
  MODAL_ENABLED=true \
  MODAL_TOKEN_ID=ak-Gr72Vz5gr7MYVpcUowSeDB \
  MODAL_TOKEN_SECRET=<from ~/.modal.toml> \
  ENV=staging
```

---

## Task ID Reference

IDs use gaps of 10 to allow insertions:
- `T10-T79` - Feature tasks (complete)
- `T80-T99` - Pre-deployment blockers + bug fix sprint
- `T100-T199` - Deployment epic
- `T200-T299` - Post-launch features + polish
- `T400-T430` - User Auth epic (T400=Google, T401=OTP, T405=D1, T420=sessions, T430=settings)
- `T500-T525` - Monetization epic
- `T1700-T1705` - Open Panel Analytics epic
- `T2100-T2220` - Overlay System v2 epic
- `T2250-T2260` - Session Scaling epic
- `T2300-T2380` - Landing Page Redesign epic
- `T2400` - Grace Period for Expired Games
- `T2410-T2430` - Expired Game Experience epic
- `T2450-T2470` - Auto-Export Reliability epic
- `T2480` - Modal Spline Interpolation
- `T2550-T2570` - R2 CDN Video Serving epic
- `T2670` - Upload Slow Connection Optimization
- `T2680` - Remove Video Link Import (legal)
- `T2750` - Unified Multi-Video Experience
- `T2800-T2860` - Team Sharing Alpha epic
- `T2880-T2885` - Games List Performance epic
- `T2890` - Cache Warming Efficiency (standalone, warming system upgrade)
- `T2900-T2910` - Invite & Referral epic
- `T2915` - Sport Inheritance Through Invite (link snapshot: referrals.inherited_sport v017 + shares.sharer_default_sport v018; NOT a users.default_sport mirror)
- `T2920` - Migration System Infrastructure (standalone)
- `T2930` - Postgres Data Locality Audit (standalone)
- `T3000-T3020` - Analytics 1 epic (CF Web Analytics + Postgres event log + admin migration)
- `T3030` - Cross-Origin Fetch Credentials (bug fix)
- `T3080` - Sync User Activity to SQLite (dual-write activity to per-user SQLite)
- `T3050` - Multi-Video Blank Video (bug fix, no error handling on dual video elements)
- `T3060` - Make It Load Fast (Playwright perf benchmarks against prod)
- `T3260` - Edit Game Metadata Post-Upload
- `T3270` - Clip Boundary Visual Indicator (Annotate mode)
- `T3450-T3490` - Analytics Power-Up epic (normalize schema, action log, fill tracking gaps, admin redesign)
- `T3290` - Tune NUF for Returning Users (differentiate returning vs first-time)
- `T3300` - Build Tutorial Video for Landing Page
- `T3070` - Brand Messaging Audit (emails, preloading, landing page high concept)
- `T3420` - Profile Critical-Path Endpoints (375ms per-request baseline, auth/me 1774ms, bootstrap 741ms)
- `T3430` - Parallelize Game Load (4 sequential requests -> 1 game bootstrap endpoint)
- `T446-T449` - PWA new tasks (Screen Wake Lock, Background Fetch, Share Target, Offline Playback)
- `T3540` - Framing "In Progress" Visual Ambiguity (progress strip half-fill + wording)
- `T3550-T3560` - Analytics: Attribution & Access Visibility epic (games uploaded vs accessible, user attribution graph)
- `T3570` - Track Annotation Playback Frequency (recurring usage event)
- `T3580-T3590` - Lifecycle Onboarding Emails epic (day 7/14/30 engine + content/personalization)
- `T1516` - Suppress Export-Job Analytics During Impersonation (split from T1515; stamp impersonated flag on export job, skip completion milestone)
- `T3595` - Share Viewer Opt-In & Viewer Analytics Bucket (consent-based how-to email for opted-in viewers; viewer leads bucketed separately from users)
- `T3600-T3640, T3670` - Season Highlights & Collections epic, DONE (metadata freeze, collections tab, live shares, ranking, "Top Plays" + dynamic smart collections). T3635 (reel order editor) moved to For Alpha - Polish. T3650/T3660/T3680 dropped (custom mix rename, quest rework, stitch).
- `T1536, T1537, T3760, T3770` - **Perf batch (HAR 2026-06-17)** — coordinated rollout across 2 branches / 3 conversations. See [perf-batch-har-2026-06-17.md](tasks/perf-batch-har-2026-06-17.md). Branch `feature/perf-quests-latency`: **T1536 DONE (deployed 2026-06-18)** as a correctness/DRY cleanup — HAR re-attribution showed `/progress` had no above-baseline server cost; **T1537 moved to the [Session Scaling epic](tasks/session-scaling/EPIC.md)** (BLOCKED on T2250 write-back, since its fix needs fire-and-forget analytics). Branch `feature/perf-page-load`: T3760 (framing clip cold-load over-fetch, re-opens T2560 clamp on latency grounds) + T3770 (StrictMode duplicate page-load fetch confirm, disjoint files).

See [task-management skill](../../.claude/skills/task-management/SKILL.md) for guidelines.
