# Release Functionality Map — since 2026-08-03 deploy

**Range:** `bce639d0` (last prod deploy, 2026-08-03) → `origin/master` (`55aa9ed6`, 2026-08-10).
447 files changed, 279 non-merge commits, 52 task IDs. Companion doc:
[staging-verification-2026-08-10.md](staging-verification-2026-08-10.md) (what to actually test).

This maps **functionality → code** (file + function/component) for everything that shipped in this
window, verified against current code (not just task-doc prose, which drifted in several places —
noted inline). Docs-only / task-filing / plan-status commits are excluded. Landing-site and two
independent crash fixes are included at the bottom.

---

## 1. Athlete Intro Card — data foundation & consent (T5180, T5190, T5195, T5230)

**What it is:** the storage layer, shared text-rendering engine, and compliance gates the whole
Athlete Intro Card feature is built on.

- `src/backend/app/schemas.py:301-395` — `TextSpec`, `FontKey` (4 faces: anton/oswald/graduate/playfair), `Align`, `Position`, `Shadow`, `Stroke`
- `src/backend/app/services/text_render.py` — `render_text_layer()`, `wrap_lines()`, `_resolve_shadow_opacity()`, LRU render cache
- `src/frontend/src/components/RichText.jsx` — `RichText()`, `wrapLines()`, `useSettledFontMetricsPx()` (browser mirror of the backend wrap/metrics)
- `src/backend/app/routers/profiles.py:383-525` — `upload_intro_image()`, `remove_intro_image()`, `record_intro_consent()`, `revoke_intro_consent()`, `update_intro_fact()` (`position`/`class`/`team`, later `full_name`)
- `src/backend/app/services/intro_media.py` — `store_intro_image()` (decode-verify, 1440px cap), `delete_intro_image()`, `validate_intro_key()`
- `src/backend/app/services/user_db.py:551-745` — KV accessors for consent/photo-key/facts (`user_settings` table, no schema migration)
- `src/frontend/src/components/ProfileIntroSection.jsx` — profile-edit UI (photo, consent checkbox, facts)
- `src/backend/app/migrations/profile_db/v034_intro_card_library.py` — creates `intro_cards` table + `final_videos.intro_card_id`
- `src/backend/app/routers/intro_cards.py` — `list_intro_cards()`, `create_intro_card()` (consent-gated, 403 without `intro_consent_at`), `update_intro_card()` (surgical PATCH), `delete_intro_card()`
- `src/backend/app/services/intro_cards.py` — `derive_composition(has_photo, shown_fields)` (title-only/hero/broadcast/recruiting — always derived, never stored)
- `src/frontend/src/stores/introCardStore.js`, `src/frontend/src/utils/introCardComposition.js` — frontend mirror
- `src/backend/app/routers/privacy.py` — `_read_intro_cards()` + export wiring for CCPA data export; account-delete purge reuses the existing whole-user R2-prefix delete (covers `intro/`)
- `docs/legal/privacy-policy.md`, `src/frontend/src/components/PrivacyPolicy.jsx` — draft copy (unsigned-off)

**Superseded/dead by later tasks (see §3):** `is_default` (T6680 removed default/inherit), `title_text`
(T6620/T6570 — title always = profile Full Name), `text_elements` (T6640 — typography now template-owned).

---

## 2. Athlete Intro Card — editor UI & render engine (T5205, T5210, T6540, T6570, T6580, T6600, T6620, T6650)

- `src/frontend/src/components/introcards/IntroCardsModal.jsx` — grid↔editor screen, portals to `document.body`
- `src/frontend/src/components/introcards/IntroCardEditorContainer.jsx` — MVC container (draft state, `updateCard`/`patchCardLocal`)
- `src/frontend/src/components/introcards/IntroCardStage.jsx` — live preview, drag-to-reframe, `STAGE_MAX_W/H` constants
- `src/frontend/src/components/introcards/IntroCardRail.jsx` — rail: Content / Subtitle / Photo / Style tiers (`PhotoControls()`, `SubtitleInput()`) — **no per-slot text styling** (removed by T6640, see §3)
- `src/backend/app/services/player_intro.py` — `build_intro_card()`, `_build_card()`, `_select_elements()`, `_get_or_build_card()` (content-hash cache, `_CARD_VERSION` bump discipline), `_render_band()`/`_render_tint()`/`_render_vignette()`/`_render_seam_fade()` (per-treatment band/photo grade)
- `src/backend/app/services/intro_card_geometry.py` — Python source of truth: `layout()`, `geometry_for()`, `treatment_for()`, `TREATMENTS_CONTRACT`, `render_js_mirror()`
- `src/frontend/src/utils/introCardGeometry.js` — **generated** JS mirror (do not hand-edit; parity-tested)
- `src/frontend/src/components/introcards/introCardEditorConstants.js` — `FACT_SLOTS` canonical order (fixes the click-order layout bug), `SLOT_META.title.label = 'Athlete Name'` (T6620 rename, key `title` unchanged)
- `src/frontend/src/constants/zLayers.js` — the `Z` scale (`DROPDOWN(40) < MODAL(50) < OVERLAY_BACKDROP(60) < PLAYER(70) < MODAL_ELEVATED(80) < ALERT(90) < TOAST(100)`) fixing the modal-under-tiles z-order bug; ~30 components migrated onto it
- `src/backend/app/services/intro_cards.py:197-238` — `intro_image_has_other_reference()` (shared-photo-key ownership check, card delete / profile photo replace both call it)
- `src/backend/app/routers/profiles.py:356-380` — `_intro_key_referenced_by_a_card()` (mirror check on profile-photo side)
- Full Name / Subtitle: `user_settings.intro_full_name.{profile_id}` (no migration) + `intro_cards.subtitle_text` (**v035 migration**)
- Shadow-blur fix: `RichText.jsx:333` `resolveShadowOpacity()`, `text_render.py` `DEFAULT_SHADOW_OPACITY=0.6` — shared with Overlay text (§5)
- Migrations: **v035** (subtitle), **v036** (NULLs dead `title_text`)

---

## 3. Athlete Intro Card — typography rewrite: "cards cannot be made ugly" (T6640)

**What it is:** the biggest single change to the card system — measured/anchored layout replacing
fixed-fraction slots, and **removal of all user-facing text styling from the card editor**
(font/colour/size/align/weight/shadow/stroke are now template-owned). 4 rounds, last fix 2026-08-10.

- `src/backend/app/services/intro_card_geometry.py` — `layout()` (:528, measured/anchored stacking), `_fit_title()`, `_count_lines()`, `_reflow()`/`_typography()` (per-composition×aspect anchor/role tables), `ROLE_FOR_SLOT`
- `src/backend/app/services/player_intro.py:255-305` — `_select_elements()` rebuilt on `layout()`; **no longer reads `intro_cards.text_elements`**
- `src/frontend/src/components/introcards/introCardPreviewElements.js` — `layout()` JS mirror + `lines[]` passthrough (round 3 fix), `useCardPreviewElements()` (font/resize-settle hook, `STABLE_FRAMES_REQUIRED=6`)
- `src/frontend/src/components/RichText.jsx:365-402` — round-4 fix: `wrapperStyle.width` is a fixed px value (not CSS `max-width`, which shrink-to-fit collapsed for center-anchored text), `whiteSpace:'pre'`
- `src/frontend/src/components/introcards/IntroCardRail.jsx` / `IntroCardEditorContainer.jsx` / `IntroCardStage.jsx` — **entire per-slot styling editor removed**: no `TextSpecEditor` import, no `selectedSlot`/`specForSlot`, no per-slot click-to-select on the stage
- Migrations: **v038** (NULLs dead `text_elements`), **v040** (backfills a default card — now inert, see §6)

---

## 4. Athlete Intro Card — discoverability & naming (T6660, T6670, T6680, T6690)

- `src/frontend/src/components/introcards/introCardDefaults.js` — `nextCardName()` (regex `^Athlete Intro Card (\d+)$`), naming sweep (T6660)
- `src/frontend/src/components/introcards/IntroCardCarousel.jsx` — `CreateCardTile()` "New card" affordance (T6670)
- `src/frontend/src/components/introcards/IntroCardPicker.jsx` — `doCreate()`/`startCreate()`/`finishCreate()`, inline create-then-return-to-picker flow, consent-gated (T6670)
- Attach writes: `src/frontend/src/hooks/useDownloads.js:387` `setIntroCard()` (`PATCH /downloads/{id}/intro`) and `DownloadsPanel.jsx:233` `handleSetCollectionIntro()` (`PATCH /api/collections/intro`) — **two different write paths depending on entry point**, not one
- `src/backend/app/services/intro_cards.py:173-187` — `resolve_intro_card_id()` **simplified**: `NULL`/`0` both → no intro, no more `default_id` param (T6680 — see §6 for the design reversal)
- `get_default_intro_card()` — **removed entirely**; no `/default` endpoint exists on `intro_cards.py`
- `src/frontend/src/components/ManageProfilesModal.jsx:282-286` — `handleSwitchAndManageCards()` (T6690: chains `switchProfile()` + opens the card library for a non-active profile)

---

## 5. Overlay text layer — core mechanics (T5225, T6480, T6510, T6560, T6590, T6610, T6720)

**Screen:** OverlayScreen.jsx / `src/frontend/src/modes/overlay/`.

- `src/backend/app/routers/export/overlay.py:1110/1148/2520` — `_decode_text_layers()`, `_blend_text_layers()`, `_rasterize_text_layers()` (local render loop)
- `src/backend/app/modal_functions/video_processing.py:189/228` — verbatim-duplicated blend loop for Modal (parity-tested against the local one)
- `src/frontend/src/utils/textSnapping.js` — `snapToBoundary()` (clip-boundary snap for region levers)
- `src/frontend/src/components/RichText.jsx` — font URLs now resolved via `config.resolveApiUrl` (fixed a staging/prod bug where bare `/api/fonts/...` hit the SPA and silently served HTML)
- `src/frontend/src/components/overlay/TextManagementPanel.jsx` — current host of the shared `TextSpecEditor` (dark tabbed panel; T6480's contrast fix lives here post-T6630 rebuild)
- `src/frontend/src/components/PosterFramePreview.jsx` — grabs a real frame from a hidden `<video preload=metadata>` for the thumbnail (T6510, replaces upload)
- `src/backend/app/services/poster.py` — `get_project_poster_marker_time()` (READ, column-guarded) / `set_project_poster_marker_time()` (**WRITE — NOT column-guarded, T6550 never shipped**, see checklist doc)
- `src/backend/app/routers/export/overlay.py:2298-2321` — `PosterTimeRequest` (time required, 422 on null/non-finite), `set_poster_time()` (T6560)
- `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.jsx` — `DRAG_THRESHOLD_PX=4` click-vs-drag; final placement top-of-track, `z-40`, never clipped/occluded (T6560 + T6590)
- `src/frontend/src/components/overlay/ThumbnailPanel.jsx` — replaces the old "Use current frame" button (T6590 — deleted; marker-drag is the only control)
- `src/frontend/src/screens/OverlayScreen.jsx:1034` `wrappedMoveTextBody()`, `src/frontend/src/modes/overlay/hooks/useTextOverlays.js:203` `moveRegionBlock()` — body-drag moves a text region's start+end together (T6610)
- `src/frontend/src/screens/OverlayScreen.jsx:1062` `wrappedMoveTextPosition()`, `src/frontend/src/modes/overlay/overlays/TextOverlayPreview.jsx:40-94` `clampAnchorToFrame()`, canvas click-to-select — spatial drag writes `spec.position` (T6720)

---

## 6. Overlay text layer — regions/elements rewrite (T6630)

**What it is:** the biggest change to the Overlay screen — a text **region** (timeline span) can now
hold N simultaneous **elements**, replacing the old one-element-per-timespan model. 50 commits, 9 QA
rounds.

- `src/frontend/src/modes/overlay/hooks/useTextOverlays.js` — `addRegion()`(:104), `addElement()`(:152, appends into an existing region), `moveRegionStart/End/Block()`, `updateElementSpec()`/`toggleElement()` (element-level), `deleteElement()`(:238, cascades region delete if last element), `deleteRegion()`(:263)
- `src/backend/app/routers/export/overlay.py` — `add_text` (region-or-element by presence of `region_id`), `move_text_edge`, `update_text_spec`/`toggle_text` (element via `_find_text_element`), `delete_text_region` (new), `_flatten_text_regions` (single flatten point into the unchanged burn-in path)
- `src/frontend/src/components/timeline/TextLayer.jsx` — one block per **region**; `handleTrackClick()`(:265) is now the only way to create a region (click empty lane); `regionLabel()` shows `+N` for multi-element regions
- `src/frontend/src/components/overlay/TextManagementPanel.jsx` — region tree (expand/collapse, scoped to playhead), per-region "+ Add text", per-element Eye/Trash + full `TextSpecEditor`
- `src/frontend/src/modes/OverlayModeView.jsx` — filters to `activeTextRegionsAtPlayhead`
- `src/frontend/src/modes/overlay/overlays/TextOverlayPreview.jsx` — flattens all elements of every active region and renders them together (the actual visual fix)
- Migration: **`v042_text_overlays_regions.py`** — renumbered from a collided v039; reshapes the existing `text_overlays` BLOB in place, no column change, best-effort per row

---

## 7. Athlete Intro Card — attachment & egress (T5215, T5220)

**What it is:** wires a resolved card into every place a video *leaves* the app.

- `src/backend/app/services/intro_cards.py:173-292` — `resolve_intro_card_id()`, `resolve_intro_card()` (the one resolution helper every consumer shares)
- `src/backend/app/routers/downloads.py` — `PATCH /{download_id}/intro` `set_download_intro()`; `GET /api/downloads` batches resolution (no N+1)
- `src/backend/app/routers/collections.py:611/901/1101` — `CollectionDefinition.intro_card_id`, `_evaluated_share_members()`, share-creation freeze
- `src/backend/app/routers/export/overlay.py` — `_finalize_overlay_export()`/`export_final()` carry `intro_card_id` forward on re-export
- `src/backend/app/services/intro_egress.py` — `resolve_intro_for_reel()` (shared cross-DB resolver, burn vs. playback mode), `build_intro_playback_payload()`
- `src/backend/app/services/serve_time_video.py` — `compose_serve_time()` (single ffmpeg concat pass: `[intro?][reel][outro?]`)
- `src/backend/app/routers/downloads.py:664` `download_file()` — owner download, both R2 and local-file branches compose in one pass
- `src/backend/app/routers/shares.py:229/814/856` — `_resolve_share_video_intro()`, `get_shared_video()` (returns `intro`), **`GET /{share_token}/download`** (new, composes and streams)
- `src/frontend/src/components/introcards/IntroPreRoll.jsx`, `SharedVideoOverlay.jsx`, `SharedCollectionView.jsx` — pre-roll mounts
- `src/frontend/functions/shared/[token].js:76` `renderIntroCard()` — edge-page hand-rolled DOM intro (no React); **its footer `<a class="dl">` download link at :239 still points at the raw `video_url`, bypassing intro/outro — a real untouched gap, not covered by the new composed endpoint**
- `src/frontend/src/components/introcards/IntroExposureNotice.jsx` — public-exposure notice (picker + ShareModal)
- `src/frontend/src/components/MediaPlayer.jsx` — auto-resume-after-intro fix
- `src/frontend/src/hooks/useWebShare.js`, `DownloadsPanel.jsx:547` `webShareReel()` — desktop-vs-mobile Share routing fix
- Migration: **v041** (`user_settings.intro_min_duration_seconds` — now dead code for resolution post-T6680, inert settings plumbing only)

**Design reversal to know about:** T5215 shipped `NULL → inherit profile default (duration-gated)` /
`0 → explicit no intro` as two distinct states. **T6680 (§4) deleted the inherit path** —
`resolve_intro_card_id()` now maps both `NULL` and `0` to "no intro." The duration gate is dead code.

---

## 8. Athlete Intro Card — owner in-app playback as a timeline segment (T6700 → T6710)

T6700's swap-based approach (unmount/mount) is **fully superseded** by T6710 — document T6710 as
current reality.

- `src/frontend/src/components/introcards/IntroStoryPlayer.jsx` — composite container, `region` state (`'intro'|'reels'`)
- `src/frontend/src/components/introcards/useIntroPlayback.js` — `useIntroPlayback()` intro-only rAF clock
- `src/frontend/src/components/introcards/CompositeScrubber.jsx` — shared weighted segmented bar (`flexGrow: durationSec` proportional widths)
- `src/frontend/src/components/introcards/MotionPreview.jsx` — now `currentTimeMs`-driven/seekable (old `setTimeout` animation deleted)
- `src/frontend/src/components/collections/CollectionPlayer.jsx` — additive-only props (`renderScrubber`, `onProgress`, `initialSeekFraction`, `landingToken`); internal bar now renders via `CompositeScrubber`
- `src/frontend/src/components/collections/useStoryPlayback.js` — confirmed **byte-identical** to base ref
- `src/frontend/src/components/DownloadsPanel.jsx:783` — mounts `<IntroStoryPlayer>`
- `src/frontend/src/components/SharedCollectionView.jsx` — untouched by T6710 directly; picks up proportional segment widths as a side effect of `CollectionPlayer`'s shared-bar change

---

## 9. Tile Video Preview (T6420, T6441)

- `src/frontend/src/hooks/useTilePreview.js` — `useTilePreview()` (warm ~100ms / reveal ~450ms, single-active registry, `prefers-reduced-motion` off-switch, `useIsCoarsePointer()` gate — touch untouched)
- `src/frontend/src/components/collections/TilePreviewVideo.jsx` — `TilePreviewVideo()` (poster-first crossfade)
- `src/frontend/src/components/DraftTile.jsx:330-345` — `previewStreamUrl`, falls back to `working_video/stream` for "In Overlay" drafts (T6441)
- `src/frontend/src/components/collections/ReelTile.jsx:103-108,199-202,277` — wiring + `preview.stop()` before opening the full player
- `src/backend/app/routers/projects.py:1074` — `stream_working_video()` (reused unmodified)

**Not shipped in this window (still TODO):** T6430 (touch in-viewport autoplay), T6440 (autoplay setting/data-saver) — no commits in range.

---

## 10. Migration & sync durability (T6345, T6350, T6410)

- `src/backend/app/migrations/base.py` — `MigrationRunner.get_applied_versions()` (new, full applied-SET query), `get_pending()` (postgres now set-membership, not `> MAX`) — **T6345**
- `src/backend/app/middleware/db_sync.py` — `set_durable_sync_failure_response()` — **T6350**
- `src/backend/app/routers/downloads.py` — `move_reels_to_profile()` (now takes `request`, honest 503 body), `_delete_moved_source_rows()`, new **`POST /api/downloads/move-to-profile/finish`** `finish_move_reels_to_profile()` (idempotent retry) — **T6350**
- `src/frontend/src/hooks/useMoveReels.js` — `finishMove()`, "Finish removing" sticky toast — **T6350**
- `src/backend/app/migrations/__init__.py:217-330` — `_migrate_profile_db()` new branch: skip the R2 swap when `local_baseline >= downloaded_sync_version` — **T6410**

---

## 11. Crash fixes (T6450, T6451, T6452)

- `src/backend/app/routers/export/multi_clip.py:2123` — `db_clips = [dict(row) for row in cursor.fetchall()]` (was raw `sqlite3.Row`, crashed on `.get()`) — **T6450**
- `src/backend/app/services/local_processors.py:51` — `MockVideoUpscaler.process_video_with_upscale()` gains `rotation: float = 0` — **T6451** (dev/CI-only path, not production)
- T6452 — ruff lint-debt cleanup in the same two files, no behavior change.

**ID collision to flag:** a *different*, still-open task also uses the ID T6450
(`docs/plans/tasks/T6450-build-lockstep-guard-reads-stale-artifact.md`, status TODO, no code shipped).
The T6450 commits in this window are exclusively the sqlite3.Row fix.

---

## 12. Independent small fixes (no shared epic)

- `src/frontend/src/components/ProfileSportButton.jsx` — header intro-photo avatar (`showPhoto`/`failedPhotoUrl`), hides on a broken R2 object instead of showing a broken-image icon
- `src/frontend/src/components/collections/ReelTile.jsx:224` — Play button re-centered on My Reels tiles
- `src/landing/src/site.ts`, `src/landing/scripts/generate-og-card.mjs`, `src/landing/public/og-card.jpg` — rebuilt social link-preview card + "Player's" → "Athlete's" tagline copy
- `src/landing/src/components/BeforeAfterSlider.tsx` — fixed the After-video freeze during mobile slider drag (seek-collision + iOS decoder-suspend watchdog)
