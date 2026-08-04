---
domain: export-pipeline
updated: 2026-08-04 (T5180 rich text engine); 2026-07-22 (T5240 animated branded outro; T4200/T4210/T4230/T4240/T4280 bug sweep; T3950 branded outro)
---
# Export Pipeline — Domain Knowledge

## Scope
- `src/backend/app/routers/export/` — `framing.py` (722 L), `overlay.py` (2,243 L), `multi_clip.py` (2,500 L), `before_after.py` (381 L), `__init__.py` (mounts all under `/api/export`, `__init__.py:24`)
- `src/backend/app/routers/exports.py` — durable job status/recovery (`/api/exports/*`, prefix at `exports.py:38` + `main.py:156`)
- `src/backend/app/services/export_helpers.py`, `export_worker.py`, `auto_export.py`, `transitions/`
- `src/backend/app/routers/downloads.py` — publish ("Move to My Reels") / restore-for-edit
- `src/backend/app/middleware/db_sync.py` — durable-sync machinery; `src/backend/app/websocket.py` — progress channel
- DB tables (per-user profile SQLite): `export_jobs`, `working_videos`, `final_videos`, `working_clips`, `projects`. Readers use `MAX(version)` via `app/queries.py` (`latest_working_clips_subquery`, `latest_final_videos_subquery`)

## Entry points
| Route | Handler | What it does |
|---|---|---|
| `POST /api/export/render` | `framing.py:350 render_project` | Backend-authoritative single-clip framing render; 202 + background `_run_render_background` (`framing.py:508`) |
| `POST /api/export/framing` | `framing.py:160 export_framing` | Accepts frontend-rendered video; uploads to R2, inserts `working_videos`, stamps `working_clips.exported_at` |
| `POST /api/export/multi-clip` | `multi_clip.py:1832 export_multi_clip` | Multi-clip concat (transitions); 202 + `_run_multi_clip_background` (`:1989`) → shared `_export_clips` (`:1191`) |
| `POST /api/export/render-overlay` | `overlay.py:1961 render_overlay` | Highlight overlay render (Modal or local); 3 completion paths (no-keyframes copy `:2083`, test `:2159`, real render → `_run_overlay_export_background` `:1830`) |
| `POST /api/export/final` | `overlay.py:1150 export_final` | Save frontend-rendered final video; request-scoped `durable_sync` dependency (`:1155`) |
| `POST /api/exports` + `/api/exports/framing` | `exports.py:436/:475` | BackgroundTasks path → `export_worker.process_export_job` (`export_worker.py:146`) |
| `GET /api/exports/{job_id}/modal-status` | `exports.py:797` | Recovery source of truth; may call `finalize_modal_export` (`exports.py:191`) |
| Sweep (no route) | `auto_export.py _export_brilliant_clip` | **T4175**: pre-expiry, preserves each never-framed clip's extract to `raw_clips/auto_*.mp4` + wires `raw_clips.filename` + leaves a frameable draft. NO publish, NO archive (was: `final_videos` insert + `archive_project`). Already-framed reels still skipped (T4160). |
| `POST /api/downloads/publish/{project_id}` etc. | `downloads.py:818` publish, `:923` restore | Both use `durable_sync` dependency |

**The 6 export triggers** (T4370 harness must snapshot all of them): single-clip render (`/render`), multi-clip Modal branch, multi-clip local branch (`_export_clips:1236` vs `:1463`), overlay final (`render_overlay`/`/final`), durable worker (`export_worker.process_export_job`), sweep auto-export (`auto_export._export_brilliant_clip`).

**Progress:** WebSocket `/ws/export/{export_id}` (`main.py:181`, handler `websocket.py:154`).
- `manager.send_progress` is fire-and-forget — dropped if no client connected (`websocket.py:123-126`); last frame mirrored into the in-memory `export_progress` dict for late polls.
- `websocket.py:21 make_progress_data` is the single payload builder: `status`/`done` derive from `phase`; `phase in (complete,done,error)` → `done=True`.
- Durable state lives ONLY in `export_jobs` rows (`GET /api/exports/active|recent|unacknowledged`); recovery/reconnect flows poll those, never the WS.

**Credits:** GPU exports reserve → insert job → confirm before dispatch (`framing.py:446-478`, `multi_clip.py:1927-1958`, `exports.py:536-595`); failure paths refund (`multi_clip.py:1760-1829`, `export_worker.py:206-219`).

## Data flow
```mermaid
graph LR
  FE[Export click] -->|202| R[router creates export_jobs 'processing']
  R --> BG[asyncio background task]
  BG -->|source: games/blake3.mp4 or raw_clips/| REN[Modal or local FFmpeg render]
  REN -->|upload| R2[(R2: working_videos/ final_videos/)]
  REN --> DB[(profile.sqlite: insert row, repoint project, complete job, stamp exported_at)]
  DB --> SYNC[sync_export_db_to_r2]
  SYNC -->|overlay only: gate| WS[WS COMPLETE]
```
- **Source resolution (T4175 `resolve_clip_source`, `export_helpers.py`):** framing (`_run_render_background`) and multi-clip both call the shared `resolve_clip_source(clip) -> (url, in_off, out_off, flexible)` instead of inlining the game key. Order, first hit wins, visible-fail on total miss (`SourceUnavailable`, no silent fallback): (1) game video present -> `(game_url, raw_start, raw_end, flexible=True)`; **T4140: HEAD-probed for EVERY game clip** (the recap is now a universal fallback, so a reclaimed game must fall through — the old "no extract -> skip probe" shortcut is gone; `r2_head_object_global` retries transient blips internally); (2) preserved per-clip extract (`raw_clips.filename` set) -> `(raw_clips/{filename}, 0.0, duration, flexible=False)`; (3) **T4140 recap** (`_resolve_recap_source`, FILLED): downloads `recaps/{game_id}_clips.json`, matches the entry by **raw_clip id** (`clip['raw_clip_id']`, the recap-mapping key — a recap entry's `id` is the raw_clips.id, see games.py `_compute_recap_clips`), returns `(presign(recaps/{game_id}.mp4), recap_start, recap_end, flexible=False)`; None (-> `SourceUnavailable`) when game_id/mapping/entry/recap object missing. Uploaded multi-clip clips keep their own `raw_clips/{uploaded_filename}` download path. `flexible=False` = frozen bounds (reframe-only, no wider trims). This is what lets a T4130 Create-Clip draft (no preserved extract) re-export after the game video is reclaimed.
  - Game clips are keyed `games/{blake3_hash}.mp4` in a GLOBAL (env-prefix-free, not per-user) R2 namespace, fetched via `generate_presigned_url_global` + ffmpeg `-ss/-to -c copy` extraction (now via the resolver; `multi_clip.py` game branch unchanged mechanics).
  - Hash resolved as `COALESCE(gv.blake3_hash, g.blake3_hash)` joining `game_videos`→`games` (`framing.py:399`, `multi_clip.py:2044`, `auto_export.py:125-129`).
  - Per-user artifacts: `raw_clips/`, `working_videos/`, `final_videos/`, `temp/multi_clip_{export_id}/`.
  - Export routers never touch `storage_refs`/`game_storage_refs` — the ref-count/reclaim lifecycle that can delete a `games/{hash}.mp4` lives in `materialization.py` / `sweep_scheduler.py` / `games.py`; `auto_export.py` is the pre-reclaim export hook.
- **Missing-source classification (T4990):** a re-export whose game source was reclaimed must
  record a TYPED `SOURCE_UNAVAILABLE` failure (user-actionable "expired/unavailable" wording),
  not a raw ffmpeg 404 string, so the UI can show the expired-source panel. Classify at the
  R2-object boundary, NEVER by parsing ffmpeg stderr (banned defensive patch). Primary path:
  `resolve_clip_source` already raises `SourceUnavailable` when every candidate source is gone.
  Backstop in `_run_render_background` (framing.py): on ffmpeg EXTRACT failure, re-probe with
  `export_helpers.source_confirmed_unavailable(clip)` (same HEAD probes resolve uses —
  `r2_head_object_global`/`file_exists_in_r2` retry transient blips internally, so True = a
  SUSTAINED miss = confirmed-404-only, T4820; a present source with a transient failure stays
  GENERIC). The outer handler maps `SourceUnavailable` → `classified_source_unavailable_message`
  (carries the `SOURCE_UNAVAILABLE` code + clip id) into `fail_export_job` + the WS error.
  Spec/regression: `test_t4050_missing_source_reexport.py` (was RED on master, deselected in CI)
  + `test_t4990_source_classification.py`. NOTE: the known-failures.md row + branch-ci.yml
  `--deselect` for test_t4050_missing_source_reexport are now stale (the test passes) — remove
  both once this lands.
- **Finalize transaction** (hand-copied 5×, drifted — see epic): insert `working_videos`/`final_videos` → repoint `projects.working_video_id`/`final_video_id` → complete `export_jobs` → stamp `working_clips.exported_at` + snapshot `raw_clip_version`.
  - Copies: `export_worker.py:259-339`, `framing.py:227-288`, `overlay.py:96 _finalize_overlay_export`.
- **Staged, unified multi-clip finalize (T5630, DONE):** the multi-clip finalizer's THREE divergent writers (Modal in-band, local in-band, recovery-only) collapsed into ONE path. `services/export_finalize.py`:
  - `upsert_working_video(job, *, filename, duration, highlights_data, detections_data=None, gpu_seconds, modal_function)` — the shared idempotent **persist transaction** (working_videos INSERT/UPDATE → repoint project → complete `export_jobs` → stamp `working_clips.exported_at`). **Insert-once-per-job** via the `export_jobs.output_video_id` back-reference (no UNIQUE on `(project_id, version)`, so enforced in code): if the job already has an `output_video_id` whose row exists → UPDATE in place (same version), else INSERT `MAX(version)+1`. Used by BOTH `_export_clips` branches (Modal via finalize_export, local directly) — the local branch passes `detections_data=None` (its historical omission).
  - `finalize_export(job, output_key, user_id, profile_id, *, video_duration, gpu_seconds, modal_function, progress_callback)` — the Modal **detect → persist → sync** orchestrator, resumable by `export_jobs.stage`. Idempotent early-return when `stage=='complete'` OR `status=='complete'`. Reconstructs `source_clips` from the persisted `input_data` (`build_clip_boundaries_from_input`, render-file-independent). **BINDING fidelity: detection fps defaults to 30 (do NOT pass `target_fps`); the detection fallback writes `_empty_video_detections()`, NOT `None`.** Sync gate (invariant #1) stays between persist and `stage='complete'`; on sync fail it stays at `persisting` and returns `sync_failed` (working_video committed locally + `mark_sync_pending` retry).
  - **Recovery == normal export:** `exports.py finalize_modal_export` is now a thin async adapter → `finalize_export` (output_key from the persisted `stage='rendered'` checkpoint, else `modal_result.output_key` for pre-v028 jobs). Both recovery sites (`check_modal_status`, `resume-progress`) `await` it. `export_worker.recover_orphaned_jobs` unchanged (delegates completed Modal jobs to `/modal-status`). This deleted writer 3's old minimal `INSERT INTO working_videos (project_id, filename)` — the Brilliant-Control incident (recovery lost overlay data) is closed.
  - **Schema:** `export_jobs.stage TEXT DEFAULT 'queued'` + `output_key TEXT` (profile_db **v028**, tuple-row-factory-safe set-based backfill; runs manually post-deploy). 6-state `ExportStage` enum (`constants.py`): `queued→rendering→rendered→detecting→persisting→complete` (no `synced` — sync is a gate, not a persisted state). `stage` is exposed on the export-job JSON payloads (`ExportJobResponse`, guarded by `_has_stage_columns` for the deploy→v028 window — a below-head DB reads `stage=None`, never 500s). Checkpoints wired in `_export_clips` (`rendering` in the `store_modal_call_id` callback; `rendered` + `output_key` + `input_data={clips,transition}` via `_persist_rendered_checkpoint` after Modal success).
- **`final_videos` writers (2):** `overlay.py` (`_finalize_overlay_export`), `overlay.py` (`export_final`) — both insert `poster_filename=NULL` (poster columns filled by a SEPARATE `generate_poster_at_export` call the caller awaits right after, T5410) + the frozen `slowmo_section_*`. (The T4175 sweep is NO LONGER a `final_videos` writer — it produces a needs-framing draft + `raw_clips/` extract, no publish, no `published_at`.) `test_seams.py` seeds published rows directly for tests only.
- **`final_videos.name` re-freeze at publish (T5260):** the render-time INSERT freezes `name` from `projects.name` at that moment, but the draft stays renameable in Reel Drafts until it's moved to My Reels. `publish_to_my_reels` (`downloads.py:1208`) re-reads the CURRENT `projects.name` and writes it into the same `UPDATE` that sets `published_at`/`watched_at`, so a rename-after-render isn't silently lost. If the project row is missing/gone (dangling `final_videos.project_id`, see T4800 below) or its name is empty, the existing frozen name is kept (no NULL overwrite) and an info `[Publish]` log line notes why. This makes PUBLISH the second and last freeze point for `name` — the gallery rename endpoint (`downloads.py:~868`, guarded `published_at IS NOT NULL`) is the only writer after that. Single write path per phase: render owns pre-publish, publish re-freezes once, gallery rename owns post-publish; no path overlaps another.
- **Branded outro (T3950):** "Made with Reel Ballers" (~2.4s animated dark card since T5240; ~1.75s static originally) attached via two non-invasive paths:
  - **Playback compositing (shared/public surfaces only):** `BrandedEndCard.jsx` (React) shown by `SharedVideoOverlay` (on `MediaPlayer.onEnded`) and `SharedCollectionView` (on `CollectionPlayer.onEnded`); inline DOM overlay in the edge-function share page (`functions/shared/[token].js`, `v.ended` listener). No re-encode, no migration — every existing reel gets the card for free on next view. Never shown in editor/ranker/owner My Reels (prop-gated via `visible` prop).
  - **Download-time burn-in:** `GET /api/downloads/{id}/file` downloads from R2 into a temp dir, calls `append_branded_outro(original, out)`, streams the result, then cleans up in `finally`. Non-fatal: any failure logs loudly and serves the original (HTTP 200 always). Card is cached per (width×height, fps, pix_fmt, audio layout) in `/tmp/rb_outro_cards/` (MD5 keyed, atomic rename on build). Stored `final_videos` carry NO outro — the burn happens at serve time on demand.
  - Gate: `BRANDED_OUTRO_ENABLED` env var (backend, default true) + `BRANDED_OUTRO_ENABLED` constant (`src/frontend/src/constants/brandedOutro.js`, default true).
  - **T5240 — animated card (2026-07-22):** the download-burn card is ANIMATED entirely inside `_build_outro_card`'s `filter_complex` (still encoded ONCE + cached, so animation is free at export). `OUTRO_DURATION` bumped `1.75`→`2.4` for the extra beats. The logo is rebuilt from its SVG PARTS (not the old flat `reelballers-lockup.png`, now unused): `assets/branding/reelballers-ring.png` (film-reel ring + 4 sprocket holes) and `reelballers-play.png` (white triangle), both rasterized from `src/assets/logo/logo.svg` on a TRANSPARENT canvas. Motion: (1) WHITE-FLASH entrance (`fade=t=in:color=white:st=0:d=OUTRO_FLASH_IN`, applied LAST so frame 0 is deterministically white on every ffmpeg build — the portable anchor); (2) the ring SPINS in, decelerating to a stop (`rotate=a='<ease-out>':c=none`, `OUTRO_SPIN_D`/`OUTRO_SPIN_TURNS`) + alpha fade; (3) the play triangle LANDS with a press bounce (`scale=w/h='<ease-out-back>':eval=frame`, `OUTRO_PLAY_ST`); (4) staggered captions "Made with" + "Reel Ballers" brand (`OUTRO_BRAND_IN_ST`), tagline `TAGLINE_TEXT` (`OUTRO_TAGLINE_IN_ST`), URL (`OUTRO_URL_IN_ST`), drawtext `alpha='if(...)'` ramps. `_CARD_VERSION` bumped `v3-animated`→`v4-spin-play`. **Landmines:** (a) `overlay` CANNOT composite an input whose size changes per frame (`scale …:eval=frame` feeding it freezes on frame-0's size) — PAD each scaled play frame back onto a CONSTANT `play_canvas` (`pad=…:eval=frame`, sized > the overshoot) before overlay; (b) drawtext CANNOT reliably inline an apostrophe (the tagline's `Player's`) across ffmpeg builds — write it to a temp file and use `textfile=`; (c) filtergraph expression values are single-quoted, so do NOT also backslash-escape their commas; (d) the luma-read test harness must read the FIRST `metadata=print` line (`lines[0]`), not the last — `-frames:v 1` bounds the muxer, not the metadata filter, and older CI ffmpeg prints many lines. Concat/probe-match/non-fatal/cache contract unchanged. Tests: `test_t5240_animated_outro.py` (flash entrance, ring-before-play ordering, play press bounce, caption stagger, exact tagline — via luma-over-time) + `test_t3950_branded_outro.py` (unchanged, still green).
- **Share posters / og:image (`services/poster.py`, T4890 -> T5090/T5180 -> T5280 -> T5410):** one frame stored as a JPEG in R2 so share links unfurl with a real image. **T5410 REVERSED T5280 and replaced the reel selection heuristic entirely — capture moved back to overlay EXPORT, and the byte-size/clearest-frame selector was CUT for reels.** No detection of any kind (no new YOLO, no Modal call, no CPU inference) — the study's only strong signal (open-play zone beats the spotlight instant) is realized purely as a candidate-window gate computed by arithmetic on the already-frozen `slowmo_section` (`poster.py::open_play_window`); within the window the frame is either the user's overlay-timeline marker (honoured verbatim, never clamped) or the deterministic midpoint (`select_poster_frame`). Recap/draft posters are UNCHANGED and still use `extract_clearest_frame_jpeg` (byte-size heuristic, whole-clip/clip-region windows) — that heuristic was only ever wrong for the reel/slow-mo case the study measured.
  - **Capture point (T5410): overlay EXPORT, not publish.** `generate_poster_at_export(user_id, final_video_id, final_filename, section, final_duration, user_marker_time)` runs AFTER `_finalize_overlay_export`/`export_final` return (final video + row both exist) and BEFORE the sync-then-announce barrier (T4110), in each async completion path (`_run_overlay_export_background`, the no-keyframes copy path, the test-mode path, `export_final`) — so `poster_filename`/`poster_frame_time`/`poster_source` ride the SAME durable R2 sync as the rest of finalize. With no detection this is one ffmpeg seek (`_grab_and_store_poster_frame`, single `extract_first_frame_jpeg` call at the already-decided time) + one R2 upload — no added export latency, no per-export GPU cost on drafts that are never published. Best-effort/never-raises (poster failure never fails export, same T4110 invariant as before).
  - **Publish (`downloads.py::publish_to_my_reels`) NO LONGER GENERATES A POSTER** — `generate_poster_at_publish` is DELETED. Publish now does a best-effort HEAD check only (`file_exists_in_r2` against the deterministic poster key, wrapped so a check failure never fails publish) and logs at info if absent (pre-T5410 export, or a poster that failed at export).
  - **Selection algorithm** (`poster.py`): `SPOTLIGHT_SKIP_SECONDS=2.0`, `END_MARGIN_SECONDS=0.3`, `MIN_WINDOW_SECONDS=0.5`. `open_play_window(section, final_duration)` — no section -> whole clip minus the end margin; section present -> skip the first `SPOTLIGHT_SKIP_SECONDS` (the contested/occluded spotlight instant), clamp the end to `final_duration - END_MARGIN_SECONDS`; if what's left is under `MIN_WINDOW_SECONDS`, degrade to the WHOLE section. `select_poster_frame(window, user_marker_time)` — the marker if set (verbatim, never clamped into the window — a deliberate spotlight pick is a decision, not an error), else the window midpoint. Both pure arithmetic, no I/O, fully unit-tested (`test_t5410_poster_selection.py`).
  - **Pre-export marker (`projects.poster_marker_time`, profile_db v032):** the user's override, set from the OVERLAY timeline BEFORE a `final_videos` row exists. Lives on `projects`, NOT `working_videos` — `upsert_working_video` (`export_finalize.py`) INSERTs a NEW version row on every re-render (no UPDATE-in-place for a fresh render), so a `working_videos` column would be silently dropped on re-export; `archive_project` also DELETEs `working_videos` at publish entirely. The `projects` row's id never changes across re-render/archive/restore (archive keeps the row, only nulls `working_video_id`; restore's dynamic column list carries a new column through automatically), so a column there survives the reel's whole lifecycle for free — this is what dissolves "does an override survive re-export" as a non-question (no finalize special-casing; re-export just re-reads the same marker). `get_project_poster_marker_time`/`set_project_poster_marker_time` are the single read/write pair (column-guarded for the deploy->migrate window, mirrors the T6030 `_has_slowmo` pattern); `_finalize_overlay_export`/`export_final` each read it inline (same guard) and thread it into `generate_poster_at_export`. `GET /api/export/projects/{id}/overlay-data` also returns `poster_marker_time` + `poster_slowmo_section` (the live/reconstructed section) so the overlay timeline can render the marker default (client mirrors the window-gate arithmetic in `src/frontend/src/utils/posterWindow.js` — kept byte-identical to the backend constants on purpose). **T6380: `/overlay-data` also returns `poster_source` + `poster_filename`** (of the project's CURRENT `final_videos` row, **column-guarded** — v032 on a hot read, a below-head profile must not 500 the overlay screen) so the overlay cover state is HYDRATED on every load: `OverlayScreen` seeds `posterUploadedFilename` from `poster_source === 'upload'`, restoring "Custom image in use" after a reload instead of falsely showing the auto/marker state. Hydration is a read (restore-read-only, no write-back).
  - **Pre-export endpoints** (`routers/export/overlay.py`): `POST /api/export/projects/{id}/poster-time` `{time: float|null}` — surgical, gesture-only write (drag-end / "Use current frame as cover"); `null` clears back to auto. `POST /api/export/projects/{id}/poster/upload` (multipart `image`) — decode-verifies via cv2 (rejects non-images), re-encodes JPEG capped to a ~1440px long edge, overwrites the deterministic poster key via `store_override_poster` (sets `poster_source='upload'`, `poster_frame_time=NULL` — no source frame to record). `POST /api/export/projects/{id}/poster/revert` (T6380, the inverse) — reverts a custom cover (upload OR overlay marker) back to auto/marker: `revert_to_auto_poster` REUSES the SINGLE selection path `generate_poster_at_export` (frozen-first section resolution, mirrors `backfill_posters`; duration via `_resolve_final_duration`; marker via `get_project_poster_marker_time`) to regenerate the frame and OVERWRITE the same deterministic key, so shares/og:image/share-email need zero changes and `poster_source` returns to `'overlay'` (marker still set) / `'auto'`. Requires an exported final video (same precondition as upload — 400 if none, **never a silent no-op**). **There is exactly ONE poster-selection path; a revert MUST NOT re-derive the frame.**
  - **Columns (`final_videos`, v032):** `poster_frame_time REAL` (final-timeline seconds the stored poster was captured at; NULL for uploads/legacy), `poster_source TEXT` (`'auto'|'overlay'|'upload'`; NULL = legacy, treated as auto). `poster_source` guards the admin backfill from clobbering a user's manual cover choice under `force`.
  - **Reels** (`open_play_window` + `select_poster_frame`, T5410 — replaces the old byte-size clearest-frame-in-first-half heuristic): the window gate above, not a per-frame score (every candidate shares the zone, so a per-candidate term was dead arithmetic — this is why NO detection is needed: the dominant signal is a decision about *when*, not *what's in the pixels*). `first_slowmo_section(clips)` (UNCHANGED) walks ordered `(segments_data, source_duration)` per working clip reusing `highlight_transform` (`canonicalize_segments_data` for the dual boundary format, `get_segment_speed`, `get_trim_range`; output = source/speed), accumulating per-clip offsets so MULTI-CLIP reels find the first slow-mo across the whole concatenation, respecting `trimRange`; a leading clip of UNKNOWN output length (`(None, None)`) -> bail (no bogus 0.0 offset). **The FULL section `[start,end]` (final time) is still FROZEN on `final_videos.slowmo_section_start/end` (profile_db v025)** at finalize — unchanged plumbing, now feeding `open_play_window` instead of a first-half clearest-frame window. **Why frozen (landmine):** publish (`archive_project`) PRUNES `working_clips`, so live reconstruction returns `[]` for every published reel. **Section resolution order** (`resolve_slowmo_section`, unchanged): (1) frozen columns; (2) live `working_clips`; (3) R2 archive `archive/{project_id}.msgpack`; unreconstructable -> None -> `open_play_window(None, duration)` (whole-clip-minus-margin, logged, NO fabricated first-frame). **Backfill** (`backfill_posters(force=True)`) resolves the section the same way, applies `open_play_window` + midpoint (never a user marker — backfill has none), grabs that ONE frame (`_grab_and_store_poster_frame`, no clearest-frame sampling); **skips `poster_source IN ('overlay','upload')` unconditionally, even under force** (never clobbers a manual cover); a profile predating even the `duration` column (v007) is column-guarded the same way `slowmo_section_*` already was, falling back to `_resolve_final_duration`'s ffprobe path. Poster basename stored on `final_videos.poster_filename`; **failure NEVER fails the export** (best effort, returns None).
  - **Honest-copy invariant:** the auto-pick is the midpoint of the open-play slow-mo — UI copy must never call it "AI-picked" or "smart".
  - **Game/teammate recaps** (T5180 -> T5270): **whole-clip clearest frame** (recaps are stitched, no per-segment slow-mo -> reel policy does NOT apply, selection helper unchanged). `ensure_recap_poster(recap_key, poster_key)` generates from `recaps/{game_id}.mp4` -> caches at deterministic `recaps/posters/{game_id}.jpg` (reuse-if-cached via HEAD, overwrite-safe, never raises). **Warmed at teammate-share-CREATION time (T5270)**, not generate-on-first-request: `poster.warm_recap_poster(user_id, profile_id, game_id)` (wraps `ensure_recap_poster` in `asyncio.to_thread`, swallows all exceptions/logs at info) is awaited inline from all three share-creation call sites -- `games.py: share_game`, `games.py: share_playback`, `clips.py: share_with_teammates` (once per `game_id`, gated on at least one share actually created) -- so the R2 object exists before the response returns and the first crawler to unfurl the link never pays the ffmpeg cost. The GET path stays as a self-healing fallback (pre-T5270 shares, evicted cache). Served via token-gated `GET /api/shared/teammate/{token}/poster.jpg` (`shares.py`, mirrors `_serve_poster_jpeg`; 24h cache; 404 -> edge branded-card fallback). `upload_bytes_to_r2_global(key, ...)` writes to a full env-prefixed key under the SHARER's prefix from the unauthenticated request. Teammate GET returns `poster_url` (stable proxy path) when a recap exists; teammate edge fn emits og:image via it.
  - **Reel drafts** (T5671, `poster.py::ensure_draft_poster` + `GET /api/projects/{id}/poster.jpg` in `projects.py`): a cheap cacheable thumbnail for UNPUBLISHED drafts (home tiles/carousel, T5672/T5673) — drafts have no `final_videos` row, so the reel/publish poster path does NOT apply. **Key: `posters/drafts/{project_id}.v2.jpg`** (T5682 card-size 480px; `.v2` suffix forced regeneration from the pre-resize objects) (per-profile, DETERMINISTIC from the id — NO DB column, NO migration; the key is derivable state). Source = the draft's FIRST working clip (min sort_order, latest version; `_load_first_clip_for_poster` mirrors `framing.py`'s clip query) resolved via `resolve_clip_source` (game → preserved extract → recap), clearest frame WITHIN the clip's `[in_off, out_off]` region (`extract_clearest_frame_jpeg(window=...)` — the whole-clip heuristic scoped to the clip; **no slow-mo policy**, that's finals-only). Cache-first (HEAD via `file_exists_in_r2`) → generate-on-miss → upload; a reclaimed/expired source raises `SourceUnavailable` → `None` → **endpoint 404** (frontend fallback tile, no fabricated image). **Invalidation is gesture-driven**: `invalidate_draft_poster(project_id)` (best-effort `delete_from_r2`, never raises) is called from the clip-composition handlers in `clips.py` — `add_clip_to_project`, `upload_clip_with_metadata`, `reorder_clips`, `remove_clip_from_project` — so the next GET regenerates; NO reactive watcher. Served by `projects.py::_serve_draft_poster_jpeg` (session-authed, per-profile fresh presign proxy, `Cache-Control: private, max-age=86400` + ETag, If-None-Match -> 304 — T5682). Poster failure NEVER fails the clip action (epic decision #1). Tests: `test_t5671_draft_poster.py`.
  - **Owner-facing card posters (T5673/T5681/T5682/T5683):** three session-authed tile routes — `GET /api/downloads/{id}/poster.jpg` (published reels, `downloads.py`), `GET /api/games/{id}/poster.jpg` (`games.py`), plus the draft route above. **All serve 480px q~70 card thumbs on SEPARATE keys** (`{name}.card.jpg` reels/games, `.v2.jpg` drafts) — og:image/share paths keep their untouched full-size `.jpg` keys. **Landmine: `final_videos.poster_filename` is often NULL on older reels even when the R2 object exists — derive the key via `poster_basename(filename)`, never trust the column.** Games: recap-derived poster wins; no recap + live source -> ONE frame at the HIGHEST-RATED clip's timestamp (tie -> earliest; no clips -> 60s offset) via `ensure_game_source_poster`; expired+no-recap -> 404 (fallback tile). T5682 serving: pooled keepalive R2 client (`get_poster_r2_client` — per-request AsyncClient was a repeat of the T4773 TLS-handshake landmine), R2's own ETag, `max-age=86400`, If-None-Match -> single HEAD -> 304, 404s negative-cached 60s. T5683 warming (`services/poster_warmer.py`): per-key async in-flight dedup + bounded semaphore (3-4); warm-at-gesture hooks in clip composition + game activation; bounded list-time warming on `GET /api/projects`+`/api/games`; `fire_and_forget()` holds STRONG task refs (bare create_task results are weakly referenced and GC-able mid-flight). Measured: 6 posters warm 0.62s after LIST; warm GET ~175-300ms.
  - **Landmines:** (1) `segments_data` dual format (full-list vs splits-only) — ALWAYS `canonicalize_segments_data` before walking pairs (Bug 20p). (2) **og:image is NEVER a presigned URL** (T4890 cache-poisoning) — all poster surfaces serve through stable token-gated proxies. (3) The stored `final_videos`/recap objects carry NO branded outro, so poster time-offsets match content exactly (outro is appended after content). (4) Any admin sweep querying a migration-added column (`poster_filename`, `poster_source`, `poster_marker_time`) must migrate each profile to head first + guard the query (T5110).
  - **T5410 overlay timeline marker (frontend):** `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.jsx` — a cyan pin pinned to the video-track TOP RAIL (same band as the playhead, `-top-3` absolute), rendered as a sibling of `RegionLayer` inside `TimelineBase`'s children slot so it never collides with the region band below. Pointer-Events drag (mirrors `RegionLayer`'s pattern) + `role="slider"` keyboard nudging + a 44px coarse-pointer hit box — visible at rest, never hover-gated (T5910/T6300 hidden-affordance class). State lives in `overlayStore.js` (`posterMarkerTime`/`posterSlowmoSection`/`posterUploadedFilename`, raw values only) and `overlayActions.js` (`setPosterTime`/`uploadPoster`/`revertPoster`); gesture-wrapped in `OverlayScreen.jsx` (`wrappedSetPosterMarkerTime`/`wrappedUploadPoster`/`wrappedRemoveUpload`, same `dispatchOverlayAction` pattern as every other overlay gesture — no `useEffect`→API). **T6380 (fixes the former "Remove is a no-op" limitation):** `wrappedRemoveUpload` now `await`s `overlayActions.revertPoster` (the `/poster/revert` endpoint above) and updates `posterUploadedFilename` FROM the response (not optimistically), so the R2 object is genuinely overwritten and `poster_source` reset. Bug 2 (also T6380): `posterUploadedFilename` was written ONLY from the upload response and never read back → session-local; now hydrated from `/overlay-data`'s `poster_source` on load.
- **Rich text engine (T5180, 2026-08-04):** ONE shared text system for styled text on video, replacing the vestigial pixel-based `TextOverlay`/`TextOverlaysData` stub (`schemas.py`, deleted). Backend renderer `services/text_render.py::render_text_layer(spec: TextSpec, frame_w, frame_h) -> PIL.Image` (RGBA, Pillow-only, no ffmpeg `drawtext`, no headless browser); frontend preview `components/RichText.jsx` (pure presentational, `<RichText spec boxWidth boxHeight/>`). Both read the SAME `assets/fonts/fonts.json` manifest (loader: `services/fonts.py`) and serve/load the SAME 6 TTFs (anton, oswald, graduate, alfa-slab, playfair, kanit-italic — `oswald`/`playfair` ship variable-font-only upstream, pinned to a single instance via `font.set_variation_by_axes([weight])` backend-side and CSS `font-variation-settings` frontend-side, both keyed off the manifest's single `weight` field). No consumer yet (T5210 card, T5225 Overlay burn-in are next); this task shipped the engine + a Playwright parity spec (`e2e/T5180-text-parity.spec.js`) proving the two renderers agree, at `TOL_BOX_FRACTION=1.5%`/`TOL_BASELINE_FRACTION=0.5%` (named constants, fill-only box/baseline; shadow/stroke asserted separately as presence/geometry, never folded into the box tolerance — an inflated-by-blur bbox would hide real drift).
  - **Unit invariant (documented once, above `TextSpec` in `schemas.py`):** `size`/`position.y` are fractions of frame HEIGHT; `maxWidth`/`position.x` are fractions of frame WIDTH; `position` is read as the anchor per `align` (left/center/right), `position.y` is the block's TOP edge; **`shadow.blur`/`stroke.width` are EM-RELATIVE** — a fraction of the element's OWN resolved `size`, not the frame directly (`blur_px = spec.shadow.blur * spec.size * frame_h`, mirrored in RichText.jsx as `blurPx = spec.shadow.blur * fontPx`). A frame-relative stroke/blur would give a small caption and a huge title in the SAME composition the same absolute stroke width — wrong the moment two text sizes coexist.
  - **Line advance = the face's own `ascent + descent` metrics, NEVER the browser's `line-height: normal` guess.** Backend: `font.getmetrics()`. Frontend: Canvas 2D `measureText().fontBoundingBox{Ascent,Descent}`, explicitly applied as `lineHeight: '${ascentPx + descentPx}px'` in RichText.jsx's textStyle — **landmine, diagnosed via parity**: CSS's own "normal" line-height is NOT reliably `ascent+descent` for every font (matched almost exactly for Anton — 232 vs 233px — but was 230px vs a backend 176px for Graduate, a 54px/font-specific divergence with no warning). Trusting the browser's default here silently drifts per-font; pin it explicitly instead.
  - **Canvas `measureText()` font metrics are approximate for an unpredictable number of animation frames after the custom `@font-face` is visually usable** — `document.fonts.ready` resolving (and `document.fonts.check(...)` returning true) is NOT sufficient proof the metrics have "settled"; the settle time varied 0 to 2+ rAF ticks run to run in testing, so a fixed-delay wait is not reliable. `RichText.jsx`'s `useSettledFontMetricsPx` hook polls every `requestAnimationFrame` after `fonts.ready` and only commits once two consecutive measurements are IDENTICAL (bounded by `maxFrames=30` so a pathological case can't hang). Anything that reads font metrics off a freshly-loaded custom font (canvas OR future consumers) should use the same settle-until-stable pattern, not a fixed rAF/timeout count.
  - **Frame-edge clipping:** the backend's Pillow canvas is physically `frame_w x frame_h` — ink from an unbreakable overflowing word (no mid-word break in v1, `text_render.py`'s `_wrap_paragraph`) past that edge is simply outside the pixel buffer and never counted. The DOM has no implicit equivalent, so `RichText.jsx`'s root box is `boxWidth x boxHeight` with `overflow: hidden` (matches the backend's physical bound for real rendering/preview). Note this only fixes what's *painted* — `getBoundingClientRect`/`getClientRects` on a clipped-away child still report its full untruncated geometry (CSS clipping is paint-time, not layout-time), so any DOM-geometry-based measurement of RichText content (the parity spec's tight-ink-bbox helper) must ALSO clamp its own result to `[0, boxWidth] x [0, boxHeight]` independently — the CSS clip does not make a geometry query "just work".
  - **Tight-ink bbox parity, not CSS-box parity:** `getBoundingClientRect()`/Playwright's `boundingBox()` measure the CSS line box (font metrics + line-height + the shrink-to-fit *available* width when content wraps), not glyph ink — diagnosed as TWO compounding landmines: (1) `display: inline-block` + a `maxWidth`-only wrapper resolves an inline-block's width via shrink-to-fit — once content needs to wrap, that formula collapses to the full *available* width, not the widest actually-rendered line (fixed: `display: inline`, whose `getClientRects()` return one rect per real line, unioned into the tight box); (2) `white-space: pre-wrap` visibly preserves the space that caused a soft wrap as its own trailing fragment (fixed: `white-space: pre-line`, which collapses it like `normal` while still honouring explicit `\n`). Even after both fixes, `getBoundingClientRect` still reports the CSS line-box (includes leading/whitespace above ascenders and below descenders), never the tight glyph-ink extent Pillow's numpy alpha bbox reports — for all-caps/no-descender captions this is NOT typically negligible, so the parity spec's own measurement (not RichText.jsx) walks the text node char-by-char via `Range`, groups characters into the browser's own real line-wrap boundaries, and re-measures each line's substring with Canvas 2D `measureText()`'s `actualBoundingBox*` fields (the browser's only tight-ink-bbox primitive) — see `measureTightInkBBox` in `e2e/T5180-text-parity.spec.js` for the full algorithm + landmine writeup.
  - **Test seams (dev/local-only, gated 3 ways like every `/api/test/*` seam):** `POST /api/test/render-text-bbox` (`test_seams.py`) calls the real `render_text_layer` and returns `{bbox, baseline_y, shadow_halo_bbox, stroke_extent_px}` computed the SAME way `tests/test_t5180_text_render.py` computes them (shared `_tight_alpha_bbox`, can't drift). `GET /debug/rich-text?spec=&boxWidth=&boxHeight=` (`main.jsx`, gated on `import.meta.env.DEV`, checked BEFORE `<App/>` mounts since this app has no react-router) mounts a bare `<RichText/>` with no chrome, for the parity spec to measure directly.
  - **Environment landmine (this sandbox specifically, not a code bug):** the Vite dev server here sometimes serves STALE transformed source after an edit — a raw `curl` of the module URL can show old content indefinitely until the dev server process is fully killed and restarted (a `touch` on the file is not reliable, and the staleness can silently reappear on the NEXT edit too). Verify `curl -s http://localhost:5173/src/<file> | grep <a string unique to your latest edit>` before trusting any Playwright run against a freshly-edited component; if it doesn't show your change, kill and restart `npm run dev` rather than debugging what looks like a logic bug.
- **My Reels grouping (T4190):** the frozen `final_videos.game_ids` BLOB (v008/T3605) is the PRIMARY game-attribution source — `collections_summary` and the `/api/downloads` game_id/mixes filters route by it (`route_collection`), and `list_downloads` now resolves `brilliant_clip` reels' `game_names`/`game_ids`/`group_key` from it too (`downloads.py:~306-470`), with the `raw_clips.auto_project_id -> game_id` chain kept only as a fallback for pre-v008 reels (empty blob). Frozen ids survive the source clip's draft being re-created (`auto_project_id` repointing), which previously dropped the published reel out of its group. `collections_summary` also exposes a per-bucket `unwatched_count` (`SUM watched_at IS NULL`) so the My Reels NEW badge (`GET /api/downloads/count`) always has a visible collapsed-group chip counterpart.
- **Durable sync:**
  - Background tasks bypass the request middleware, so they must call `export_helpers.sync_export_db_to_r2` (`export_helpers.py:333`) themselves. It blocks (`lock_timeout=None`), syncs BOTH profile DB and user DB, returns True only if both reached R2; on failure it marks sync pending for the middleware retry path.
  - Request-scoped writes instead use the `durable_sync` dependency (`middleware/db_sync.py:84`) → 503 `DURABLE_SYNC_FAILED_RESPONSE` on failure. Used by `/api/export/final` (`overlay.py:1155`), publish (`downloads.py:818`), restore (`downloads.py:923`).
  - Ordinary writes ride fire-and-forget `_background_sync` with a 0.5s lock defer — the loss path T4050/T4110 closed for gestures/exports.
- **Full-state save vs export:** `PUT /api/projects/{project_id}/clips/{clip_id}` (`clips.py:2001-2124`) — if clip already exported (`exported_at IS NOT NULL`) and framing actually changed, it inserts a NEW `working_clips` version (new version has `exported_at=NULL`) and returns `refresh_required`.
  - `exported_at` is stamped at export time only: `framing.py:263-269`, `multi_clip.py:1427-1432` (Modal), `:1719-1724` (local).
- **Multi-clip transitions:** strategy pattern in `app/services/transitions/` (`base.py:15 TransitionStrategy`, `TransitionFactory`; cut/fade/dissolve self-register). Called from `concatenate_clips_with_transition` (`multi_clip.py:1100`); unknown type falls back to `'cut'`; chapter markers embedded after concat (`multi_clip.py:1139-1188`).
- **before_after.py:** builds "Before vs After" comparison videos from `before_after_tracks` (rows written by `overlay.py:1283-1327` during `/final`). Pure local FFmpeg; no R2/DB writes, no `export_jobs`.

## Cross-profile game references (T5800, profile_db v030)
- A **reference game** is a `games` row with `source_profile_id IS NOT NULL` (+ `source_game_id`,
  both nullable, profile_db **v030**). It is a **metadata-only link** to a game owned by a SIBLING
  profile of the same user, materialized so a MOVED reel (T5810) keeps its by-game grouping in the
  target profile's Gallery. Referenceness is DERIVED (`source_profile_id IS NOT NULL`), there is NO
  `is_reference` boolean (EPIC decision 3). Metadata is FROZEN at materialization (name/opponent/
  date/type/tournament/dims/durations + `created_at` copied from source; a later rename of the
  owning game does NOT propagate).
- **What a reference row is NOT:** it has **no `game_storage` row, no Postgres `game_storage_refs`,
  no `game_ref_counts`** (EPIC decision 4 — video lifecycle stays 100% with the owning profile).
  So `list_games` (`games.py:_read_games_for_list`/`_list_games_impl`) **skips ALL storage-expiry
  computation for references** — a reference emits `storage_status=None`, `storage_expires_at=None`,
  `can_extend=False`, plus `is_reference=true`/`source_profile_id`/`source_game_id`/`source_profile_name`
  (owning profile's display name from `user_db.get_profiles`, ONE read, no N+1). `source_game_id` lets
  the frontend (T5820) locate the owning game by exact id match — including MULTI-VIDEO owning games,
  whose `blake3_hash` is NULL and so could never be used as a matching key. Athlete stats are naturally
  zero (no local `raw_clips`). NEVER show an expiry chip on a reference card.
- **Primitive:** `materialization.ensure_game_reference(target_conn, target_profile_id,
  source_profile_id, source_game_row, source_game_videos) -> int` (the 2nd cross-profile game
  copier; shares the insert with `_copy_game` via `_insert_game_with_videos`). 4-step resolution:
  (1) dedup on `(source_profile_id, source_game_id)`; (2) chain-collapse — a reference SOURCE
  resolves through its own source pointer so references never point at references (EPIC dec. 6);
  (3) hash-dedup against a REAL local game (share-materialized earlier) via
  `_find_existing_game_by_hashes` → reuse it, no reference; (4) else insert a reference. Takes an
  ALREADY-OPEN target conn (Row factory); callers own cross-profile DB opening + R2 sync ordering.
- **Migration-window (v030):** `source_profile_id`/`source_game_id` land on the bootstrap-hot games
  SELECT, so `_read_games_for_list` `column_exists`-guards them (projects `NULL` on a pre-v030 DB —
  nothing can create a reference until v030, so NULL is correct). Same class as T5970/T6030; the
  structural guard test `POST_V023_COLUMNS`/`HEAD_VERSION_AUDITED` was extended to v030.
- **Games-tab UI for a reference (T5820).** The frontend renders a reference (`is_reference:true`)
  as a `ReferenceGameCard` (subdued dashed link tile, "In {source_profile_name}" badge, NO expiry
  chip / kebab / annotate-delete-recap actions, no poster fetch) — the real `GameTile` is byte-identical
  for non-references. Clicking it switches to the owning profile (`profileStore.switchProfile`) and lands
  on ITS Games tab with the real game highlighted, located by exact `source_game_id` match against the
  target profile's own game list (`_list_games_impl` projects `source_game_id` under the `is_reference`
  gate, per the list above) — this works for MULTI-VIDEO owning games too, since it never depends on
  `blake3_hash`. A deleted owning game (its id no longer present in the target profile's list) degrades
  to a visible in-tab notice at click time (no cross-profile existence check on list render). Details:
  annotate.md §Landmines (T5820 breadcrumb).
- **Moved reels CARRY remapped `game_ids` (T5810).** `downloads.py:move_reels_to_profile` no longer
  nulls `game_ids`/`game_id` (the old T4850 behavior). Instead `_build_reference_map` resolves each
  distinct source game to a target reference via `ensure_game_reference` (per-DISTINCT-game, NOT
  per-reel — no N+1) and `_build_moved_reel_row` rewrites `game_ids` (sorted-distinct, re-encoded
  msgpack) + scalar `game_id` through that map; `project_id`/`source_clip_id` still stay NULL
  (editing lineage does not move). So a single-clip moved reel groups under the game header in the
  target Gallery, exactly like the source. `collections.py` (`route_collection`/summary) is
  UNCHANGED — grouping falls out of the remapped frozen `game_ids` (T4190 read path). Orphan
  references are cleaned gesture-driven (move-away Phase 2 + reel-delete), never a sweep. Sync
  ordering unchanged (rides the existing Phase-1 target `sync_db_to_r2_explicit`; persistence-sync.md
  § 6b-T5810).
- **Versioned heal for PRE-T5810 moved reels (T5830, profile_db v033).** Reels moved BEFORE T5810
  had `game_ids` nulled by the old move flow and their source reels deleted, so attribution can't be
  auto-derived. `v033_heal_moved_reel_attribution.py` restores it by REUSING `ensure_game_reference`
  (so every reference invariant above holds identically — same dedup, same `source_profile_id`/
  `source_game_id`, same "no storage/refcount participation", `video_filename NULL`) + setting
  `game_ids` to a msgpack single-id list; `game_id` stays NULL (the moved rows had it NULL and T5810
  only remaps a scalar that was already set). It applies a signed-off account-specific mapping
  (arshia's 14 reels → 6 references across 2 kid profiles), **gated on DATA SHAPE not user id**: a
  profile DB is touched only when it holds a `final_videos` row whose `(filename, clip_game_start_time)`
  matches the frozen mapping with `clip_count=1` and empty `game_ids` — filenames carry a unique random
  hex suffix and `clip_game_start_time` is compared at full REAL precision (`abs(a-b) < 1e-6`, never
  `==`/truncated), so it is a provable no-op for every other user and idempotent on re-run (a healed
  reel's `game_ids` is no longer empty). The source `games`/`game_videos` live in the DEFAULT profile
  (`b95eb93b`), opened read-only cross-profile via `open_profile_db_readonly` (the default sorts AFTER
  the kids so it may not be locally cached when a kid profile is migrated — R2-download is required, not
  a local-only open). Landmine: the runner hands `up(conn)` a TUPLE row factory, so gating reads index
  positionally, but `ensure_game_reference` needs a `sqlite3.Row` target conn — flip `conn.row_factory`
  to Row only around the primitive and restore it in a finally (v017 crashed on the tuple factory for 4
  prod users). Precedent gating style: v012/v018/v019 account/data-shape heals.

## Invariants & rules
1. **Sync-then-announce (T4110 + T4200, DONE 2026-07-11):** the R2 DB sync must succeed BEFORE the export is announced complete. **ALL THREE overlay completion paths gate COMPLETE on `sync_export_db_to_r2`** (T5300 verified): the no-keyframes copy path (`overlay.py:2043`) and the test-mode copy path (`:2110`) run inline and return **503** + a retryable `sync_failed` progress event on failure; the real-render **background** path (`_run_overlay_export_background:1817-1833`, the one that returns **202** and finishes async) gates the same way but — having already returned 202 — emits the retryable `_export_sync_failed_data` event over the WS/`export_progress` dict INSTEAD of a 503 (there is no live HTTP response to fail). Also gated: framing (`framing.py:718-722`) and multi-clip (`multi_clip.py:2298-2301` + COMPLETE sites `:1440-1448/:1737`). DB-save failure is terminal — no phantom export announces success. The `export_sync_failed_data` helper lives in `export_helpers.py:379` (no router→router imports); it sets `code='sync_failed'`, `retryable=True`, `phase='error'`.
   - **Landmine (T5300):** the sync-fault only surfaces as `sync_failed` if the render REACHES the durable boundary. On the background path the finalize INSERT (`_finalize_overlay_export`, `overlay.py:183`) writes `final_videos` incl. the v025 `slowmo_section_start/end` columns; a profile DB **behind head schema** throws `table final_videos has no column named slowmo_section_start` at that INSERT — BEFORE the boundary — so the terminal event is a plain `error` (no `code`), masking the durability check. This is NOT a durability gap: the boundary is sound; the DB was just un-migrated. A /dotask container pulls the user DB from R2 at whatever version R2 holds and does NOT auto-run migrations, so the self-verify spec must migrate the profile to head first (see Testing seams: `/api/test/migrate-current-profile`).
2. **Never destroy the old final video before the new one exists (T4010, DONE 2026-06-26):** re-export inserts a new `final_videos` version, repoints atomically, deletes the prior R2 object only post-commit (`overlay.py:1202-1210`, `:1336-1337`, `_finalize_overlay_export:189-190`); no speculative `final_video_id = NULL` at job-accept (`framing.py:245-248` comment; `export_worker.py:335` repoints working only). Failure paths restore prior pointers (`framing.py:696-703`).
3. **No export may create a working-clip version that drops just-exported framing (T4020, DONE, frontend):** the export→overlay transition must not fire a second full-state save; only the pre-render `saveCurrentClipState` (ExportButtonContainer) is the gesture. Backend faithfully persists what it receives — the guard is frontend convention only until T4400.
4. **Every DB write traces to a user gesture** (CLAUDE.md persistence rule); sweep auto-export is the one gesture-less writer, which is why it must become explicit parameters of the shared writer (epic decision 3, `docs/plans/tasks/export-write-path/EPIC.md`).
5. **Versioned reads:** never read `working_clips`/`final_videos` without the `MAX(version)` subqueries in `app/queries.py`. No UNIQUE constraint on `(project_id, version)` — coexisting old+new versions are by design.
6. Prefix note: `/api/export/...` = render pipelines (`routers/export/`); `/api/exports/...` = job status/recovery (`routers/exports.py`). Easy to confuse.
8. **Public single-reel share payload carries the sharer's frozen sport (T5130).** `GET /api/shared/{token}` (`shares.py get_shared_video`) now returns `sport` on `ShareDetailResponse`, sourced from the EXISTING `shares.sharer_default_sport` snapshot (v018/T2915) that `get_share_by_token` already selects via `s.*` — **no new column, no migration.** It is the sharer's DEFAULT-profile sport frozen at share-creation time (`create_shares` → `_sharer_default_sport`), so the anonymous public viewer (`SharedVideoOverlay` → `MediaPlayer` → `VideoControls`) can render the sport-ball scrub handle without a live cross-user read. `None` when the sharer's sport is unknown → viewer keeps the plain purple dot (no soccer fabrication). `VideoControls` stays store-free (a plain `handleGlyph` string prop; the landing build imports it via `@editor`).
7. **My Reels collection naming (T4810):** inside a game group the play-all collection card reads **"Game Highlights"** (`GameCollectionGroup` derives `cardTitle` from `shareScope.type === 'game'`); the `CollapsibleGroup` header keeps the bare game name so two games stay distinguishable (the T4190 anti-phantom disambiguation lives in the HEADER, not the card). `playTitle`/share stays game-identified. Mixes bucket keeps its own name. The flagship smart collection stays **"Top Plays"** (`collections.py TOP_PLAYS`) — do NOT rename it (more "Top {X}" collections are planned). Backend game share title is already `"{game} Game Highlights"` (`_build_collection_title`), unchanged.

## Landmines & history
- **T4010 (prod incident):** framing pre-step speculatively NULLed `final_video_id` at job-accept with no rollback → published reel destroyed by a failed re-export (prod project 30). Fixed; the invariant above is the residue. Game-source key scheme `games/{blake3}.mp4` misled the recovery search (no env prefix).
- **T4020 (prod incident):** redundant post-render full-state save (`FramingScreen.jsx` transition) persisted EMPTY crop/segments as a new shadow working-clip version; bloat-cleanup then pruned the real one → permanent framing loss. Recovery only via pre-prune R2 snapshot.
- **T4110 (prod incident):** export finalize rows rode fire-and-forget sync; machine cycle lost them → "edited reel vanishes from My Reels". Fix = sync-then-announce + `sync_failed` retry UX + v018 heal migration.
- **Rank-sweep incident (T4160/T4170):** sweep auto-export published raw 1080p stream-copies into the 9:16 ranking pool (its own `final_videos` writer, instant publish, hardcoded metadata). Sweep is still a parallel universe: no `export_jobs` row, own ffmpeg/R2/status literals (audit E8; unified in T4410).
- **Live bugs (audit 2026-07-03, fixed in bug sweep 2026-07-11):**
  - ~~Multi-clip swallows DB-save exceptions and still announces success~~ FIXED T4200 (terminal failure; sync-then-announce extended to framing+multi-clip).
  - ~~`exports.py` returned undefined `presigned_url`~~ FIXED T4790 (2026-07-10).
  - ~~Modal API error treated as "not running" → `cleanup_stale_exports` kills live paid job~~ FIXED T4240 (`check_modal_job_running` returns None on lookup error; cleanup skips jobs with unknown Modal status).
  - ~~Fabricated `recovered_{job_id}.mp4` when Modal result lacks `output_key`~~ FIXED T4240 (fails loudly, no fabricated row).
  - ~~`export_worker.py:198-204` except block reads try-scoped vars~~ FIXED T4240 (bare-except narrowed to `Exception`; vars are now always in scope).
  - Two competing job-create helpers with different initial status: `exports.py:86` (`'pending'`) vs `export_helpers.py:37` (`'processing'`, swallows insert failure) — T4380 unifies.
- WS progress is lossy by design; if you need durability, write `export_jobs`, don't add WS retries.
- `export_worker.process_framing_export` does NOT stamp `working_clips.exported_at` (drift vs the router paths).
- T2720 history: a 14s R2 upload lock once froze the UI post-export — keep syncs off the request path; change ordering, not threading.

## Testing seams
- `MODAL_ENABLED=false` → full local render path (T4120's sanctioned in-container verify mode); `FORCE_R2_SYNC_FAILURE` + machine-cycle simulation seams (prod-gated) exist for durability tests (`tests/test_t4050_durable_sync.py` is the pattern).
- **`POST /api/test/migrate-current-profile` (T5300, gated like every seam):** migrates the logged-in user's CURRENT profile (+ user.sqlite) to head schema via the same `_migrate_profile_db`/`_migrate_user_db` machinery as `POST /api/admin/migrate`, scoped to one profile. The T4120 durability spec calls it after login because the container's pulled DB is at whatever version R2 holds and migrations never auto-run — without it the overlay render dies at the finalize INSERT before the durable boundary (see Invariant 1 landmine). NOT a schema shortcut — it runs the real versioned migrations.
- **`POST /api/test/seed-recap-game` (T5710, gated like every seam):** seeds a game with rated clips on BOTH layers (`athlete_clips`/`team_clips`, team clips carry `tagged_teammates`) and (if `stitch=true`, default) runs the real `ensure_recap(game_id, layer)` for both layers so the game exits with genuine stitched per-layer recaps + `recap_video_url` set — same state a real auto-exported game reaches. Each clip is an 8s (`CLIP_SECONDS`) window, not 1s: a 1s-per-clip stitched video's autoplay drifted onto the next clip mid-assertion during a real e2e run's several-real-second Playwright steps, so "the active/currently-playing clip" (Create Clip's target, the NotesOverlay/transport label) would silently move on before the test finished checking the one it had just clicked. Bump `CLIP_SECONDS` further only if a similarly slow multi-step e2e flow reappears.
- **Landmine — shared `test-login` account + Playwright's bare `request` fixture:** `POST /api/auth/test-login` always resolves to the SAME fixed `e2e@test.local` account (ignores the `X-User-ID` header entirely — see `auth.py::test_login`); `X-User-ID` is only consulted as a fallback when a request carries no session cookie (`db_sync.py` middleware, cookie wins when present). Any e2e spec that (1) logs in via `test-login` (minting an `rb_session` cookie for that fixed account) AND (2) also calls the plain `request` fixture (a separate `APIRequestContext` that does NOT share the page's cookies) for seeding/cleanup will silently operate on TWO DIFFERENT user identities — the seeded/cleaned-up data lands in an orphaned `X-User-ID` namespace the cookie-authenticated browser never queries, and the UI falls back to showing whatever pre-existing game on the shared account happens to reuse the same autoincrement id (T5710 hit this: the modal opened a stale leftover game instead of the freshly seeded one). Fix/pattern: always use `page.request` for API calls in a spec that also drives `page` post-login — never the bare `request` fixture. Other specs (`collections.spec.js`, `T5330-share-signup-nuf.spec.js`) share this same login-then-bare-`request`-cleanup pattern and likely have the same latent no-op-cleanup bug; not fixed here (out of T5710's scope), flagging for whoever touches them next.
- WARNING (memory): backend tests TRUNCATE the real dev Postgres — warn the user before running; the guard blocks staging/prod only.
- T4370 will add `tests/export_golden/`-style DB-delta snapshots for all 6 triggers; until it lands there is NO broad characterization net — prefer surgical diffs. **The multi-clip finalizer IS now pinned** by `tests/test_t5630_characterization.py` (local in-band, Modal in-band, recovery == in-band) + `test_t5630_finalize_unit.py` (upsert/finalize idempotency, fallback) — reuse the T5600/T4200 mocked-pipeline harness (mock Modal AI call, R2, detection, sync; real profile SQLite via a `_init_cache` test user) for any further finalize change.

## Staging export timeline + overlay-export-mount gap (T6120, 2026-07-27)
- **The overlay->final pipeline is HEALTHY and FAST on staging** (`modal_enabled=true`). Measured on the
  imankh fixture (`9fa7378c`) via read-only `GET /api/exports/project/{id}`: framing renders complete in
  **64-114s** (proj 37: 64s, proj 51: 114s); a real overlay export completed in **~16s** (proj 31,
  2026-07-22, `final_31_eda94512.mp4`). None of these is anywhere near the derisk spec's 480s budget.
- **The `derisk-staging-export.qa.spec.js` 480s failure / T5420 SKIP were the SAME root cause, and it is
  NOT a render stall — the overlay export never STARTED.** For a pre-framed single-clip draft the overlay
  Export button is gated on `OverlayScreen.effectiveOverlayVideoUrl = workingVideo?.url` (screen-scope,
  `OverlayScreen.jsx:204`, passed to `OverlayModeView` at `:1124` — NOT the container-scope
  `OverlayContainer.effectiveOverlayVideoUrl`; `framingVideoUrl` is a pass-through used only for
  un-framed / multi-clip / edited drafts). The panel mounts iff `workingVideo` hydrates, which needs the
  working-video presigned R2 URL to actually LOAD.
- **The earlier T5420 diagnosis ("pre-framed single-clip draft does not hydrate framingVideoUrl") was WRONG.**
  Real cause: a **dangling working_video ref** — DB reports `has_working_video=true` (row + `working_video_url`
  present, `working_video/playback-url` returns 200) but the `working_videos/{file}.mp4` R2 object returns
  **NoSuchKey/404**. `playback-url` signs the URL WITHOUT HEAD-verifying the object exists, so the frontend
  can't classify it as `VideoAssetMissing` (that path only triggers on a playback-url 404, i.e. DB ref gone);
  instead `extractVideoMetadataFromUrl` fails, `workingVideo` stays null, `shouldWaitForWorkingVideo` stays
  true (working_video_url is truthy) -> `effectiveOverlayVideoUrl` stays null -> **panel never mounts**, and
  the "Export required" message also never shows (single un-edited clip => `hasFramingEdits`/`hasMultipleClips`
  both false). A draft whose working-video R2 object is INTACT mounts fine (verified: proj 37/54).
- **Why the objects were missing = the 2026-07-27 staging wipe / `copy_user_between_envs` dropped `working_videos/`
  R2 objects while keeping the profile SQLite rows AND the `final_videos/` objects** (all 8 sampled published
  finals returned 200; only working videos 404'd — 3/5 pre-framed drafts: 31, 33, 51 missing; 37, 54 intact,
  37's being the freshest, post-wipe framing). This is a **staging-DATA (dangling-ref) artifact, not a
  mount-logic product defect and not a prod defect.**
- **Data-loss STOP shape (has_final_video-false-while-final-MP4-exists, T4010/T4020) is CONCLUSIVELY ABSENT
  here:** per-project job history shows NO overlay/final export ever ran for any `has_final_video=false` draft
  (32-39, 51, 52), so no orphan final MP4 can exist for them; the only recorded overlay job (proj 31) succeeded
  and its draft correctly reads `has_final_video=true`.
- **Robustness follow-up — DONE (T6130, 2026-07-27):** `working_video/playback-url` (`projects.py`)
  now verifies the R2 object exists (`file_exists_in_r2`, gated on `R2_ENABLED`) and returns a typed
  **404 "Working video asset missing"** on a dangling ref, plus a WARNING log. **Zero frontend change:**
  `OverlayScreen.attemptLoad` already maps a playback-url 404 -> `VideoAssetMissingError` -> the T5440
  "re-export to rebuild" terminal state (shipped T5642/T5440); T6130 just gives that existing path a
  reliable new trigger. **Why the frontend alone can't fix it:** the browser only meets the miss when it
  fetches the *cross-origin* R2 URL, and R2's 404 does not reliably carry CORS headers -> opaque
  `TypeError` -> the transient-retry branch -> generic "Video failed to load" + a Retry that can't
  succeed. CORS hides the status, so only the *backend* can read gone-vs-flaky; the API's own 404
  carries proper CORS/credentials.
  - **DECISION (invariant-vs-external, recorded so it isn't re-litigated):** a dangling working-video ref
    is an **EXTERNAL condition to degrade on, NOT an internal invariant to make LOUD.** R2 is external;
    **no in-env code path deletes `working_videos/*.mp4`** (the dangling refs are env-copy/wipe
    provenance), so the miss is not producible by our runtime logic. Verifying at the R2-object boundary
    and returning a typed "gone" is correct **external-failure classification** — the same shape as
    T4990 `SOURCE_UNAVAILABLE` — NOT the CLAUDE.md-banned "defensive fix for an internal bug": we surface
    the 404, we NEVER mutate the row to hide it (silently NULL-ing `working_video_id` would be the banned
    masking move). Log at **WARNING, not CRITICAL** — the state is routine on env-copied staging (3/5
    drafts), so CRITICAL would cry wolf; WARNING stays greppable if a ref ever dangles where no ops
    action explains it (which WOULD signal an upstream producer bug).
  - **Twin `clips.py:get_clip_playback_url` (`:1904`) — deliberately LEFT for a follow-up.** Same
    presign-without-verify shape, but points at `games/{blake3}.mp4` (GLOBAL namespace) where object loss
    is *legitimate reclaim* — already classified upstream as `SOURCE_UNAVAILABLE` (T4990) with recap
    re-export recovery (T4140). It is on the **Framing** open path, which has NO measured bad-degradation
    evidence like T6120's for Overlay, and the kickoff forbids adding a HEAD to a hot path without
    measuring it. Same treatment is plausible but needs its own measurement + task, not a silent copy.
  - **Latency:** the added check is ONE body-free HEAD via the `@lru_cache`-pooled `get_r2_client`
    (`max_pool_connections=25`, keepalive — NOT the T4773 fresh-TLS anti-pattern), once per
    working_video_id load, happy-path single round-trip. Against the ~2136ms overlay clicked->videoReady
    budget (T4773) that is a warm-pool ~1-3% (repo-measured pooled-R2 HEAD ~24ms, T5682) up to ~12% on a
    cold pool (~200-250ms, T4773). Live confirmation belongs on **staging** (real R2 + dangling fixtures
    31/33/51); the sandbox has no R2 endpoint and prod is off-limits. Tests:
    `test_t6130_dangling_working_video.py` (endpoint 404s on miss, 200 on present, right key, R2-off
    skips) + updated `test_stream_auth.py` healthy-path stub.
- **Spec change (T6120):** `derisk-staging-export.qa.spec.js` now (a) discovery prefers a draft whose
  working-video R2 object actually loads (`probeWorkingVideo`), and (b) on a mount failure probes the ACTUAL
  cause and SPLITS it: working video loads but panel still absent -> **FAIL** (real mount-logic regression);
  working video does not load (dangling ref / un-framed) -> **SKIP loudly** (staging fixture issue). More
  diagnostic AND less tolerant than the old blanket skip. `FIXTURE-CONTRACT.md` T5420 gap note corrected.

## Perf attribution (T4770, 2026-07-09)
- **`working_video/stream` is a same-origin Range pass-through proxy (NOT byte-windowed).** It forwards
  the client's Range to R2 and returns R2's status/Content-Range/Content-Length unchanged — working_videos
  are self-contained faststart MP4s (ftyp→moov→mdat, moov at front), so R2's own 206 is authoritative.
  Contrast `clips.py:stream_working_clip_bounded`, which DOES clamp bytes (clips are slices of GB games).
  Ranged playback = plain Range forwarding; there is no moov-window contract to preserve here.
- **T4773 DONE (pooled-httpx, KEEP; `projects.py:stream_working_video`).** Was: fresh `httpx.AsyncClient()`
  per request **twice** (a 1-byte size-probe round-trip to compute Content-Length ourselves, then the
  stream) → fresh R2 TLS every time (HAR `ssl=485–1193ms`/req). Fix (T4630 precedent, mirrors
  `downloads.py:stream_download`/`_get_r2_stream_client`, scoped to THIS endpoint only): module-level
  pooled client `_get_working_video_r2_client()` + drop the size probe (single R2 round-trip, pass R2's
  range headers through). Post-storm re-measure (2026-07-09, in-container): overlay `clicked→videoReady`
  **3474→2136ms (-39%)**; HAR main-stream first-byte **1037→408ms (-61%)** under the overlay-open burst;
  live isolated single-request TTFB only 245→224ms (a lone request has no pool to reuse — the win is under
  Chrome's concurrent Range burst). Lever 2 (302→presigned-R2) was NOT needed. `/health` flat (~2ms)
  throughout → not a contention artifact (ledger row 3's proxy-TTFB cost was real, distinct from the
  T4772 storm). Correctness verified live: 200/206/416/HEAD, byte-integrity (full == concatenated ranges).
- **T5642 (overlay working-video load path — cross-origin 401 fix).** The Overlay `<video>` no
  longer loads the working-video through the same-origin proxy `working_video/stream`. On staging/prod
  the frontend is cross-SITE to the API (pages.dev -> fly.dev) and `components/VideoPlayer.jsx`'s
  `<video>` has NO `crossOrigin` attribute, so its cross-site range request carried no session cookie
  -> auth middleware 401 -> Chrome `MEDIA_ELEMENT_ERROR` "Format error" (readyState 0). Fix mirrors
  Framing (`clips.py get_clip_playback_url`): new authed endpoint
  **`GET /api/projects/{id}/working_video/playback-url`** (`projects.py`, right after
  `stream_working_video`) returns `{url, expires_in}` where `url` is an ANONYMOUS presigned R2 URL
  (reuses `_generate_working_video_presigned_url`, key `working_videos/{filename}`, 1h). Middleware
  auth-gates it (NOT allowlisted -> 401 without a session; the whole point — an authed caller trades a
  session for an anonymous presign). `OverlayScreen.jsx` `attemptLoad` now `apiFetch`es that endpoint,
  then sets `<video src>` to the presigned R2 URL (metadata extraction + player both use it). The
  `working_video/stream` proxy stays for back-compat (Framing/warmer/legacy). LANDMINE: presigned-R2 is
  anonymous — do NOT put `crossOrigin="use-credentials"` on that `<video>` (R2 sends no
  `Access-Control-Allow-Credentials` for a specific origin -> breaks CORS). Tests: `test_stream_auth.py`
  (401 w/o auth, returns presign url w/ auth), real-browser `e2e/T5642-overlay-working-video-presigned.qa.spec.js`
  (presigned `<video>` loads cross-site 206/no-401/plays; credential-less proxy 401s).
- **`warmAllUserVideos()` (App.jsx:233,336) is a contention villain.** It streams `working_video/stream`
  for MANY projects at once through the Fly proxy on every home mount (Annotate/Overlay/My Reels opens
  all show the storm), inflating foreground TTFBs 0.5–1.5s. Fix = foreground-first + bounded concurrency
  (T4772); reuse `utils/cacheWarming.js` priority/abort machinery. The reel playback path
  (`GET /api/downloads/{id}/stream`, bounded proxy) is FAST (~615ms to playing, TTFB 441ms) — no issue.
- Editor post-video "settle" (`videoReady→settled` ~1.5s in framing AND overlay) is a **main-thread JS
  gap** (no request in flight) = crop/highlight/canvas hydration, not latency (T4774).

## Video-failure diagnostics (T6330, 2026-08-01)
- **Every video/poster-serving FAILURE logs ONE structured line** so "missing" vs "denied" vs
  "expired" is triaged from logs alone -- no manual R2 archaeology (read `blake3_hash`, probe R2
  across prefixes, re-request with a fresh session). Motivating incident: a game video 401'd on a
  cloned account; confirming the object was actually present took three manual steps because **the
  backend never recorded the key it resolved.**
- **Shared helper `storage.log_video_resolution(log, *, kind, outcome, key, entity_id, user_id,
  profile_id, blake3_hash, head_found, reason, bucket)`** (storage.py) formats + emits the line
  `[VIDEO_RESOLVE] kind=… outcome=… entity_id=… user_id=… profile_id=… blake3_hash=… bucket=…
  key=… head_found=… reason=…`. `outcome` is `VideoServeOutcome` (`redirect_302` | `missing` |
  `denied` | `expired`). **Level: DEBUG for `redirect_302` (success -- never INFO on a hot path),
  WARNING for the three failure outcomes.** `storage.video_outcome_for_status(status)` maps an
  upstream R2 status (401/403→denied, 410→expired, else→missing) for the proxy paths.
- **Log the KEY, NEVER the presigned URL** — it embeds short-lived credentials, worthless AND
  unsafe in a log. `log_video_resolution` redacts any credential-bearing value slipped into `key`
  (a scheme, `X-Amz-`, or `?` → `<redacted_url>`; a real R2 key contains none of these).
- **Env-prefix asymmetry is printed, not templated** (the whole point): game sources are
  env-prefix-FREE `games/{blake3}.mp4` (global namespace; `_game_video_r2_key`/`get_game_video_url`),
  while per-user media (reel/working videos, posters) is env-prefixed
  `{env}/users/{uid}/profiles/{pid}/…` via `r2_key`. Print the REAL key so a reader never guesses.
- **Failure-path HEAD is the classifier, and ONLY on failure** (T2880/T3380 keep presign off the
  hot path -- do NOT add a HEAD to a success path). Game/clip video: `games.log_game_video_failure`
  does one HEAD (`r2_head_object_global` global / `file_exists_in_r2` old per-user) → object present
  ⇒ `denied` (a session/serve problem, NOT absence); absent + `_is_game_storage_expired` ⇒
  `expired`; absent otherwise ⇒ `missing`. The R2-fetch proxies (download_file, stream_download,
  stream_working_video, poster proxies) already observe R2's status, so they classify via
  `video_outcome_for_status` with no extra HEAD.
- **Diagnostics ONLY — no new fallback behavior.** A missing object still fails loudly (404); we
  never substitute a placeholder and never mutate the row to hide the miss (CLAUDE.md § no silent
  fallbacks). Call sites: `games.py` (get_game_video 302 + DEBUG success line, get_game_playback_url,
  get_game_poster), `clips.py` (get_clip_playback_url), `downloads.py` (download_file,
  stream_download, _serve_reel_poster_jpeg), `projects.py` (stream_working_video,
  get_working_video_playback_url — the T6130 dangling-ref WARNING now rides this helper). Tests:
  `test_t6330_video_failure_diagnostics.py` (pins log OUTPUT per outcome, credential absence, and the
  success path's no-INFO/no-HEAD contract).

## Active/upcoming work
- **T5710 — per-layer recaps (2026-08-01):** the single combined recap is replaced by two
  independently-stitched, layer-filtered recaps. `_get_annotated_clips(conn, game_id, layer)`
  (`auto_export.py:138`) takes a layer predicate: athlete = `my_athlete = 1 OR my_athlete IS NULL`
  (NULL defaults to athlete), team = `my_athlete = 0` exactly (imported clips land on team —
  a team recap shows the whole team's plays regardless of annotator). `_generate_recap` produces
  per-layer outputs on DERIVED keys (no schema change): athlete keeps `recaps/{game_id}.mp4`
  (existing consumers/`resolve_clip_source` untouched), team is `recaps/{game_id}_team.mp4` +
  `recaps/{game_id}_team_clips.json` mapping. `ensure_recap(user_id, profile_id, game_id, layer)`
  (`auto_export.py:658`) is the idempotent, single-layer, synchronously-callable stitch helper —
  cheap on the hit path (HEAD + mapping-stamp check, no ffmpeg), safe to call repeatedly; it does
  NOT co-generate the sibling layer (only the auto-export sweep co-generates both). This is the
  entry point T5720's share-creation gesture calls (`ensure_recap(game_id, 'team')`) before
  minting a public link. `GET /api/games/{id}/recap-data?layer=athlete|team` (`games.py:1095`)
  resolves per layer: stitched recap -> game-video seek-through with a layer-filtered clip
  mapping -> explicit empty state (never a silent fallback to the other layer's content — an
  empty team layer must never render athlete clips under the Team Recap label, and vice versa).
  A pre-T5710 legacy combined recap (unrecoverable per-layer offsets) renders as its own
  `recap_legacy_combined` entry, honestly labelled, no per-clip rail, never under either layer
  label (both layer requests resolve to the SAME combined payload in that case). Frontend:
  `RecapPlayerModal.jsx` splits the old single "Annotations" tab into Team Recap / {Athlete}
  Recap tabs (sticky-within-session default: {Athlete}), each with its own `useRecapPlayback`
  instance keyed to that layer's clips; the Team Recap rail additionally has player-tag filter
  chips (epic decision 7) that filter the RENDERED rail list (`sidebarClips`) by
  `tagged_teammates` — this does NOT touch the underlying `useRecapPlayback` clip list or
  playback, so the currently-PLAYING clip's name still legitimately renders in the NotesOverlay
  video overlay + PlaybackControls transport label even when it's filtered out of the rail (by
  design: the stitched video autoplays through every clip regardless of the rail filter). The
  rail has `data-testid="recap-clip-rail"` specifically so tests can distinguish "is this clip in
  the filtered list" from "is this clip's name showing anywhere in the modal" — an e2e assertion
  that doesn't scope to the rail will flake once the video autoplays past the clip it just
  filtered out. Tests: `test_t5710_per_layer_recaps.py` (layer-filter SQL, empty-layer states,
  seek-through offsets, stitched/stale-mapping resolution, `ensure_recap` idempotency, query-count
  perf guard), `RecapPlayerModal.test.jsx`, `e2e/T5710-per-layer-recap.spec.js` (real-browser,
  see the seed-recap-game seam note above).
- **T4380** (TODO): unify the two competing job-create helpers (`exports.py:86` `'pending'` vs `export_helpers.py:37` `'processing'`).
- **DONE (2026-07-11 bug sweep):** T4200 (framing+multi-clip sync-then-announce), T4210 (overlay blob decode→500 not []; PUT /overlay-data deleted), T4230 (projects.py catch-all crop-NULL fixed; renameProject no longer writes stale aspect_ratio), T4240 (four recovery bugs fixed), T4280 (backend silent-fallback sweep).
- **Export Write-Path Unification epic** (`docs/plans/tasks/export-write-path/EPIC.md`, STRICT serial order): T4370 golden harness (DB-delta snapshots for all 6 triggers + local render goldens — gates everything after) → T4380 ExportJobRepository → T4390 finalize/publish single writers → T4400 backend-authoritative export (`mark-exported`; kills client-state authority) → T4410 pipelines→services + sweep unification. T4420 (interpolation) and T4430 (ffmpeg params/probe) also depend on T4370.
- ~~**T3950**~~ DONE 2026-07-12: playback-composited on shared/public viewers (no backend changes) + download-time burn-in in `GET /api/downloads/{id}/file` (`downloads.py`). See the Data-flow "Branded outro" bullet above.
- **T2650** (TODO): move sweep auto-export compute to Modal.
- DONE context (do not re-fix): T4010 atomic re-export, T4020 shadow-version guard, T4110 overlay sync-then-announce, T4160/T4170 sweep framed-reel preservation + metadata heal.

- **Drafts-lingering sweep bug (fixed 2026-07-04, then SUPERSEDED by T4175):** `_export_brilliant_clip`
  published a final_video but never archived the auto-project; v020 archived those rows. INVARIANT
  (still true for *manual* publish): every publish path must archive its project.
- **T4175 — sweep drafts instead of publishing (2026-07-05):** the sweep no longer publishes raw 16:9
  stream-copies as reels at all. It preserves the extract to `raw_clips/auto_*.mp4`, wires
  `raw_clips.filename`, and leaves the auto-project as a frameable draft (`archived_at` + `final_video_id`
  stay NULL; working_clip kept, rebuilt via `_insert_working_clip_with_dims` only if missing). An
  unframed clip must NEVER enter My Reels. The user frames it later; `resolve_clip_source` step 2 finds
  the extract once `games/{hash}.mp4` is reclaimed. "Needs-framing draft" is derivable state
  (`archived_at IS NULL` + working_clip exists + no published final_video) — NO marker column,
  `_SCHEMA_DDL` untouched. Remediation: **profile_db v021** reverses BOTH the publish and the v020
  archive for already-written `auto_%`/`brilliant_clip` published rows — copies `final_videos/{filename}`
  -> `raw_clips/{filename}` (before delete; copy-fail aborts that row), restores the draft (restore_project
  or rebuild), nulls `projects.final_video_id`, sweeps dangling `before_after_tracks`, deletes the reel
  row (dropping its seeded Glicko `rating`/`rd`/`match_count` — these are columns ON `final_videos`, there
  is NO separate match-history table). Idempotent, tuple-row-factory safe. Tests:
  `test_auto_export.py::TestExportBrilliantClip`, `test_resolve_clip_source.py`, `test_v021_migration.py`.

- **T4800 — clip-delete drops the dead draft, preserves the published reel (2026-07-06):** deleting a
  raw clip whose auto-reel had a `final_video` used to leave a 0-clip orphan draft in Reel Drafts
  (`_delete_auto_project` kept anything with `working_video_id OR final_video_id`). Now
  `_delete_auto_project` (clips.py:870) deletes the draft when it was the clip's LAST source — even if
  exported — but guards on `final_videos.published_at IS NOT NULL` to keep published reels (My Reels)
  intact (invariant #2 / T4010). It deletes the unpublished `final_videos` row first because
  `final_videos.project_id` has NO ON DELETE CASCADE (same reason `projects.delete_project` does).
  Root-cause fix ONLY — no read-time `clip_count == 0` filter and no client guard (they'd hide the
  bug; a visible 0-clip draft signals a missed producer). No cleanup migration (no evidence any real
  account has a pre-existing orphan). The tutorial-capture spec also deletes the auto-reel it creates
  (was leaking orphans onto the live imankh account). Tests: `test_t4800_orphan_drafts.py`.

- **T4140 — recap as full-quality re-edit source (2026-07-09):** the recap is now a re-edit master, not a
  480p review proxy. `auto_export._generate_recap` encodes each segment at its **NATIVE resolution**
  (dropped `.filter("scale",854,480)`) at master-grade quality (`RECAP_CRF=18`, `RECAP_PRESET="fast"`,
  module consts). Crop keyframes are stored in **source pixels** (default_crop.py `DEFAULT_CROP_SIZES` are
  pixel dims), so native-res keeps every single-source clip's framing valid for re-edit. `concat c=copy`
  needs a uniform resolution: single-source games already are; mixed-resolution multi-source games are
  normalized to a canonical resolution (`_pick_canonical_resolution` = most-common, tie->larger area),
  scaling **only** the minority segments (`scale`+`setsar=1`) — those clips' crop keyframes shift
  (documented, frozen-bounds only). Mapping shape unchanged. This FILLED `_resolve_recap_source` (see the
  Source-resolution bullet). **Backfill:** `backfill_hiq_recaps(limit, dry_run)` (admin-triggered
  `POST /api/admin/backfill-hiq-recaps?limit=&dry_run=`, `_require_admin`; NOT on startup) upgrades legacy
  recaps for games whose game video still exists; iterates users+profiles like the sweep
  (`get_all_users_for_admin` + `_get_profile_ids` + `ensure_database`), HEAD-probes every source hash
  (any half gone -> `skipped_gone`, past-grace stays 480p, never crashes), and is **idempotent via the
  854x480 legacy signature** (`_recap_is_legacy_480p` probes the recap; hi-q recaps aren't 854x480 so
  re-runs skip them) — no schema column, so no versioned migration. `limit` throttles re-encodes per call;
  `partial=True` means call again. **Accounting:** recap storage is **prepaid in the game upload cost**
  (T1582 flat +1 credit, no expiry, no per-byte recap charge, no prefix-sum) — hi-q recaps are materially
  larger but the model still counts them ONCE at upload with **no double-count** vs the game video; the
  flat prepay margin is a product/economy tuning call, not a code path. **Frozen bounds:** a recap-sourced
  draft returns `flexible=False` (reframe/re-crop OK, trim can't widen past annotated in/out); the frontend
  "widen the trim" guard is a follow-up (backend already returns `flexible`). Tests:
  `test_resolve_clip_source.py` (recap branch), `test_auto_export.py::TestGenerateRecap` (native res / mixed
  normalize) + `::TestBackfillHiqRecaps`, `test_t4140_recap_reexport.py` (Create-Clip draft re-exports from
  recap after game delete).
