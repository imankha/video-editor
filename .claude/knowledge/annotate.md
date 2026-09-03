---
domain: annotate
updated: 2026-09-03 (T8500 Add Game goes video-first: `GameDetailsModal.jsx` create-mode
reorders to cost line -> dropzone -> collapsed `<details data-testid="game-details-disclosure">`
("Game details (optional...)") holding opponent/date/type/format -> submit. Submit now gates on
`hasVideo` alone (was all-four-fields + file); opponent/date/type/format all default (opponent
empty -> "Unnamed opponent" placeholder client-side, date -> `localTodayISO()`, type -> Home,
format -> Full Game) so a game can be created with two gestures (pick file, submit). The
opponent input's `autoFocus` (see the T7590 landmine below) was REMOVED entirely in this
reorder - it now lives inside the collapsed disclosure and is never auto-focused, so that
specific iOS-keyboard-shrinks-viewport case no longer applies to create mode. Edit mode
(`EditGameModal.jsx`) is untouched. `CreditBalance.jsx` gained an in-memory-only
(no localStorage, no backend) first-run "You start with N free credits" caption, shown via
`showFirstRunHint` when `games.length === 0`, dismissed forever-per-session on first click
anywhere. Form height dropped sharply (four fields collapsed to one summary line), which is
relevant to the T7590 short-viewport landmine below - T8550 owns re-verifying/adapting that
regression pattern for the new, much shorter layout.)
updated: 2026-09-03 (T8590 fixes desktop non-fullscreen "Edit Play" opening the CREATE form:
`ClipsSidePanel.jsx`'s inline `AnnotateFullscreenOverlay` render was missing `existingClip`
-- the fullscreen render (`AnnotateModeView.jsx:604-621`) already passed it, but the
non-fullscreen sidebar render did not, so `isEditMode` (`!!existingClip`,
`AnnotateFullscreenOverlay.jsx:117`) was always false on that path: heading/defaults/Save
all behaved as CREATE, producing a duplicate clip instead of updating the selected one, and
misarming the T8140 `add_clip_opened_no_save` beacon on every edit-open. Fixed by passing
`existingClip={selectedRegion || null}` (`ClipsSidePanel.jsx` already computed `selectedRegion
= clipRegions.find(r => r.id === selectedRegionId)` for `ClipDetailsEditor` a few lines above
-- same derivation `AnnotateModeView`'s own `existingClip` memo uses). **Invariant going
forward: every `AnnotateFullscreenOverlay` render site (fullscreen desktop, fullscreen mobile,
mobile inline sheet, non-fullscreen sidebar) must pass `existingClip` whenever the overlay can
open in EDIT mode** -- a new render site that omits it silently falls back to CREATE mode with
no error, exactly like this bug. Verified live via dev-verify (dev stack + TSV-imported clips):
pre-fix Save POSTed a 4th `raw_clip` alongside 3 existing ones; post-fix it PUTs the selected
clip's id. Regression coverage: `ClipsSidePanel.editMode.test.jsx` (unit, mocks the overlay to
assert the prop) and the new T8590 block in `e2e/clip-selection-state-machine.spec.js` (proven
to fail on the pre-fix code). See Landmines "Add Play CTA must gate on isEditMode (T8130)" below
-- this is the sibling bug on the same surface, caught by the T8600 ux-designer review.)
updated: 2026-09-02 (T8360 split single-clip vs multi-clip drafts: the Home "Reel Drafts"
tab is renamed "Clips" (`SECTION_NAMES.CLIPS`, still tab id `projects` / URL `/home/reels`)
and now shows ONLY single-clip auto-drafts, routed by `is_auto_created` (NOT `clip_count`).
The "Build Highlight Reel" assembly button and the multi-clip drafts it produces (`is_auto_created
=== false`) moved OFF this tab entirely onto the Highlight Reels surface (`DownloadsPanel.jsx`)
as a new "Highlights (in-progress)" section above the published list. This SUPERSEDES the
T8130 entry below, which said the rename/relocation was deliberately deferred pending this
task — T8360 is now that task, and it shipped both. Design: `docs/plans/tasks/T8360-design.md`.
Also: renaming a project no longer clears `raw_clips.auto_project_id`/`is_auto_created`
(`projects.py update_project`, `projectsStore.js renameProject`) — the old clear was dead
code (superseded by commit `73291399`) that was silently breaking T4800 cleanup for renamed
auto-drafts; see the design doc Sec 0.)
updated: 2026-09-02 (T8130 Annotate primary CTA: `AnnotateModeView.jsx`'s new full-width
"Add Play" button (`data-testid="annotate-primary-cta"`) calls the SAME `onAddClip` handler
as the transport-bar button (`AnnotateControls.jsx`), so it MUST mirror that button's
`isEditMode` gating or it silently misroutes - `onAddClip` (`handleAddClipFromButton`,
AnnotateContainer.jsx) edits the selected clip when `selectionState.type === 'SELECTED'`,
not create one. Flips label/icon/color (`Add Play`/`Plus`/green -> `Edit Play`/`Pencil`
/yellow) exactly like `AnnotateControls` does, with DELIBERATELY DIFFERENT title text
("Add a play ending at the current time" / "Edit the selected play", no "(A)" suffix) so
its `button[title=...]` locator never collides with the transport-bar button's own title
in Playwright strict mode (both buttons render simultaneously in non-fullscreen,
non-edit-mode - a real regression caught by post-hoc review, not by CI, since the
CTA-hierarchy unit tests mock every sibling surface). Reel Drafts tab intentionally NOT
renamed by this (T8130) task (would misrepresent its mixed single/multi-clip content - see
T8360) nor was the assembly button relocated off it by T8130 (no valid destination surface
pre-T8360). **T8360 has since shipped the rename + relocation** (see the entry above) -
this note describes T8130-era state, not current state.
"Highlight Reels"/"Build Highlight Reel" renames elsewhere are UI-string-only, zero
identifier/event-name changes (see Landmines "Add Play CTA must gate on isEditMode
(T8130)")
updated: 2026-08-31 (T8180 ghost annotate session: the T7470 only_if_empty cleanup was necessary but
NOT sufficient — an annotate-during-upload session has committed nothing yet, so a failed upload's
only_if_empty DELETE deleted the game UNDER the live session (bug 47p: 26 min annotating a deleted game,
Ready → finish-annotation 404 silently). Both uploadManager catch blocks now skip the DELETE when the
editor is still bound to the game (isUserAnnotatingGame via editorStore.activeAnnotateGameId — a session
-binding check, NOT the banned content pre-check); and three loud-404 paths reverse prior silent swallows
(finishAnnotation returns {notFound}, save_raw_clip 404s instead of writing an orphan raw_clip,
continue-card refreshes on load-404) — see Landmines "Upload-failure cleanup is ONLY-IF-EMPTY" T8180
addendum + "Ghost annotate session must be impossible to miss (T8180)")
updated: 2026-08-29 (T8030 reverses T6400's inherit-last-layer new-clip default: a new clip now
always defaults to My Athlete regardless of the previous clip's layer -- reported live-testing
staging as "Add Clip defaults to Team" and confirmed the old inherited behavior was working exactly
as T6400 designed, so this is a product reversal; `resolveInheritedNewClipLayer` deleted from
`useAnnotate.js` -- see Invariants "New-clip layer always defaults to My Athlete (T8030)")
updated: 2026-08-28 (T7930 "annotation_completed" is watched-video, not a clip: relabeled "Annotation Done" -> "Watched Annotate Video" on every admin surface (analytics.FLOW_EVENTS + FunnelChart/UserTable/PlatformBreakdown); event KEY + daily_col unchanged (stored history); the "credit survives content deletion" half is the quests.py LIFETIME-achievement mechanism, a SEPARATE finding from T7870's delete bug — see Landmines "annotation_completed fires on watched video, not clips (T7930)")
updated: 2026-08-25 (T7590 mobile "Add your first game" dead-end ROOT-CAUSED + fixed: GameDetailsModal panel was fixed-centered with NO max-height/scroll, so on short iPhone viewports (reports 320x498, 352x541) the submit + close controls clipped off-screen unreachable — added max-h-[90vh] overflow-y-auto; see Landmines "GameDetailsModal short-viewport dead-end (T7590)")
updated: 2026-08-25 (T7470 upload-failure cleanup is only-if-empty: DELETE /api/games/{id}?only_if_empty=true refuses to cascade-delete a game with raw_clips or viewed_duration>0; protects annotate-during-upload — see Landmines "Upload-failure cleanup is ONLY-IF-EMPTY (T7470)")
updated: 2026-08-24 (T7480 upload lifecycle: PART_SIZE 25MB->5MB, stall watchdog replaces flat per-part timeout, completed-parts honest progress, resume part-size guard, UploadId orphan-abort + double-UploadId root cause, failure beacon + [UPLOAD_LIFECYCLE] logs + admin stuck-uploads — see Landmines "Upload lifecycle invariants (T7480)")
updated: 2026-08-21 (T4340 segments_data is write-time-canonical now, migration v045 -- reader cleanup still a known gap, see Invariants; T5695 adding a sport now has a CROSS-REPO landing-site mirror — see "Adding a sport" below; T5700 team/my-athlete layer + two-lane timeline follow-up; T5710 per-layer recap tabs)
---
# Annotate — Domain Knowledge

## Scope
The Annotate screen (game video → clip regions → raw_clips), game loading/resume, multi-video
virtual timeline, clip metadata editing, the recap viewer's annotate features (T4130), and backend
clip/segment persistence in `clips.py`/`games.py`.

## Entry points
- **Screen**: `src/frontend/src/screens/AnnotateScreen.jsx` — single source of truth for annotate
  state; instantiates `AnnotateContainer(...)` as a plain function call (L187), not JSX.
  Owns `useVideo` (single-video ref) + `useZoom`.
- **Container**: `src/frontend/src/containers/AnnotateContainer.jsx` — multi-video state,
  `handleLoadGame` (L564-700), `applyGameData` (L467-558), clip write handlers.
- **Early video src**: `src/frontend/src/containers/annotateVideoLoad.js` —
  `buildEarlyGameVideoSrc` (`/api/games/{id}/video` + `#t=` fragment, L26-32); `beginGameVideoLoad`
  sets src synchronously BEFORE awaiting `/load`, deduped per gameId (L58-71);
  `computeResumePosition` (playhead, else viewed-duration high-water if <95%, L90-105).
- **State hooks**: `src/frontend/src/modes/annotate/hooks/useAnnotateState.js` (video
  url/metadata/gameId; seeds early src from `peekPendingGame()` at L34-37); `useAnnotate.js`
  (clipRegions model); `useVirtualTimeline.js` (two builders, see Data flow).
- **UI**: `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` (clip list, sorted by
  videoSequence then startTime); `ClipDetailsEditor.jsx` (per-field gesture persistence);
  `NotesOverlay.jsx` (in-video text overlay: name + rating notation + notes; T4070 game-clock
  badge). Recap viewer: `src/frontend/src/components/RecapPlayerModal.jsx`.
- **Store**: `src/frontend/src/stores/gamesDataStore.js` — `getGame`/`loadGame` (inflight-deduped),
  `finishAnnotation`, `saveLastPlayhead` (keepalive), `readyGames`/`pendingGameIds`/`gamesVersion`
  triple-write (L31-59, audit D6).
- **Backend**: `src/backend/app/routers/clips.py` (prefix `/api/clips`) and
  `src/backend/app/routers/games.py` (`GET /{game_id}/load` at L2178, duration PATCH at L1409).

## Data flow
```
open game → pendingGame breadcrumb → useAnnotateState seeds early /video src (T4000)
  → AnnotateScreen effect consumes breadcrumb → handleLoadGame(gameId, seekTime)
  → beginGameVideoLoad (src now) ∥ GET /api/games/{id}/load
      → {game, playback_url, teammate_tags, teammate_shares}
  → applyGameData: gameVideos from gameData.videos, playhead resume, sharedTagData
  → importAnnotations → clipRegions (each carries rawClipId)
```
- **`/load` carries `game.storage_status`** (`'active'|'expired'`, bug 27p): computed by
  `games.py:_compute_storage_status(expires_at_val, auto_export_status, has_hash)` — the single
  source of truth shared with `list_games` (game_storage expiry passed, OR no ref but
  `auto_export_status` set = source deleted post-grace). `applyGameData` maps it to
  `annotateSourceExpired`. **T8320 default-direction invariant (do NOT reintroduce the
  'active'-by-default bug):** when there is NO `game_storage` row (falsy `expires_at_val`) and
  no `auto_export_status`, the result depends on `has_hash` — a HASH-BACKED game
  (`has_hash=True`) reports `'expired'` because `delete_ref` DELETES the row at reclaim
  (auth_db.py), so "no row + has hash" means the global `games/{hash}.mp4` source was
  reclaimed/is unknown (the SAFE direction, matching T4280's unparseable→expired). Only a
  genuinely storage-less LEGACY game (`video_filename`-only, no blake3 hash → `has_hash=False`)
  stays `'active'`. Both call sites MUST pass `bool(blake3_hash)` and stay in lockstep
  (`list_games` ~L1135, `load_game` ~L2947). The pre-T8320 trailing `return 'active'` presented
  a reclaimed source as fine unless auto-export happened to be set (bug 50p). References (T5800)
  never reach this — the caller sets their `storage_status=None`. (`v023`'s local mirror
  `_compute_status` is deliberately pinned to the pre-T8320 semantics — a migration must not
  drift with later logic; do not "fix" it.)
- **Reel Drafts surface source expiry too (T8320).** `DraftTile` renders a source-expiry chip
  matching GameTile's (yellow Clock chip, `<14d` countdown / "Source expired"), driven by a
  PURE render-time join `utils/draftSourceExpiry.js:deriveDraftSourceExpiry(project, gamesById)`
  that `ProjectManager` computes from the games list it already holds (a `gamesById` Map memo)
  and passes down as the `sourceExpiry` prop through `DraftStageRows`/`DraftPhaseAspectRows`.
  Read-only: NO store write, NO useEffect, NO persisted field (no-redundant-state). Any source
  game `storage_status==='expired'` → expired chip; else min days-left `<14` → countdown; an
  absent/deleted game row is skipped (no chip, no crash — data-always-ready); a reference-only
  draft yields no chip.
- **Account-level expiry banner (T8330).** `ProjectManager` mounts a dismissible
  `StorageExpiryBanner` on the home screen when ≥1 Reel Draft depends on a source game that is
  at risk. Same file/primitives as T8320 (no forked expiry path): `draftSourceExpiry.js`
  `computeStorageExpiryRisk(projects, gamesById)` aggregates `isGameStorageAtRisk` across drafts,
  returning `{ atRiskGameCount, dependentDraftCount }` — O(total game references), a pure
  render-time join (no fetch/endpoint/persisted state). `isGameStorageAtRisk` is the single
  predicate: active game `<EXPIRY_WARNING_DAYS` days OR EXPIRED-but-`can_extend` (grace, still
  rescuable); a permanently-deleted game (`expired`+`!can_extend`) is EXCLUDED so the "Extend
  storage" CTA is never dead. A bare expiring game NO draft depends on never triggers it.
  Threshold is the shared `EXPIRY_WARNING_DAYS` (14) in `ExpirationBadge.jsx` — the chip's old
  literal `14`, now one constant for both. Dismissal is SESSION-ONLY React state in
  `ProjectManager` (no persisted "seen" marker, no reactive persistence); the banner deep-links
  to the Games tab (`setActiveTab('games')`). Banner-only by product decision — no email digest.
- **One annotation = one `raw_clips` row** (per-user SQLite, not Postgres). Region shape:
  `{id, rawClipId, startTime, endTime, name, tags, notes(≤280), rating(1-5, default 4),
  videoSequence, tagged_teammates, my_athlete, autoProjectId}` (useAnnotate.js:10-30, constants
  L209-213). Natural key everywhere: `(game_id, end_time, video_sequence)`.
- **Gesture persistence** (ClipDetailsEditor → `updateClipRegionWithSync`, AnnotateContainer:832-948):
  - create → `POST /api/clips/raw/save` (`save_raw_clip`, clips.py:911) — idempotent on the natural
    key; new rows have empty `filename` until extraction. **T7010: `raw_clips.game_id` is
    WRITE-ONCE here** — inserted from the frontend-supplied `RawClipCreate.game_id` (`clips.py:1124`),
    and the natural-key lookup is game-scoped (`WHERE game_id = ?`, `clips.py:1039-1045`) so a save
    can never update another game's row. `update_raw_clip` reads `game_id` but NONE of its
    `UPDATE raw_clips` statements writes it — a clip's game attribution is frozen at capture and no
    503/retry/DB-heal path can change it (the sync-failed Retry closure re-sends the *captured*
    `gameId`, `useRawClipSave.js:149`). Diagnostics (T7010): the frontend stamps its active game as
    `X-Client-Game-Id` on every clip save/update/delete; backend logs `[ClipSave] POST/PUT` with
    `client_active_game` next to the stored game and WARNs `GAME MISMATCH` on divergence. **T4175**: for a game clip that reaches
    the expiry sweep unframed, `_export_brilliant_clip` now fills `raw_clips.filename` with the
    preserved per-clip extract (`raw_clips/auto_{game}_{clip}_{hex}.mp4`) — the clip's surviving
    independent source once `games/{hash}.mp4` is reclaimed. So a non-empty `filename` on a game
    clip means "post-expiry preserved extract," read by `resolve_clip_source`.
  - update → `PUT /api/clips/raw/{id}` (clips.py:1052).
  - delete → `DELETE /api/clips/raw/{id}` (clips.py:1184) — cascades to working_clips via FK,
    deletes R2 `raw_clips/{filename}`. **T4800**: also calls `_delete_auto_project` (clips.py:870)
    which now DELETES the clip's auto-reel draft when this was its LAST source clip — even an
    exported one (unpublished working_video/final_video) — because the draft's source is gone and
    it can no longer be edited. It PRESERVES a PUBLISHED reel (`final_videos.published_at` set) and
    a multi-clip project (clip_count>1). Deletes `final_videos` first (no ON DELETE CASCADE on
    `final_videos.project_id`), mirroring `projects.delete_project`.
  - Scrub drags persist on drag-end only. "Create Reel" sends `create_project: true` on the same
    save/update.
- **Multi-video**: `buildFullVideoTimeline(gameVideos)` (useVirtualTimeline.js:136-217)
  concatenates per-half videos into one virtual timeline (`getVideoOffset`, `clampToVideo`);
  `buildVirtualTimeline(clips)` (L12-116) is the separate clip-playback stitcher. Single-video ⇒
  `gameVideos = null`.
- **boundaries_version** is the annotate↔framing invalidation signal on `raw_clips`: bumped by
  `save_raw_clip` on start_time change (clips.py:958-975) and `update_raw_clip` on duration change
  (L1158-1161); `update_working_clip` snapshots it into `working_clips.raw_clip_version`
  (L2059-2062) so framing can detect stale boundaries.
- **reel_source_start_time/reel_source_end_time (T8070)** is a SECOND, independent staleness
  mechanism on `raw_clips` — a **value snapshot**, not a counter. `boundaries_version` can only
  detect "changed since"; it can never express "changed back," so it can't satisfy T8070's
  requirement that reverting to the EXACT producing values restores validity. `reel_source_*`
  instead stores the literal `start_time`/`end_time` the clip's reel was last produced from,
  written ONLY by: seed at `_create_auto_project_for_clip` (clips.py), and export-completion
  refreshes in `export_framing`/framing.py, `upsert_working_video`/export_finalize.py (multi-clip),
  and both Overlay finalize paths (`_finalize_overlay_export` + inline `export_final`,
  overlay.py) — see `.claude/knowledge/keyframes-framing.md` for the Overlay write sites.
  `update_raw_clip`'s boundary-edit path (clips.py:1420-1464) NEVER writes these columns (INV-1);
  the comparison is a pure `===` value equality, computed on read in `ClipDetailsEditor.jsx`
  (`reelReflectsClip`), display-only — no gesture in the editor writes `reel_source_*`. Backfilled
  for pre-T8070 produced reels by migration v049 (profile_db) via the `working_clips.raw_clip_id`
  join, not the narrower `auto_project_id`-only form (reaches multi-clip/user-created reels too).
  Per-clip (not project-level): surfaced via `WorkingClipResponse` (`GET /projects/{id}/clips`,
  every clip of a reel) and via the annotate load region (`GET /games/{id}/load`, seed clip only —
  `ClipDetailsEditor` gates its Reel control on `region.autoProjectId`, so added/non-seed clips of
  a multi-clip reel have no staleness display surface today; that visual cue is an unimplemented
  follow-up, see the T8070 design doc § 7 Q5). The two mechanisms serve different purposes and are
  NOT meant to converge — `boundaries_version` stays framing's own invalidation signal.
- Playhead: `POST /{game_id}/playhead` (direct overwrite) on tab-hide/pagehide with `keepalive`
  (AnnotateContainer:1206-1222); `POST /{game_id}/finish-annotation` sets
  `viewed_duration = MAX(...)` high-water.

## Invariants & rules
- **segments_data is write-time-canonical as of T4340** (working_clips.segments_data, msgpack).
  The on-disk `boundaries` format is now **always full-list** `[0, ...splits, duration]` for
  every NEW write, from BOTH paths: the gesture path (`POST /actions` -> `split_segment` etc.)
  and the full-state PUT (`saveCurrentClipState`). Mechanism (clips.py): `_get_clip_framing_data`
  (clips.py:282) LEFT JOINs `raw_clips` for a live `source_duration`
  (`raw_clips.end_time - start_time` — NOT a stored column, deliberately, to avoid a second
  canonical home for duration) and strips the decoded blob to **splits-only** via
  `to_splits_only` (`highlight_transform.py`, next to `canonicalize_segments_data`) before
  handlers run, so `split_segment`/`remove_segment_split`'s index math (incl. the T4220
  `segmentSpeeds` reindex) stays untouched. `_save_clip_framing_data` (clips.py:333) then calls
  `canonicalize_segments_data` (`highlight_transform.py:86-130`; detects format by
  `boundaries[0] <= 0.01`) immediately before encode, so what lands on disk is always full-list.
  PUT (`update_working_clip`, clips.py:2326) was already canonical and is unchanged.
  `segmentSpeeds` is keyed by interval index over the FULL list — walking splits-only pairs
  shifts every speed by one (Bug 20p: slow-mo/realtime swapped), which is why the write-time fix
  matters.
  **Migration v045** (`migrations/profile_db/v045_canonicalize_working_clip_segments.py`)
  rewrites pre-T4340 rows the same way (JOIN raw_clips, reuse `canonicalize_segments_data`,
  idempotent, skips+logs orphan rows with no derivable duration rather than guessing) — applies
  automatically at the per-user JIT seam on next access (T5083/T5085, hardened by T8190; T5087
  deleted the old manual `POST /api/admin/migrate` trigger this used to need).
  **Reader cleanup is NOT done — this is a KNOWN GAP, not finished work.** Every reader still
  defensively calls `canonicalize_segments_data` (export/framing.py:456,
  export/multi_clip.py:1925/2092, services/poster.py) and the **non-canonicalizing latent
  reader `export/overlay.py:1928-1939`** (uses `boundaries[-1]` as duration — wrong for a
  not-yet-migrated splits-only row) is UNCHANGED. Do not remove any reader's canonicalize call,
  and do not assume overlay.py is fixed, until a FOLLOW-UP task removes them after the migration
  has run on every env (deploy-before-migrate window: write code ships before the admin-triggered
  migration runs, so old-format rows coexist with new-format ones for a while on purpose).
- **Persistence is gesture-based.** Every ClipDetailsEditor field change is an immediate surgical
  save from its handler. The bulk path `PUT /{game_id}/annotations` → `save_annotations_to_db`
  (games.py:1599-1699) still exists but its frontend caller (`gamesDataStore.saveAnnotations`,
  L295-319) has ZERO callers — orphaned pair slated for deletion (T4270).
- **Selection state machine**: `useClipSelection()` is the single source of truth for selection +
  overlay (AnnotateContainer:188-201); `useAnnotate` delegates selection out via `onSelect`.
- **`shared_annotation_flow` sessionStorage flag lifecycle (T5330b).** `SharedAnnotationView`
  (the `/shared/teammate/{token}` landing) SETS it on mount; `QuestPanel.jsx:165,173` READS it to
  `return null` (suppresses the onboarding NUF while on the shared view — sessionStorage, not
  component state, so it survives the share→login page reload). It has exactly ONE clearer:
  `App.jsx` clears it in a `useEffect` guarded on `isAuthenticated && !teammateShareToken` — i.e.
  once the recipient is in their OWN authenticated app and off the shared route. Keying on "left
  the shared view" (NOT merely "authenticated") is required: an existing user actively viewing a
  shared annotation must keep the suppression. Without the clear, a signed-up share recipient never
  saw the NUF for the whole tab session (T5330 fixed the backend quest counts but not this frontend
  gate). Proven in a real browser (jsdom insufficient): e2e/T5330b-*.spec.js.
- **Auto-reel draft dies with its last source clip (T4800).** Deleting a raw clip deletes its
  auto-created reel draft when no other source clip remains (unless the reel is PUBLISHED). This is
  the ONLY orphan producer, so it's fixed at the root — there is deliberately NO read-time
  `clip_count == 0` filter in the feed and NO client guard (they would hide the bug; a 0-clip draft
  appearing in Reel Drafts is a visible signal that a producer was missed). Root cause of the old
  orphan: `_delete_auto_project` used to KEEP any project with `working_video_id OR final_video_id`,
  so an exported auto-reel survived clip-delete with 0 clips.
- **Clip-level deletes do NOT archive.** `DELETE /raw/{id}` and `remove_clip_from_project`
  hard-delete rows. R2 archiving is project-level only:
  `src/backend/app/services/project_archive.py:archive_project` serializes project + ALL
  working_clips versions to msgpack on R2, then deletes rows (L47-122); `restore_project`
  re-inserts (L244-251). R2 archives are therefore the only place deleted working_clips state
  survives.
- **Recap clips ARE raw_clips** (T4130): `RecapPlayerModal.jsx` — "a recap clip's id IS its
  raw_clip id" (L133-136); `handleCreateRecapClip` (L145-160) is a gesture-driven
  `updateClip(clipId, {create_project: true})` → `PUT /clips/raw/{id}`, optimistically flips
  `in_drafts`; button disabled while `in_drafts` is true. Clips have NO independent source video,
  so re-materializing clips from an expired game was deferred.
- **T5710 — per-layer recap tabs + player-tag filter is a RAIL-ONLY filter, never a
  playback filter.** `RecapPlayerModal.jsx` splits the old single recap tab into Team Recap /
  {Athlete} Recap (see [export-pipeline.md](export-pipeline.md) § Active/upcoming work T5710 for
  the backend layer split). Each layer gets its OWN `useRecapPlayback(videoRef, clips)` instance
  over that layer's UNFILTERED clip list — this is the thing that drives autoplay, the active-clip
  overlay (`NotesOverlay`), the transport bar's current-segment label, and `handleCreateRecapClip`'s
  target (via `activeRecapClip = activeLayerData.clips.find(c => c.id === activePlayback.activeClipId)`).
  The Team Recap's player-tag filter chips only narrow `sidebarClips` — the list handed to
  `RecapClipsSidebar` for rendering — they do NOT touch `useRecapPlayback`'s clip list. Consequence:
  a clip filtered OUT of the rail can still legitimately show its name in the video overlay and
  transport label if it's the one currently playing (the stitched video autoplays straight through
  every clip regardless of the rail filter). The rail div carries
  `data-testid="recap-clip-rail"` specifically so tests can assert "is this clip in the filtered
  list" without false-failing on "is this clip's name showing anywhere in the modal". An assertion
  scoped to the whole modal will flake once autoplay drifts past the clip it just filtered out —
  this bit the original T5710 e2e spec (see export-pipeline.md's seed-recap-game seam note for the
  fix: 8s-per-clip seed duration + rail-scoped locators).
- **Expired-game Annotate playback = graceful degradation (bug 27p).** When
  `annotateSourceExpired` (from `/load`'s `game.storage_status === 'expired'`), `AnnotateModeView`
  renders a deliberate yellow "Source video expired" panel in the video area INSTEAD of any
  `<video>` (guards the single-video `VideoPlayer` AND the multi-video branch), so no
  broken/hanging player mounts against the hard-deleted R2 source. The **"Playback Annotations"**
  button is also disabled when expired (its `enterPlaybackMode` is the only entry to the separate
  `isPlaybackMode` return tree, which mounts dual `<video>` A/B against the same dead source — the
  video-area guard alone does NOT cover it). The clips sidebar (`ClipsSidePanel`) is unaffected —
  annotations stay readable. State lives in `useAnnotateState` (`annotateSourceExpired`), set from
  `storage_status` in `applyGameData` and cleared at the start of `handleLoadGame` (so an
  expired->healthy switch doesn't flash the panel); reset in `resetAnnotateState`.
  Re-materialization stays deferred (T4130). The recap viewer has separate expired handling
  (`RecapPlayerModal` `recapVideoMissing`).
- **Reel-editor expired source = the SAME truth, told at the clip seams (T8310, bug 50p).**
  Annotate learns expiry from `/load`'s `game.storage_status`; the Focus/Overlay reel editors have
  no such field, so before T8310 a reclaimed game source presigned fine, the `<video>` got an R2
  404, and `useVideo` burned the T5620 format-error retry loop then showed **"Video format not
  supported."** Two defenses now:
  1. **Backend gate (parity with `load_game`).** `games.py` exposes
     `resolve_game_source_status(cursor, blake3_hash, auto_export_status) -> (status, can_extend)`
     (REUSES `_compute_storage_status`; `can_extend` mirrors `list_games`: a `game_storage` ref
     survives OR the hash is in `get_grace_deletion_hashes()`) and
     `assert_clip_source_available(...)` which raises `GameSourceExpired` → **HTTP 410
     `{"code": "source_expired", "game_id", "can_extend"}`**. Wired into the ONLY two clip
     seams that presign the game source: `clips.py:get_clip_playback_url` and
     `stream_working_clip_bounded` (both before their `get_game_video_url` call), plus the Focus
     export entry `exports.py:start_framing_export` (refuses up front instead of failing mid-Modal).
     NOT gated (deliberately, not gaps): the `/file` redirect serves working-clip files
     (`get_working_clip_url`), not the game source; `list_working_clips`' per-clip preview
     `game_video_url` is never set as a `<video>` src (actual playback always flows through the
     gated `playback-url`).
  2. **Frontend.** `FocusScreen.getClipVideoConfig` reads the 410 and returns
     `{sourceExpired:true, canExtend}` (does NOT fall back to `/stream`); `VideoPlayer` renders
     `SourceExpiredPanel` (mirrors Annotate's yellow Clock language; Extend button navigates via
     `editorStore.goToProjectManager()` + `/home/games`, since this app has NO react-router) when
     `isSourceExpired`, so no `<video>` mounts against a dead URL. Universal net:
     `videoErrorClassifier` adds `VIDEO_UNAVAILABLE` for a probe-confirmed **404 or 410**, and
     `useVideo.handleError` (now async) probes a code-4 non-blob URL BEFORE classifying, routing a
     gone source to that kind — which **skips the format-error retry loop** and shows an honest
     message. **Overlay scope caveat:** Overlay plays the independent `working_video`
     (projects.py), immune to game-source reclaim, so it never hits the 410 panel; a reclaimed
     working_video is caught only by the `VIDEO_UNAVAILABLE` net (honest message, no retry, no
     Extend affordance) — the acceptance criterion's "expired state in Overlay" is satisfied by
     that net, not the full panel. No endpoint-level 410 integration test yet (unit-covered;
     deferred to staging).
- **Resume position**: `computeResumePosition` prefers `last_playhead_position`, falls back to
  viewed-duration high-water when viewed/duration < 0.95 (annotateVideoLoad.js:90-105).
- **Team / My Athlete layer (T5700).** `raw_clips.my_athlete` (existing bit, no schema change) is
  now a visible two-value layer: `1`/`NULL` → My Athlete, `0` → Team. Legacy-NULL rule
  `region.my_athlete ?? true` must be applied at every read site (`LayerSegmentedControl`,
  `ClipListItem`'s `LayerChip` — **marks ONLY the Team layer** (amber `Users` icon, no visible
  text); My Athlete is the unmarked default, so an unmarked row MEANS My Athlete (follow-up UX
  decision: marking both was noise on nearly every row). **T6400: the chip has NO `title` (the
  "Team" hover rollover was removed — color/icon alone signal the layer on hover, user decision);
  its `aria-label="Team layer"` is RETAINED** so the layer keeps an accessible name and isn't
  conveyed by color alone (WCAG 1.4.1). Consequence for tests/e2e: the row marker is no longer
  selectable by `title` — use `[data-testid="clip-row"] [aria-label="Team layer"]` (scoping to the
  row excludes the per-clip `LayerSegmentedControl` radio, which shares that accessible name).
  **The same rule now applies to the TIMELINE marker** (`ClipRegionLayer`): T6400 removed the
  ` · My Athlete` / ` · Team` suffix from its hover tooltip and replaced it with a 3px colored
  LEFT ACCENT BAR (cyan `#06b6d4` = My Athlete, amber `#f59e0b` = Team — the same two colors as
  the marker underline and the lane headers, so all three agree). The layer survives as the
  marker's `aria-label` (`"{clip name} - {layer} layer"`). Do NOT delete
  `layerColorFor`/`LAYER_COLORS` — they are the only remaining VISIBLE layer cue.
  **That tooltip is PORTALLED to `document.body`** (`position: fixed`, `z-index: 2147483000`,
  `data-testid="clip-marker-tooltip"`): as a child of the lane it was out-stacked by the lane's own
  label column, and raising its z-index could never fix that — a z-index cannot escape an
  ancestor's stacking context. One tooltip is rendered for the ACTIVE marker (hover wins over
  selection), positioned from that marker's `getBoundingClientRect()`.
  There is no My-Athlete marker to count — count
  `data-testid="clip-row"` rows minus Team markers instead —
  `ClipRegionLayer`'s `layerColorFor`/`layerLabelFor`,
  `ClipsSidePanel`'s filter) — never read `region.my_athlete` bare. Shared component
  `LayerSegmentedControl.jsx` (`value`/`onChange` boolean, `disabled`/`disabledReason`) is now
  reused by TWO per-clip call sites: `ClipDetailsEditor` (desktop + mobile per-clip switch, replaced
  the old on/off toggle) and `AnnotateFullscreenOverlay` (mobile add/edit + the desktop inline
  add-clip form, seeded from the inherited new-clip layer on create, from the clip on edit).
  Imported clips (`shared_by` NOT NULL) render the control **disabled or locked to Team, read-only**
  — a recipient cannot re-tag someone else's shared clip onto their own My Athlete layer (that layer
  feeds reels/rankings/collections, T5330 provenance). The clip-list filter (`layerFilter`) is
  ephemeral, screen-owned state in `useAnnotateState.js` — reset **imperatively** to `'all'` in
  `AnnotateContainer.handleLoadGame` (the game-open gesture), never via a state-watching effect, and
  never persisted (no store write, no API call). Timeline marker tint (`ClipRegionLayer.jsx`) is
  a secondary cue (colored border/underline), not a replacement for the rating-hue primary signal.
- **New-clip layer always defaults to My Athlete (T8030, 2026-08-29 — REVERSES T6400's
  inherit-last-layer default below).** T6400's "inherited, not toggled" design made a Team clip
  "stick" as the default for every subsequent Add Clip in that game until manually switched back —
  reported as a bug live-testing staging ("Add Clip defaults to My Team"), and confirmed working
  exactly as T6400 designed it, so the fix is a product reversal, not a bug fix in the mechanism.
  `resolveInheritedNewClipLayer` (the game-open/last-assigned resolver) is DELETED — `useAnnotate.js`
  no longer exports it. `newClipLayerIsMine` (still the ephemeral, screen-owned boolean in
  `useAnnotateState.js`, never persisted) is now reset to `true` unconditionally on every game-open
  gesture (`AnnotateContainer.handleLoadGame`) and is NEVER updated by layer-assignment gestures
  (creating a clip, switching a clip's layer) — those gestures still write `my_athlete` on the CLIP
  itself via the normal surgical path, they just no longer feed back into the next clip's default.
  T6400's original point still stands and is UNCHANGED: the "New clips go to:" mode-toggle control
  in the `ClipsSidePanel` header stays removed (it cost sidebar space for little value) — there is
  still no control, just a fixed default now instead of an inherited one.
- **Teammate tagging is Team-layer only (T5725).** Teammates <-> Team is now a hard invariant: the
  Teammates control (`ClipDetailsEditor.jsx`, `AnnotateFullscreenOverlay.jsx`) renders ONLY when the
  clip is on the Team layer (`(my_athlete ?? true) === false`), replacing the old `!isMobile` gate --
  so teammate tagging is available on Team clips for BOTH desktop and mobile, and there is NO
  teammate-tagging affordance on any My Athlete clip. **Clear-on-switch:** switching a clip TO My
  Athlete clears its teammate tags in the SAME gesture (ClipDetailsEditor sends the surgical
  `{my_athlete:true, tagged_teammates:[]}`; the overlay clears local `taggedTeammates`, persisted on
  Save) -- chosen over leave-and-hide because it cannot leave an invisible contradictory state and the
  clearing is VISIBLE (the Teammates block + chips disappear as the control hides). Switching TO Team
  still sends ONLY `{my_athlete:false}`. This resolves the contradiction that `_filter_clips_for_tag`
  (materialization.py:253) joins `clip_teammates` with NO layer predicate, so a teammate tag on a My
  Athlete clip used to leak that clip into another family's per-player share. The share path is
  DELIBERATELY left unfiltered -- no `AND my_athlete = 0` was added (CLAUDE.md "correct data, not
  workarounds"); the UI keeps new data correct and the migration heals old data. **profile_db v031**
  (`v031_reclassify_teammate_clips_to_team.py` — numbered v031 not v030 to avoid colliding with the
  sibling T5800 branch's v030, which merges ahead) MOVES every teammate-tagged My-Athlete/NULL clip to
  Team (`my_athlete = 0`), PRESERVING tags (reclassify, not strip) -- decides "has teammates" by
  decoding the msgpack `tagged_teammates` blob in Python (an empty list encodes to a NON-NULL blob, so
  it can't be tested in SQL) OR a `clip_teammates` join row; idempotent; logs the count; positional
  row reads (tuple row factory). **Accepted consequence:** moved clips leave the My Athlete layer, so
  they leave reels/rankings/collections eligibility (`queries.py:exclude_teammate_reels_clause` keeps
  those on `my_athlete = 1`); already-published reels are unaffected. Applies automatically at the
  per-user JIT seam on next access (T5083/T5085, hardened by T8190; T5087 deleted the old manual
  `POST /api/admin/migrate` trigger this used to need). Covered by `ClipDetailsEditor.teammates.test.jsx`,
  `AnnotateFullscreenOverlay.teammates.test.jsx`, `test_t5725_reclassify_teammate_clips.py`, and
  `e2e/T5725-teammates-team-only.qa.spec.js`.
- **Save auto-commits a pending teammate tag; it must never dead-end (T7540).** The teammate
  `<input>` commits on Enter/comma; `TeammateTagInput.jsx` tracks the typed-but-not-committed text
  in a module-level `_uncommittedText` (set by an effect on `inputValue`, cleared on unmount).
  `AnnotateFullscreenOverlay.handleSave` used to see uncommitted text (`hasUncommittedTeammateText()`)
  and show an OK-only "Tag not submitted" `ConfirmationDialog` that returned WITHOUT saving — clicking
  Save again re-triggered it: a genuine dead-end. Now `handleSave` calls
  `commitPendingTeammateText(taggedTeammates)` (only on the Team layer — teammates are Team-only),
  which applies `addTeammate`'s dedupe rules, RETURNS the resulting array (used synchronously as
  `finalTeammates` for the save payload — a setState wouldn't apply within the same call), and clears
  `_uncommittedText`. Invariant: **after Save, any typed teammate text is either committed as a tag or
  dropped as empty; Save always proceeds.** `hasUncommittedTeammateText` is still exported and used by
  `AnnotateContainer.jsx` (lines ~1056/1069/1106) but ONLY to warn on NAVIGATION gestures (timeline
  seek / select-region / auto-select) — those are dismissible warnings, not save dead-ends. Covered by
  `TeammateTagInput.test.jsx`, `AnnotateFullscreenOverlay.teammates.test.jsx`, and
  `e2e/T7540-annotate-save-tag-trap.qa.spec.js`.
- **Two clip lanes on desktop, one on phone (T5700 follow-up).** `AnnotateTimeline.jsx` splits the
  single tinted "Clips" track into two stacked, labeled `ClipRegionLayer` lanes — "My Athlete" (cyan)
  and "Team" (amber) — each fed a pre-filtered `regions` subset using the same legacy-NULL rule
  (`my_athlete !== false` → mine, `my_athlete === false` → team). An empty lane still renders (label +
  a lane-specific empty message via `ClipRegionLayer`'s new `emptyMessage` prop) rather than
  disappearing — an empty Team lane is meaningful signal. Gated on **`useIsMobile()`** (width<1024 OR
  coarse pointer), deliberately NOT the `sm` (640px) breakpoint the sidebar uses: `sm` would
  misclassify a landscape phone (>=640px wide, the T4933 landmine below) as desktop and hand it the
  taller 3-row timeline in an already height-starved viewport; `useIsMobile`'s width clause (<1024)
  keeps a landscape phone single-lane regardless of orientation. `totalLayerHeight` switches
  '6.75rem' (mobile, video + 1 track) / '9.75rem' (desktop, video + 2 lanes). Both lane labels'
  `onClick` still select the ONE `'clips'` keyboard-nav layer (arrow-key nav in
  `useKeyboardShortcuts.js` walks the full unfiltered `clipRegions` array regardless of which lane a
  clip renders in) — there is no per-lane selection state. `region.index` is left as-is when
  filtering into per-lane arrays (it reflects position in the full chronological list, not
  position-within-lane). Covered by `AnnotateTimeline.twoLane.test.jsx` (unit) and
  `e2e/T5700-two-lanes.qa.spec.js` (real-browser QA, including the T4933 landscape case).

## "No Sport" sentinel (T7850) — new profiles default here, not to soccer
New profiles are created with `sport = 'no_sport'` (never chosen), NOT the old
`'soccer'` default. Backend write sites: `session_init.py` (`inherited_sport or
"no_sport"`), `user_db.py` (`_USER_DB_SCHEMA` `DEFAULT 'no_sport'` + `create_profile`
default param), `routers/profiles.py` (`request.sport or "no_sport"`). No migration:
existing `'soccer'` rows are left as-is (indistinguishable in the DB from a deliberate
soccer pick), and the column is `NOT NULL` so there is no `sport IS NULL` cohort.
- `NO_SPORT`/`NO_SPORT_LABEL` are exported from `tagRegistry.js`. The sentinel is
  deliberately **NOT in `SUPPORTED_SPORTS`** (that list = sports with a tag set);
  `getTagSet('no_sport')` returns `null` like any unknown sport. `sportDisplayName`/
  `sportStoredValue`/`sportEmoji` special-case it (glyph `❔`, distinct from the custom
  medal `🏅`); `sportEmojiOrNull` is intentionally untouched (posters stay app-logo).
- Add Clip UI is a **three-way branch** (not `{tagSet && …}`): known tag set → `TagSelector`;
  `sport === NO_SPORT` → `<NoSportTagWarning>` (amber prompt, `compact` variant in the
  fullscreen scrub bar); custom/"Other" sport → silent (deliberate choice, no registry).
  Four call sites: `UploadClipModal`, `ClipDetailsEditor`, `AnnotateFullscreenOverlay` (×2).
  The read fallback is now `currentProfile?.sport || NO_SPORT` (was `|| 'soccer'`).
- **T7922 — the FULL `<NoSportTagWarning>` variant is ACTIONABLE, not instructional.**
  T7850's "instructional-only, names the top-bar path" was a dead end on mobile: the named
  control (`ProfileSportButton`) is mounted only on the ProjectManager home header, NOT on the
  annotate surface, so a first-clip `no_sport` user was told to tap an off-screen icon. The full
  variant now renders an inline `<InlineSportSelect sport={NO_SPORT} onChange=…>` (extracted from
  `ManageProfilesModal` to `components/shared/InlineSportSelect.jsx`) under the prompt "Pick your
  sport to tag this clip". Picking a sport calls `updateProfile(currentProfileId, {sport})`; the
  open form re-renders IN PLACE via `useCurrentProfile()` (no remount — in-progress range/rating/
  name survive) and `getTagSet(newSport)` swaps the `TagSelector` in. The three full call sites
  (`UploadClipModal`, `ClipDetailsEditor`, `AnnotateFullscreenOverlay` portrait) pass
  `onChange={handleSetSport}` (a `.catch(()=>{})` fire-and-forget — the store logs+rolls back on
  failure, and the visible tag revert IS the feedback). **The `compact` landscape scrub-bar
  variant is DEFERRED (fast-follow): it is UNCHANGED, still the non-interactive prose "Set your
  sport (top bar) for tags".** `InlineSportSelect` renders its "Other…" option ONLY when
  `onPickOther` is passed — `ManageProfilesModal` still passes it; the T7922 picker does NOT (a
  custom sport yields no tags anyway, and its edit modal at `Z.MODAL` z-50 can't render over the
  `z-[100]` fullscreen overlay). `updateProfile` (profileStore) is now OPTIMISTIC: it patches the
  local profile before the PUT and rolls back to the pre-gesture snapshot on failure (mirrors
  `setIntroFact`), then reconciles via `fetchProfiles({force:true})`. Covered by
  `NoSportTagWarning.test.jsx`, `profileStore.updateProfile.test.js`, updated
  `UploadClipModal.noSport.test.jsx`, and live-drive `e2e/T7922-mobile-inline-sport-picker.qa.spec.js`
  (320+375, picker→tags swap + rating-survives-remount + Save round-trip).
- `ManageProfilesModal` offers "No Sport" as an explicit option in BOTH the row
  `InlineSportSelect` and the `ProfileForm` dropdown (distinct from the "Other" free-text branch).
- Known gap (out of scope): `collections.py` `CURATED_COMBOS.get(sport or DEFAULT_SPORT, …)`
  still falls a `no_sport` profile back to soccer curated combos — not a crash, flagged only.

## Adding a sport (T5695) — the tag registry is NOT the only place
A sport = a tag-set file + registry wiring + a backend curated combo, but since
T5695 it ALSO has a **cross-repo mirror in `src/landing/` that self-contradicts if
skipped** (the landing site is Astro and generates a crawlable `/{slug}` page per
sport — the task file's old "optional `src/landing/src/App.tsx`" note is STALE).
The full checklist for an 11th→Nth sport:
- **Editor**: new `src/frontend/src/modes/annotate/constants/{sport}Tags.js` (mirror
  `baseballTags.js`) + 4 edits in `tagRegistry.js` (import, `TAG_SETS`,
  `SUPPORTED_SPORTS`, `SPORT_EMOJI`). The registry is the SOURCE OF TRUTH.
- **Backend**: a `CURATED_COMBOS[sport]` entry in `routers/collections.py` — tag names
  **case-sensitive, must match the registry EXACTLY** (a cross-language guard,
  `tagRegistry.test.js` `CURATED_COMBO_TAGS`, asserts every curated tag exists in the
  registry AND that `Object.keys(CURATED_COMBO_TAGS) === SUPPORTED_SPORTS ids`).
  `test_collections_summary.py::test_each_sport_curated_and_per_tag` is parametrized over
  `CURATED_COMBOS.keys()`, so it auto-covers the new sport.
- **Landing MIRROR** (`src/landing/`, all four or the site lies): (1) a `{sport}` key in
  `src/data/sportTags.json` mirroring the editor's positions+plays (copy names/descriptions
  verbatim); (2) a `Sport` entry in `src/data/sports.ts` (hand-written SEO copy — title ≤60,
  description ≤155); (3) `FACTS` counts in `src/site.ts` — `sportCount`, `positionCount`,
  `playTypeCount` are advertised as VERIFIED counts, so they must move with the data (verify
  arithmetically: `node -e` sum over `sportTags.json` — T5695 confirmed 11/46/136); (4) the
  hardcoded prose sport list AND the hardcoded "N sports" number in
  `src/pages/index.astro` (a FAQ answer enumerates every sport next to `${FACTS.sportCount}`,
  and the PageLayout `description=` had a literal `10 sports`). Grep `src/landing/` for other
  hardcoded enumerations; the `sports.astro` lists are dynamic (`SPORTS.map`) or "and more",
  so they self-update. Verify with `cd src/landing && npm run check && npm run build && node
  scripts/verify-seo.mjs dist` (sport pages build to `dist/{slug}.html`, not `/{slug}/index.html`).
  NOTE: `verify-seo` exits 1 on the pre-existing `public/google3f2f68ce4662a3cd.html` Search
  Console stub (thin content, no meta) — that failure is NOT yours; confirm no NEW page fails.

## Landmines & history
- **Add Play CTA must gate on `isEditMode` (T8130, 2026-09-02).** Any new button that calls
  `onAddClip`/`handleAddClipFromButton` (AnnotateContainer.jsx) MUST mirror `AnnotateControls`'
  `isEditMode` label/icon flip (`Add Play`/`Plus` vs `Edit Play`/`Pencil`) — that handler branches
  on `selectionState.type === 'SELECTED'` to EDIT the selected clip instead of creating a new one,
  so an ungated button silently misroutes the moment a clip is selected (says "add", actually
  edits) and undercounts `add_clip_opened`. Caught post-hoc by review, not CI — the CTA-hierarchy
  unit tests (`AnnotateModeView.cta.test.jsx`) mock every sibling surface, so a missing-gate bug is
  invisible there; only a real render with `isEditMode: true` catches it. **Do not reuse
  `AnnotateControls`' exact title text** (`"Add play ending at current time (A)"` /
  `"Edit selected play (A)"`) on a second, simultaneously-rendered button — both the transport-bar
  button and the full-width CTA are visible at once in non-fullscreen mode, so an identical
  `title` creates a Playwright strict-mode multi-match on `button[title="..."]` locators (see
  `clip-selection-state-machine.spec.js`). Use distinct title text per button instance instead.
- **Every `AnnotateFullscreenOverlay` render site must pass `existingClip` when EDITING (T8590,
  2026-09-03) — the sibling bug to the CTA-gating landmine above.** T8130 fixed the CTA's
  label/routing; it did NOT guarantee the overlay it opens actually renders in edit mode. The
  non-fullscreen `ClipsSidePanel.jsx` render omitted `existingClip` (only the fullscreen
  `AnnotateModeView.jsx` render passed it), so `isEditMode` (`!!existingClip`) was always false
  there: correctly-routed "Edit Play" clicks still opened a CREATE-mode form and Save produced a
  duplicate clip. Same invisibility mechanism as T8130 — no error, no crash, just silently wrong
  mode — and same fix shape: derive `existingClip` from the already-selected region
  (`clipRegions.find(r => r.id === selectedRegionId)`) at EVERY render site, never assume a
  sibling site's correctness covers this one. See the frontmatter T8590 entry above for the full
  writeup and regression coverage.
- **`annotation_completed` fires on WATCHED VIDEO, not a clip created — its label is display-only (T7930, 2026-08-28).**
  `POST /{game_id}/finish-annotation` (games.py, fired from `AnnotateScreen` mode-change/unmount via
  `gamesDataStore.finishAnnotation`) emits `record_milestone("annotation_completed")` purely on
  `body.viewed_duration > 0` — a user watching the Annotate video for any nonzero time, with ZERO
  `raw_clips` required. It is deliberately an ENGAGEMENT signal, not a content outcome
  (`UserDetailPanel.jsx` already scopes it into the Engagement band, not `PIPELINE_STEPS`; see
  backend-services.md rule 10 / T7510). A 2026-08-27 user report flagged accounts with no visible clip
  showing "Annotation Done" — the fix was to RELABEL only. The label lives in
  `analytics.FLOW_EVENTS["annotation_completed"]` and was renamed **"Annotation Done" -> "Watched
  Annotate Video"** (joins the sibling "Watched * Tutorial" family). **The event KEY
  (`annotation_completed`) and daily_col (`annotations_completed`) are UNCHANGED — they are stored
  history in `user_actions`/`daily_counters`; a rename would sever the time series.** Every admin
  surface that renders this label had to follow, because two of them derive/hardcode it:
  - `admin.py` builds funnel keys + `last_step` at READ time via `label.lower().replace(" ", "_")`, so
    the funnel step key moved `annotation_done` -> `watched_annotate_video`
    (`FunnelChart.jsx` STAGES key updated) and the `last_step` badge string moved "Annotation Done" ->
    "Watched Annotate Video" (`UserTable.jsx` STEP_STYLES map key updated to keep the cyan style).
  - `PlatformBreakdown.jsx` ACTION_LABELS is keyed by the event action (`annotation_completed`), not the
    label, so it was a pure text swap ('Annotations' -> 'Watched Annotate Video').
  `UserDetailPanel.jsx`'s ENGAGEMENT label ("Annotate") was left as-is — already correctly scoped and
  guarded by `UserDetailPanel.test.jsx`. The T7500 zero-row guard in `finish_annotation` (no milestone
  on a deleted/missing game) is correct and UNRELATED — do not touch it.
- **Quest credit SURVIVES content deletion — a lifetime-achievement mechanism, NOT a bug to "fix" (T7930).**
  `quests.py::_check_all_steps` marks onboarding steps (`add_clip`, `rate_clip`, ...) complete from a
  PERSISTENT `achievements` table (`achieved` set, e.g. `add_clip_opened`, `clip_rated`) that is
  deliberately never revoked (docstring: "Quest steps are derived... Reward claiming is idempotent —
  credits are only granted once per quest"; comment: steps are "LIFETIME achievements"). The only live
  re-derivation is an OR-BACKFILL (`'add_clip_opened' in achieved OR rc["total"] >= 1`) that can only
  STRENGTHEN a step, never weaken one — nothing re-checks CURRENT `raw_clips`/`games` rows once an
  achievement key is recorded. So a user who opened Add Clip / rated a clip fires the achievement + claims
  credit; if the game row is later deleted (e.g. T7870's delete bug), the achievement + already-granted
  credit are untouched. This explains ojedalucas19's "got credit but has no game" half and is a REAL but
  SEPARATE finding from T7870's deletion bug — revoking credit would be a product-policy change, out of
  scope here. Corroborated across all four reported accounts (T7870/T7880/T7920 own the per-account
  root causes; T7930 is the umbrella label fix for the SIGNAL).
  - **Rating distribution audit:** `raw_clips.rating` (1-5, app-default 4, `INTEGER NOT NULL` per
    database.py profile_db schema) lives ONLY in each per-profile SQLite, never in the Postgres
    analytics aggregate — no dashboard can answer "how many clips at each star". `scripts/audit_rating_distribution.py`
    (read-only, mirrors `audit_clip_dimensions.py`; `--env dev|staging|prod`) tallies
    `COUNT(*) GROUP BY rating` across every account and reports NULL/out-of-range buckets separately as
    schema-drift signals.
- **TSV clip import must WAIT for the in-flight upload's game id, never one-shot-drop (T7790, 2026-08-26).**
  `importAnnotationsWithRawClips` (AnnotateContainer.jsx) imports annotations to the UI immediately,
  then saves each as a `raw_clips` row via `saveClip(gameId, ...)`. The game id comes from
  `onGameCreated` (fired mid-upload, well before finalize — see the T7280 note below). On a slow/cold
  upload a user (or the e2e helper) can import the TSV BEFORE `onGameCreated` has created the game
  record, so `annotateGameIdRef.current` is still null. The old code read the ref ONCE and, finding it
  null, silently dropped every save with a `console.warn` — the id then arrived seconds later but
  NOTHING re-fired the saves, so the clips were on screen yet never reached the library (intermittent
  "0 of 3 / 1 of 3 saved"; proven deterministically by delaying `POST /api/games` 8s and importing
  immediately: at import `{annotateGameIdRef:null, uploadGameId:null, isUploading:true}` -> 0 clips,
  `onGameCreated` fires 11s later, nothing retries). Fix: module-scope `resolveImportGameId(ref)` polls
  `annotateGameIdRef.current` + `uploadStore.uploadGameId` (its authoritative copy, set in the SAME
  callback) every 200ms while an upload is genuinely in flight (bounded 120s), returns the id once it
  lands, and returns null ONLY when no upload can produce one (never started, or ended without a
  record). The import kicks the saves off in a background `void (async()=>{})()` (UI stays responsive,
  count returns immediately) and, on a null id, fails LOUDLY (`toast.error('Clips not saved', …)` +
  `console.error`) — never the old silent drop. This is still gesture-driven (the TSV-import handler
  owns its surgical saves), NOT a reactive effect. **Invariant: a TSV import during an upload never
  loses clips — it waits for the game id or tells the user it failed.** Note `uploadStore.uploadGameId`
  is CLEARED in `onUploadComplete` (uploadStore.js) once the upload finishes, so a fallback that reads
  it only AFTER completion is null — the wait must capture the id DURING the upload (which
  `resolveImportGameId` does by also polling `annotateGameIdRef`, which `onGameCreated` sets and is not
  cleared). Regression: `e2e/T7790-clip-save-race.qa.spec.js` (delays `POST /api/games`, imports the
  TSV immediately, asserts all 3 land; 0 clips on pre-fix code, 3 on the fix; 5/5 stable). The shared
  e2e helper `ensureAnnotateModeWithClips` now THROWS on a 0-clip result instead of warning-and-hanging
  to the 5-minute cap. (The sibling smoke test's residual `mode-framing` timeout is T7780's
  `isVisible({timeout})` silent-skip bug, a SEPARATE cause — do not conflate.)
- **A draft tile opens Focus on BODY click; its clip-segment strip is ALWAYS visible, not
  expand-on-click (T7790b, 2026-08-26).** Reel Drafts renders each draft as a `DraftTile`
  (`data-testid="project-card"`) whose `SegmentedProgressStrip` (one segment per clip + a trailing
  overlay segment, each `title` ending "(click to open)") is ALWAYS painted on the tile — there is NO
  "click the card to expand and reveal clips" interaction. `handleCardClick` (DraftTile.jsx) navigates
  immediately by the draft's furthest stage: `has_working_video` -> Overlay; else clips started/exported
  -> Focus; else `onSelect()` (default Focus, clip 0) — and does NOTHING when `!canOpen`
  (`canOpen = !isWaitingForUpload`). A clip SEGMENT's own click (`onClipClick`) is the deterministic
  "open THIS clip in Focus" gesture (`{mode:'framing'}`), independent of stage. Landmine for e2e: the
  old `navigateToProjectFromHome` helper clicked the tile BODY then waited for the strip to "expand"
  and show a clip row — but the body click had ALREADY navigated to `/focus` (unmounting the strip), so
  the follow-up `[title*="click to open"]` wait timed out (proven with a screenshot repro: BEFORE the
  body click url=/home/reels, 4 clip segments visible, modeFraming=false; AFTER, url=/focus,
  modeFraming=true, 0 segments). This was invisible pre-T7780 because the `isVisible({timeout})` guard
  never actually waited; T7780's `waitFor` conversion made it a real, failing wait. Fix: the helper
  waits for `[data-testid="project-card"]` then clicks its first clip SEGMENT (already visible) to enter
  Focus — no body click, no expand step. Separately, that helper's `Reel Drafts` nav-tab `waitFor` was
  a too-tight 2000ms (~1/3 flake: the `Promise.race([domcontentloaded, 10000])` can resolve before React
  hydrates the nav bar); bumped to 5000ms to match the helper's sibling waits. Both are TEST-INFRA
  fixes — the fresh reel's data (clip_count, segments) was always correct.
- **GameDetailsModal short-viewport dead-end (T7590, 2026-08-25).** The "Add your first game"
  flow's `GameDetailsModal.jsx` (the required-fields-at-creation modal opened by ProjectManager's
  "Add Game" CTA → `handleAddGameClick`) centered its panel with `fixed inset-0 flex items-center
  justify-center` and the panel itself had **no `max-height` and no internal scroll**. The full form
  (opponent, date, game type, video format, dropzone, cost, submit) is ~630px tall; on the exact
  viewports two iPhone-Safari users reported (bug #46 320x498, bug #18 352x541) the panel exceeds the
  screen, so with center alignment the submit "Add Game" button clipped BELOW the fold and the close
  "X" clipped ABOVE it — and because the panel is `position: fixed` **nothing scrolls to reveal
  them**: a genuine dead-end (fill the visible fields, can neither submit nor dismiss). The opponent
  input's `autoFocus` opens the iOS keyboard immediately, shrinking the visual viewport further (the
  320x300 keyboard-open case clips even the dropzone). **Fix:** panel gets `max-h-[90vh]
  overflow-y-auto` — the SAME pattern every sibling modal already uses (BuyCreditsModal,
  ProjectCreationSettings, ClipLibraryModal); GameDetailsModal was the lone outlier missing it. The
  `check-viewport-units.mjs` gate bans `h-screen`/`100vh` only — `max-h-[90vh]` is explicitly allowed
  (a max doesn't clip an unscrollable fold). Regression:
  `e2e/T7590-mobile-add-game-modal-reachable.qa.spec.js` drives the REAL modal via the empty-session
  test-login bypass (the actual new-user zero-games surface, so it runs anywhere with chromium, no
  R2/account) at both report viewports; asserts the form genuinely overflows (`scrollH > vp.height`,
  anti-vacuous), the panel is capped (`clientH <= vp.height`, `overflow-y:auto`), and submit + close
  both scroll into the viewport with the never-disabled X hit-testable. Negative-control verified:
  fails on the pre-fix code at `clientH(629) <= 498/541`, passes post-fix.
  **T8500 update (2026-09-03):** the create-mode form this bug was measured against (opponent,
  date, game type, video format, dropzone, cost, submit, ~630px) no longer exists — T8500
  reordered to cost line -> dropzone -> collapsed details disclosure -> submit and REMOVED the
  opponent input's `autoFocus` entirely (it now lives inside the collapsed disclosure, never
  auto-focused), so the keyboard-shrinks-viewport case described below is no longer applicable to
  create mode. The `max-h-[90vh] overflow-y-auto` panel fix and this regression spec's pattern
  (empty-session bypass, anti-vacuous overflow assertion, submit+close reachability) still stand
  and should still be run against the new layout; T8550 owns re-verifying/adapting the spec's
  concrete assertions (field text, exact heights) for the shorter form.
  **Candidate failure modes accounting (this container = chromium engine + iPhone viewport, NOT real
  WebKit — see playwright.config.js):** CHECKED & RULED OUT via emulation — CTA tap handler fires
  and opens the modal (no z-index/overlay intercept; QuestPanel NUF is a `z-50` ~340px corner panel,
  not a full-screen cover; its only `inset-0 z-[100]` layer is an unrelated quest-confirm dialog);
  file input reachable/clickable through the dropzone `role=button` (synchronous `.click()` inside
  the onClick, i.e. within the gesture stack); `accept="video/mp4,video/quicktime,video/webm"`, NO
  `capture` attr (documented, not the bug); no JS exceptions during the flow (the only console errors
  are the empty test-session's backend session-init fetch failures, unrelated to layout).
  REPRODUCED & FIXED — the modal-overflow dead-end above. DEFERRED to real-device/Safari (structurally
  unverifiable on chromium, do NOT claim ruled in/out): the iOS Safari `.click()`-outside-gesture-stack
  file-input restriction, the iOS 18 cellular-upload timeout (Apple dev forums 764420), the
  HEVC->H.264 photo-picker "preparing" delay.
- **T7280 findings (2026-08-20, task abandoned mid-implementation in favor of the Game Pools
  epic — capturing before the branch is deleted).** T7280 attempted a duration-based fast path
  (single short clip → skip Annotate, land in Framing) via `handleAnnotateWithFile`
  (ProjectsScreen.jsx ~L339, the one nav seam that decides Annotate BEFORE any file inspection)
  and a new `useGameUploadFlow` hook. Real findings worth keeping regardless of the eventual
  design (likely to differ — see EPIC.md "Captured requirements"):
  - **The upload chain's earliest point `game_id` exists is `onGameCreated`**, fired from
    `uploadManager.uploadGame` → `createGame('pending')` → `options.onGameCreated({game_id,
    name})`, well BEFORE `ensureVideoInR2`/`activateGame`. Any auto-action keyed on the new
    game (an auto-clip save, a auto-navigation) must fire from THIS callback — never a stale
    "active game" ref (T7010) and never a reactive effect watching upload state.
  - **`AnnotateContainer.handleGameVideoSelect`'s upload+metadata+clip logic was deliberately
    NOT unified into the new shared hook**, despite the DRY temptation — it carries its own
    timing-sensitive load-order landmines (T4060, T3960) that a shared abstraction risked
    disturbing for a path that must stay byte-identical. If a future attempt tries to
    consolidate these two upload paths, budget real time for re-verifying T4060/T3960 don't
    regress, don't assume it's a mechanical extraction.
  - **React 18 StrictMode double-invokes `useState` lazy initializers in dev** — an
    impure "read-and-clear" one-shot breadcrumb consumer (reading a module-level flag and
    clearing it inside a `useState(() => ...)` initializer) can silently drop the value before
    it's ever used for real. Fix pattern: consume one-shot breadcrumbs from a `useRef`-guarded
    `useEffect` on mount instead (the ref persists across StrictMode's synthetic
    unmount/remount of the same instance) — never from a lazy initializer.
  - **A Zustand selector on a whole mutable object (e.g. `activeUpload`) re-renders on every
    field change of ANY tracked upload**, including unrelated background ones, if the object
    gets a new reference per progress tick. Narrow to a boolean/primitive selector for
    effect-heavy screens instead of subscribing to the whole object.
  - **Framing's blob-source gap** (Framing cannot preview a still-uploading clip) is captured
    in keyframes-framing.md's Landmines section — read that before attempting any
    "land the user in Framing right after upload" flow again.
  - Design doc with full architecture analysis preserved at `docs/plans/tasks/T7280-design.md`
    on master (task itself superseded — see PLAN.md / dual-camera/EPIC.md "Captured
    requirements" for where this direction actually landed).
- **Upload lifecycle invariants (T7480 — read before touching `games_upload.py`/`uploadManager.js`).**
  The R2 multipart upload path (prepare → parts → finalize → activate) caused the 2026-08-20 prod
  outage. What now holds:
  - **`PART_SIZE = 5MB` (`games_upload.py`), flat per upload.** 5MB is the R2/S3 hard MINIMUM for
    non-final parts, and **R2 requires every non-final part of ONE upload to be the SAME size** — do
    NOT build adaptive/per-part sizing. The old 25MB made a phone video a single part that couldn't
    beat the client per-part budget on a cell uplink.
  - **Per-part timeout is a STALL WATCHDOG, not a flat cap** (`uploadManager.js`, `PART_STALL_TIMEOUT_MS`
    = 30s no-progress + `PART_ABSOLUTE_TIMEOUT_MS` = 10min ceiling). Reset on every `upload.onprogress`;
    abort only on a genuine stall. The old flat `PART_UPLOAD_TIMEOUT_MS = 180_000` killed healthy slow
    transfers and each retry restarted from byte 0. `stalled` is classified RETRYABLE alongside network
    error / timeout / 5xx.
  - **Progress is COMPLETED-parts-based, never buffered bytes.** `uploadParts` moves the bar only when a
    part's PUT returns 2xx (`deliveredBytes`); `onprogress` feeds ONLY the stall watchdog. Buffered
    bytes climbed while the socket was dead — do not re-wire the bar to them.
  - **Resume is part-size-guarded.** `prepare_upload`'s resume branch verifies the multipart's existing
    R2 parts match the CURRENT `PART_SIZE` (`r2_multipart_parts_match_size`) before reusing a session;
    a mismatch (e.g. an old 25MB-chunked upload) restarts fresh instead of finalizing a corrupt object.
    Part size is derived from LIVE R2 state, not stored — no schema column.
  - **UploadId hygiene:** `r2_abort_orphan_multipart_uploads(key)` runs before `r2_create_multipart_upload`
    on the fresh-create path (only reached after a valid resume was declined, so every open multipart there
    is a genuine orphan). This kills the **double-UploadId anomaly**, whose real cause is the APP-level
    `retry_r2_call(**TIER_3)` re-firing a read-timed-out `CreateMultipartUpload` — NOT boto3, which runs
    `Config(retries={"max_attempts": 0})`.
  - **Observability:** every prepare/resume/finalize logs `[UPLOAD_LIFECYCLE] ...` (grep-pair prepare↔finalize
    by `session=` to find abandoned sessions); the client `POST /api/games/upload-failure-beacon`
    (`sendUploadFailureBeacon`, fire-and-forget, keepalive) logs `[UPLOAD_BEACON] ...` on retry exhaustion —
    the ONLY server-visible channel since prod strips `console.log`. The beacon is LOGS-ONLY (no DB write, so
    gesture-persistence rules don't apply — keep it that way). Admin read-only sweep:
    `GET /api/admin/users/{user_id}/stuck-uploads` (opens each profile `mode=ro`, returns pending_uploads +
    age + R2 multipart state). `pending_uploads` is a PER-PROFILE table (`database.py` schema).
  - **Sibling scope (do not fight):** T7470 owns the destructive upload-failure cleanup (cascade-delete),
    T7490 owns pending-game UI + honest reaping (aborting the stale R2 multipart), T7500 owns the
    zero-rowcount silent-success sweep. T7480 deliberately did NOT touch those lines.
- **Orphaned pending upload is reaped HONESTLY into a visible card (T7490).** `games.status` gained
  a third value `'upload_failed'` (`constants.GameStatus.UPLOAD_FAILED`, free-text column, NO
  migration — the column already had no CHECK). `list_pending_uploads` (GET
  `/api/games/pending-uploads`, `games_upload.py`) used to SILENTLY `DELETE` a stale resume record
  (R2 multipart gone), leaving any orphaned `games` row that survived T7470's only-if-empty guard
  invisible forever (status stuck at `'pending'`, excluded from `readyGames`). Now, per stale row it:
  (1) aborts the orphaned R2 multipart via `r2_abort_multipart_upload` (best-effort — that helper
  swallows+logs and never raises, so a failed abort can't block the response; we also log
  `[T7490]` on a False return), (2) `UPDATE games SET status='upload_failed' WHERE blake3_hash=? AND
  status='pending'` (per-profile DB, so the hash match only touches this user's games; multi-video
  games have NULL hash and are not matched — accepted), (3) deletes the `pending_uploads` row.
  Idempotent (second call finds no stale row; the UPDATE no-ops once status left `'pending'`). This
  is a WRITE in a GET handler — a known smell the task deliberately did NOT restructure into a POST
  (scope); kept minimal/logged/idempotent instead. **Frontend:** `readyGames` (gamesDataStore) is
  `status != 'pending'`, so `upload_failed` renders in the Games tab as a distinct `GameTile` state
  (rose "Upload incomplete" badge, dead-poster scrim, persistent **Retry**/**Discard** bar; tile-tap
  /kebab/pencil suppressed — no video to open). **Retry** re-selects the original file through the
  SAME resume file-picker flow (`ProjectManager.handleResumeClick` → `handleResumeUpload`); there is
  no stored original filename on the game, so the name-mismatch warning is skipped. **Discard** is a
  two-tap confirm firing the FULL cascade delete (`onDeleteGame`) — the ONE case full cascade is
  correct (user explicitly abandoning). **Retry must not spawn a duplicate:** `create_game('pending')`
  (games.py) reuse query now matches `status IN ('pending','upload_failed')` and flips a reused
  upload_failed row back to `'pending'` so the re-upload resumes INTO the same game id (clips survive).
  **Reel builder leak guarded:** `GameClipSelectorModal` filters `status==='upload_failed'` out of its
  selectable game list (no source video → clips can't be framed). Tests:
  `tests/test_t7490_honest_reap.py` (reap + abort-does-not-block + idempotency + no-dup-on-retry +
  valid-upload-untouched), `GameTile.test.jsx` (upload_failed state). **Follow-up (not done):** the
  ACTIVE-upload UX (mobile "keep tab open", resume-across-reload with file re-matching) was
  out-of-scope here — it belongs to the active-upload flow (T7480/general), not this dead-orphan card.
- **Upload-failure cleanup is ONLY-IF-EMPTY (T7470 — the invariant that protects annotate-during-upload).**
  A failed upload must NEVER cascade-delete a game the user annotated against while it was still
  uploading (T1540: a real `game_id` exists from `onGameCreated`, well before finalize, precisely so
  the user can annotate the local blob during transfer). Both `uploadManager.js` catch blocks
  (`uploadGame`, `uploadMultiVideoGame`) issue `DELETE /api/games/{id}?only_if_empty=true`, NOT a bare
  cascade delete. The backend guard (`games.py:delete_game`, helper `_game_has_user_content`) is the
  INVARIANT, not the frontend — with `only_if_empty=true` it REFUSES (200 no-op, `{deleted: False,
  reason: 'has_content'}`) when the game has any `raw_clips` row OR `viewed_duration > 0`, leaving it at
  `status='pending'`. Refusal is a 200, not a 4xx: the "user annotated" case is expected, and the
  cleanup handler is best-effort (it swallows errors), so a scary status would be wrong. The guard reads
  on the same connection as the cascade, so a clip committed between the client's pre-check and the DELETE
  is still caught (the race). A user-gestured `DELETE /api/games/{id}` with NO flag keeps FULL cascade
  semantics, unchanged. The failure toast is the user-visible surface (`uploadStore.onUploadError` →
  `toast.error('Upload failed')`); the fuller pending/retry UI is T7490. Do NOT add a frontend content
  pre-check that gates the DELETE — the backend guard is sufficient and the frontend can't be trusted
  (the whole point). Covered by `test_t7470_upload_failure_cascade_guard.py` +
  `uploadManager.test.js` ("cleans up a failed pending game with only_if_empty=true").
  Prod forensic that filed this: bigajosue (PAYING user) had 4 games insert+delete in one session
  (`sqlite_sequence.games=4`, 0 rows), work saved only by luck of having zero clips.
  **T8180 (2026-08-31) — the only_if_empty guard was NECESSARY but NOT SUFFICIENT.** At cleanup
  time the annotate-during-upload user has committed NOTHING yet (they're mid-session), so the game
  is genuinely empty and `only_if_empty` happily deletes it OUT FROM UNDER the live session — bug 47p:
  bknoto annotated a deleted game for 26 min, then Ready → `finish-annotation` 404 SILENTLY. So both
  `uploadManager.js` catch blocks now ALSO skip the DELETE entirely when the user is still bound to the
  game, via `isUserAnnotatingGame(gameId)` = `useEditorStore.getState().isAnnotateMode() &&
  activeAnnotateGameId === gameId`. This is NOT the banned "frontend content pre-check" (that gated on
  clip content, which the frontend can't be trusted to know and the backend already guards) — it gates
  on EDITOR SESSION BINDING, information ONLY the client has. The errored `uploadStore` entry is
  retained (`status:'error'`) so Retry re-uses the game row and Discard (dismiss gesture) is the only
  delete path. `activeAnnotateGameId` is a pure client UI mirror in `editorStore` (same class as
  `annotateHasSelectedClip`), synced from `AnnotateContainer` by a one-line effect off the hook's
  `annotateGameId` — NOT a persistence path. When the user LEAVES annotate (`isAnnotateMode()` false)
  the guard reverts to T7470's behavior and an abandoned-empty game is still cleaned up. See the
  "Ghost session" landmine below and `uploadManager.test.js` (bound-skip + unbound-still-fires).
- **Ghost annotate session must be impossible to miss (T8180, 2026-08-31).** If a game IS deleted
  under an active annotate session (any path — a residual race, a user delete elsewhere), the app must
  never let the user keep working into the void. Three loud-404 paths, all reversing prior silent
  swallows:
  1. **`finish-annotation` 404** — `gamesDataStore.finishAnnotation` now RETURNS `{ notFound: true }`
     (was T7500's silent `return`/debug-log). `AnnotateScreen.persistAnnotateProgress` reacts via
     `handleGhostGame()`: loud toast ("This game no longer exists"), `fetchGames()`, and
     `redirectToMode(project-manager)` — exits the ghost. **The T7500 zero-row guard in the BACKEND
     `finish_annotation` (no milestone on a missing game) is UNRELATED and unchanged** — only the
     frontend's swallow was reversed.
  2. **Clip save 404** — `save_raw_clip` (clips.py) historically wrote an ORPHAN raw_clip against a
     deleted `game_id` with NO existence check (returned 200 into the void; this is bknoto's stray
     raw_clip). Now a `SELECT 1 FROM games WHERE id = ?` guard → **HTTP 404** when the game is gone.
     An EXPIRED game still has its row (only R2 media is reclaimed), so this 404s ONLY when truly gone.
     `useRawClipSave.saveClip` returns `{ notFound: true }` on 404; `AnnotateContainer.handleAddClip`
     KEEPS the just-added region (work preserved in memory — the region is already in `clipRegions`)
     and shows a persistent toast with a "Back to games" action, NO forced navigation (so the clip
     stays visible). Covered by `tests/test_t8180_ghost_clip_save.py` (404 + no orphan row) and
     `useRawClipSave.syncFailed.test.js` (returns `{notFound:true}`, distinct from the 503 sync-fail).
  3. **Continue-card** — `handleLoadGame`'s existing "not found" branch (toast + redirect) now also
     `fetchGames()` so a clicked-but-deleted "Continue where you left off" game drops off the list.
- **`uploadStore` holds a QUEUE, not a singular upload (T7360).** `uploads: []` replaced the old
  singular `activeUpload` + top-level globals (`uploadGameId`/`uploadGameName`/`retryContext`/
  `onCompleteCallbacks`) — those moved INTO each entry so N uploads coexist without cross-talk.
  Serial-queue-of-one engine: exactly one entry is ever `status:'uploading'`; the rest wait as
  `'queued'` and auto-advance on completion/failure/cancel (`advanceQueue()`, one internal
  `runEntry(entry)` every start/retry/promotion funnels through — no second "retry re-implements
  start" path). A failed entry stays `status:'error'` in the array with its own retry context and
  does NOT block the queue behind it. `startUpload` NEVER returns null for "busy" anymore (only
  for no-file) — the old `:47` silent-drop rejection is gone; a genuine duplicate (same
  `name:size` fileKey) is rejected VISIBLY (`toast.info('Already queued', ...)`) and returns the
  EXISTING entry's id. Ids are `upl_${++_uploadSeq}` (module counter, not `Date.now()` — two
  drops in the same ms used to collide). **Selectors are the T7280 fix, not decoration:**
  `useActiveUpload()`/`useActiveUploadGameId()`/`useActiveUploadBlobUrl()`/`useIsUploading()`/
  `useUploadCount()` are narrowed/primitive on purpose — AnnotateScreen/AnnotateContainer
  subscribe ONLY to these, never to the whole `uploads` array or a whole entry object, so a
  background progress tick can't re-run their redirect/restore effects (the exact T7280
  landmine). T1540 (annotate-during-upload) binds to the ONE active entry
  (`useActiveUploadGameId`/`useActiveUploadBlobUrl`) — queued uploads have no mounted blob and
  aren't annotatable, so this is correct, not a compromise; do not thread a game-id list into
  AnnotateContainer. The completion-callback-before-retire race is preserved per-entry
  (`onEntryComplete` fires `entry.onComplete` BEFORE `retireEntry`). Consumers render `uploads`
  as a LIST everywhere (`UploadProgressIndicator` stacks active/failed/queued rows;
  `ProjectManager`'s `ActiveUploadCard` renders active+error entries in an "Uploading" group and
  queued entries in a "Queued" group, each error card with its own Retry/Discard) — single-upload
  parity is structural (a 1-item list), never a `length===1` branch. `App.jsx`'s
  `isUploading()` action call is unchanged (now means "any entry uploading or queued").
  E2E-testing gotcha: driving this store via a direct `useAuthStore.setState({isAuthenticated:
  true})` (bypassing real login) skips `/api/bootstrap` entirely — the app instead fires
  individual per-store fetches (`/api/profiles`, `/api/projects`, `/api/quests/progress`, ...) on
  the auth-transition subscription, three of which have NO fallback for a malformed/empty stub
  response and crash the render with no error boundary (kills the whole tree, not just the
  screen under test): `/api/profiles` needs `{profiles:[]}`, `/api/projects` needs a bare `[]`,
  `/api/quests/progress` needs `{quests:[]}`. See `e2e/T7360-concurrent-uploads.qa.spec.js`.
- **Landscape-phone sidebar = the DESKTOP sidebar (T4933).** The `sm` breakpoint (>=640px) is
  width-only, so a phone in LANDSCAPE ≥640px wide (iPhone 14 844x390, Pixel 7 915x412) renders the
  full desktop `ClipsSidePanel` (`hidden sm:flex`, `w-[352px]`) — NOT the mobile sidebar. Its
  clip-editor content (`ClipDetailsEditor`, all desktop fields ~546px tall; or the `layout="inline"`
  add-clip form) then lives inside the `h-dvh overflow-hidden` app shell (App.jsx ~726) but the
  landscape viewport is only ~390px, so bottom controls (Delete Clip / Create Reel / Save) get
  clipped below the fold with no scroller. **Fix pattern (T4933): each bottom pane owns a scroll
  region.** In `ClipsSidePanel`, the desktop `ClipDetailsEditor` is wrapped in `min-h-0
  overflow-y-auto`, the add-clip form's inline wrapper (`AnnotateFullscreenOverlay` `layout='inline'`)
  got `min-h-0` added to its existing `overflow-y-auto`, and the clip list keeps a `min-h-[64px]`
  floor (not `min-h-0`) so it stays visible instead of collapsing to 0 when a bottom pane shares a
  short sidebar. `min-h-0` is the key: a flex child won't shrink below content (so `overflow-y-auto`
  never engages) until its `min-height:auto` is overridden. On tall desktop/portrait these are no-ops
  (content fits, no scrollbar). Guarded by the T4930 usability matrix (`screen-usability.spec.js`,
  Annotate landscape) — the audit throws the exact "dead scroll trap … 546px in a 390px clip box"
  if it regresses. NOTE: reproducing needs an account whose game has clips (a clip auto-selects →
  editor mounts); an empty-clip game hides the bug (no tall pane renders).
- **T4060 load-order coupling (fixed)**: annotations stopped rendering in Annotate for ALL accounts
  because T4000's early `/video` src (seeded by `peekPendingGame` on first render) made
  AnnotateScreen's old `if (annotateVideoUrl) return` guard skip `handleLoadGame` → `/load` never
  ran → empty timeline. Fix at AnnotateScreen.jsx:363-386: a pendingGame breadcrumb means "load
  must win" — `consumePendingGame()` then `handleLoadGame` unconditionally; AbortController for
  StrictMode. Second half: `useAnnotate.importAnnotations` writes `setDuration(overrideDuration)`
  unconditionally (useAnnotate.js:671-679) — the old `!duration` gate broke on the second game open
  (closure held the prior game's duration). Lesson: never gate a load path on "some video src exists".
- ~~**Reactive game-duration PATCH (FIXED T4260, 2026-07-11)**~~: the `loadedmetadata` effect→PATCH `/api/games/{id}/duration` is deleted from `AnnotateContainer.jsx`. The memory-only fixup is kept (console.warn only). Duration is now authoritative at upload finalize (ffprobe). Endpoint `games.py:1409` is removed. Regression test: `test_t4260_duration_source.py`.
- ~~**remove_segment_split wipes speeds (FIXED T4220, 2026-07-11)**~~: `clips.py` re-indexes the `segmentSpeeds` dict on split removal (merged segment keeps the speed if both sides were equal, else omitted; later indices shift down). Frontend `useSegments.js` aligns to the same rule. Regression tests: `test_t4220_remove_split_speeds.py`, `useSegments.removeSplit.test.js`.
- ~~**gamesDataStore.saveAnnotations / PUT /annotations bulk writer (FIXED T4270, 2026-07-11)**~~: `saveAnnotations` (gamesDataStore.js) and its endpoint `PUT /api/games/{id}/annotations` deleted — zero frontend callers confirmed by grep. `save_annotations_to_db` backend function retained (internal callers exist: share materialization, recap flows). The divergent second-writer path is gone; consolidation is audit E11/T4500.
- **save_annotations_to_db is a divergent second writer** (audit E11): its HTTP endpoint is deleted (T4270), but the Python function remains for internal callers. Does NOT bump `boundaries_version` when mutating start_time (L1647). Don't extend it; consolidate onto the gesture path (T4500).
- **editorStore reactive writer**: `useEffect → setAnnotateHasSelectedClip` at
  AnnotateContainer.jsx:241-243 (quest-panel auto-collapse) — dead state slated for deletion in
  T4440; audit D5 moves the gameVideos/tags/share useState + restore-sync effects (L97-99,
  280-298, 323-333) into gamesDataStore selectors (T1540/T4060 class).
- **NotesOverlay ≠ recap viewer**: `modes/annotate/components/NotesOverlay.jsx` is the playback
  text overlay; the T4130 "Annotations tab" work lives in `RecapPlayerModal.jsx` (T4130 comments at
  L31, 131, 390). The Highlights-tab "Create clip" (L203-208) instead jumps to Annotate via
  `setPendingGame(game.id, currentTime)`.
- **T3960 select-on-load**: AnnotateScreen effect (L407-464) re-selects a reel's source clip only
  once clipRegions load AND `duration > 0`, bounded to 40 attempts — timing-sensitive, don't
  "simplify" it.
- **Back-fill on load**: `handleLoadGame` re-saves annotations missing an `id` via `saveClip`
  (AnnotateContainer:640-662) — a load-time write that exists to heal legacy rows; know it's there
  before assuming load is read-only.
- **Upload duplicates game state**: one-time upload-store restore effect (`[]` deps, L280-298) +
  active-upload video restore (L323-333) re-hydrate state when navigating back mid-upload.
- **Landscape-phone renders the DESKTOP clip sidebar (T4933 landmine).** The `sm` breakpoint is
  width-only: a phone in LANDSCAPE ≥640px wide (iPhone 14 844×390, Pixel 7 915×412) trips
  `hidden sm:flex` (AnnotateScreen.jsx:599) and `useIsMobile()` → false, so it gets the full
  desktop `ClipsSidePanel` (`w-[352px]`, ClipsSidePanel.jsx:115) with ALL editor fields
  (~546px tall), NOT the mobile off-canvas drawer — inside the `h-dvh overflow-hidden` app shell
  (App.jsx:726) whose landscape height is only ~390px. **Sidebar scroll-region pattern (T4933):**
  each bottom pane owns its own scroller so its controls stay reachable — clip list is
  `flex-1 min-h-[64px] overflow-y-auto` (min-h floor, not min-h-0, so it doesn't collapse to 0
  when a bottom pane is present), the desktop `ClipDetailsEditor` is wrapped in
  `min-h-0 overflow-y-auto`, and the inline add-clip form (`AnnotateFullscreenOverlay` `layout="inline"`)
  carries `min-h-0 overflow-y-auto` (the min-h-0 is a no-op where the inline form is not a flex
  child — mobile inline / fullscreen). Without an inner scroller the usability audit
  (screen-usability.spec.js) throws `dead scroll trap: "Save" clipped ... 546px in a 390px clip
  box`. Desktop/portrait unchanged (natural height, nothing to scroll). NOTE: this env's dev DB
  data may not reproduce the height overflow (sparse clip) even though prod does — verify by
  selecting a clip to mount the tall editor at 844×390.
- **The Games-tab surface is `GameTile` (poster grid), NOT a list (T5681 → T5990).** The home Games
  tab renders a chronological landscape-tile grid of `<GameTile>` (ProjectManager.jsx:~881,
  grid classes now DERIVED per T7330 — see the T7330 entry below). The older `GameCard`/`GameMetaRow`/`RatingChip`
  list component was fully removed (T5990) — it had been dead since T5681 but its Vitest specs still
  rendered it directly and passed green, which masked real drift: `T5675-home-hero-legibility.spec.js`
  asserted `Uploaded`, `Footage quality N/100` and the rating chips that live only in `GameMetaRow`,
  so the E2E broke while the unit tests stayed green. Lesson: a component only reachable from its own
  tests is dead, not covered. The tile's verbose meta row is GONE by design — the scrim shows only
  name + clip count (the date was dropped in T7290, see below); all game actions live behind the
  tile's kebab menu. NOTE the tile
  gates the recap entry on `recap_video_url` (hasRecap), NOT on clip_count, and shows no recap entry
  for an expired game with no recap video — a deliberate divergence from the old GameCard.
  Covering specs: `GameTile.test.jsx`, `GameTile.posterUrl.test.jsx`, `T5681-games-poster-grid.spec.js`.

- **The Games tab organizes by MATCH date (`game_date`), never upload date (T7290).** Month headers,
  cross-group order and within-group order all key off `game_date` — the date the user thinks in and
  the one already baked into the tile title by `generate_game_display_name`. Two halves that must stay
  in agreement: `groupGamesByMonth` (ProjectManager.jsx, exported for tests) and
  `GAMES_MATCH_DATE_ORDER_BY` (games.py, the `_read_games_for_list` ORDER BY). Invariants: `game_date`
  is date-only TEXT `YYYY-MM-DD`, so the frontend parses it as a **local calendar date** — `new
  Date("2026-03-01")` is UTC midnight and files a March 1st game under February west of Greenwich.
  A NULL/empty `game_date` (games predating the required field, plus materialized/shared rows) falls
  back to `created_at` for PLACEMENT ONLY and is never dropped, with the pre-existing
  missing-metadata warning in `_list_games_impl` left as the single loud signal; a non-empty but
  unparseable `game_date` is a DATA BUG, not that edge case, and warns. **The fallback compares the
  upload CALENDAR DAY (`substr(created_at,1,10)` / `String(created_at).slice(0,10)`), never the full
  timestamp** — review caught the timestamp version making the two orders disagree (a May 9 match
  uploaded in June vs a dateless game uploaded May 9: the server ties them on the day and settles on
  `created_at DESC`, a timestamp key wins the primary comparison outright). Same-match-day ties break
  on upload time newest-first on BOTH sides. The two suites share fixtures row-for-row so a change to
  one half goes red in the other. Consumers that render raw server order without re-sorting (e.g.
  `GameClipSelectorModal`) are why the agreement matters, not just the tab. Deliberately untouched:
  Reel Drafts grouping (already keyed on `project.game_dates`) and the "Continue where you left off"
  card (genuinely recency-of-activity). Covering specs: `ProjectManager.gameGrouping.test.jsx`,
  `tests/test_t7290_games_list_order.py`, `ReferenceGameCard.test.jsx`.

- **T7330 supersedes two of T7290's decisions — read this before trusting the entry above.**
  (1) **The tile date is BACK**, on both `GameTile` and `ReferenceGameCard`, as weekday + short
  match date ("Sat, Mar 21") from `game_date`. T7290's reasoning for removing it (already the
  title suffix) was wrong in practice: the name is `truncate`d in ~120px and the suffix sits at
  the truncation end, so it is the FIRST thing lost — and a game with no `opponent_name` gets no
  suffix at all from `generate_game_display_name`. Empty when there is no match date; NEVER an
  upload-date fallback. (2) **`groupGamesByMonth` is gone**, replaced by `groupGamesForTab`,
  which returns ONE ORDERED ARRAY of `{key, kind: 'month'|'tournament', label, sublabel,
  sortDate, games}` instead of `{groups, order}`.
  **The server-order invariant above now has a caveat:** rendered flat order equals
  `GAMES_MATCH_DATE_ORDER_BY` only while NO tournament group forms — a tournament instance
  deliberately hoists its games out of month order and sorts at its newest match. That is
  correct, not a bug: the agreement exists so month PLACEMENT cannot contradict the server, and
  raw-order consumers (`GameClipSelectorModal`) still receive the server's order untouched.
  Tournament rules: `>= 2` games in one INSTANCE (a name is split at gaps > 90 days measured
  PAIRWISE between consecutive matches, so annual recurrences never merge); a lone tournament
  game stays in its month; a month emptied by a hoist is not rendered; the range sublabel is
  built from real match dates only. Two accepted consequences, not bugs: (1) pairwise chaining
  makes an instance's total span UNBOUNDED — a league typed into `tournament_name` with games
  every ≤90 days collapses its whole history into one amber group above every month header;
  fine until roughly a season's worth, revisit if real data hits it. (2) Collections (T5880,
  `collections.py`) groups tournaments by NAME ONLY, server-side, no instance split, no >=2
  rule — so "Surf Cup" across two years is ONE group there and TWO here, and a lone tournament
  game gets a tournament group there but a month group here. Divergence known and deliberate;
  unify only if a user reports the mismatch.
  Date parsing for ALL of this lives in `src/frontend/src/utils/matchDate.js` — one parser, on
  purpose, because the UTC-midnight landmine must not get a second implementation.
  Layout: desktop column count is derived (`gamesGridColumns`, clamp 2-4) and group headers sit
  in a sticky left rail at `lg`+; see `.claude/references/ui-style-guide.md` § Grouped grid with
  rail header. `GamesListSkeleton` consumes the same exported grid map — a private copy is the
  T6310 drift bug.

- **Two game-navigation breadcrumbs, different destinations (T5820).** `setPendingGame(gameId, ...)`
  (`utils/pendingNavigation.js`) deep-links into the ANNOTATE editor (consumed by AnnotateScreen).
  `setPendingGameReference({sourceProfileId, sourceGameId, sourceProfileName})` is the SEPARATE
  cross-profile breadcrumb for a **reference card** (a `games` row with `source_profile_id`, T5800):
  clicking it does NOT open Annotate — by user decision "you clicked a game card, you should get the
  game card", it switches to the OWNING profile and lands on its **Games tab** with the real game
  scrolled into view + a transient green ring. Consumed once in `ProjectManager` (a `ReferenceGameCard`
  renders the link variant; the real `GameTile` is untouched). It survives `profileStore._resetDataStores`
  (sessionStorage, not Zustand). The consume-effect must wait for the OWNING profile's OWN games fetch
  (a `referenceLoadStartedRef` load-cycle guard: observe `gamesLoading` go true→false) before matching,
  or it would consume against the stale pre-refetch list and false-degrade. The owning game is located
  by exact **`source_game_id`** match against the target profile's own (non-reference) games — the API
  projects `source_game_id` alongside `is_reference` (see export-pipeline.md §Cross-profile), so this
  works for MULTI-VIDEO owning games too (their `blake3_hash` is NULL, which is why an earlier version
  of this breadcrumb matched on hash and had to skip the highlight for them). A missing match now means
  the owning game was genuinely deleted — the degraded notice fires; there is no other reason for
  `source_game_id` to not resolve. QA is real-browser only (`e2e/T5820-reference-link-cards.qa.spec.js`)
  — jsdom gives false confidence on the switch race.
- **Ready Draft tile contract (T6180) — do not undo when restyling `DraftTile.jsx`.** For a
  ready draft (`isReadyToPublish = has_final_video && !is_published`) the tile is a
  discoverable action surface, NOT the old 10px corner badge (which was a `<button>` labelled
  with the *status* word "Ready" whose verb hid in `aria-label`, on a tile whose body was inert —
  the user could not find how to publish). The contract:
  - **"Ready" is a non-interactive `<span>` status badge** (top-left) — never a control.
  - **Primary = an emphasized `<button>` "Move to My Reels"** in a PERSISTENT bottom action bar
    (never hover-gated — that persistence is the whole point). Icon is `FolderInput` (a one-way
    move; deliberately NOT `Send`/paper-plane, which reads as "share" in an app with real sharing).
    Contrast is `text-gray-950` on `bg-cyan-500` (AA). It calls `publishProject` → the
    `moved_to_my_reels` quest fires exactly once on the 200 path.
  - **Preview is a visible secondary**; the **tile body click PREVIEWS** (was inert). Rename /
    Framing / Overlay / Hide / Delete collapse into a **kebab** (`data-testid="draft-kebab-menu"`,
    ReelTile's portaled-popover-on-fine / bottom-sheet-on-coarse pattern). Hide keeps its
    `isComplete && !isReadyToPublish` guard, so it never shows on a ready tile (only published ones).
  - **Two-click delete lives in the kebab and MUST keep the menu open on the first click** (arms
    `showDeleteConfirm`; a menu that closed would swallow the confirm). The **T4050 publish-retry
    UI stays on the tile at `z-40`, never in the kebab** (a durable sync failure is when it's needed).
  - Scoped to the ready branch only: the `:379` status chip ("Done") and the `SegmentedProgressStrip`
    are suppressed; every other tile state is byte-for-byte unchanged. Multi-clip chip shifts to the
    top-right (freed by the suppressed status chip). Covered by `DraftTile.test.jsx` (re-pinned) +
    `e2e/T6180-ready-tile-primary-action.qa.spec.js`.
  - **QA gotcha (not domain, but bit this task):** the `npm run dev` vite server can serve a STALE
    per-URL transform of an edited source file across `dev-verify.sh` reuse — a fix looks broken for
    runs on end. If a real-browser result contradicts the code, kill 5173, `rm -rf
    src/frontend/node_modules/.vite`, and restart before trusting the run.

- **Published-reel tile persistent actions (T6300) — mirror when T6180 lands on `DraftTile.jsx`.**
  `ReelTile.jsx`'s ENTIRE actions cluster (Play + Copy/Share + kebab) used to sit in one
  `opacity-0 pointer-events-none` wrapper, hover/long-press-gated — invisible until discovered by
  accident, AND a functional dead end on touch-Windows (see capability-detection bullet below). Fix:
  - **Persistent primary = Play**, always mounted at `bottom-1.5 left-1.5`, never hover-gated — this
    IS the discoverability fix (no hovering needed to find a reel has actions).
  - **Kebab = corner-anchored (`top-1.5 right-1.5`), NOT always-visible on a fine pointer** (explicit
    user decision, T6300 design gate: matches DraftTile's existing hover/focus-reveal convention —
    `opacity-0 group-hover/tile:opacity-100 focus:opacity-100`). On a **coarse pointer** the SAME
    button is `opacity-100` unconditionally (no hover, no long-press) — this is the touch-Windows fix.
  - **Copy Link / Share absorbed into the kebab** (previously a third direct hover chip) per the
    T6180 house rule "main button + kebab for the rest." The bottom sheet (coarse) needed a NEW
    "Share" item added — it had never had one (mobile's only path to `onWebShare` used to be the now-
    removed inline chip); the desktop popover already listed both.
  - **NEW-dot ↔ kebab coexistence:** the unwatched dot shifts to `right-11` (stacks left of the
    44px-floor kebab) instead of overlapping it, only when `isUnwatched`.
  - Long-press (`actionsRevealed` state, touch handlers) is DELETED entirely — an always-reachable
    coarse-pointer kebab replaces it, so there is no reveal gesture left to miss.
  - **QA landmine (Chromium dynamic pointer/hover media features): a `page.screenshot()` call
    itself flips `(pointer: coarse)` → fine on a hybrid `hasTouch: true` desktop-viewport context**
    (confirmed by direct `matchMedia` probing — NOT caused by any `.click()`/`.tap()`). Order matters:
    run every coarse-pointer-dependent assertion/interaction BEFORE the first screenshot in a test:
    a screenshot taken between "read coarse-pointer state" and "click the coarse-gated element" makes
    the click land on the FINE branch instead, producing a confusing false failure that looks like the
    component regressed. See `e2e/T6300-reel-tile-persistent-actions.qa.spec.js`'s `criterion 2` test
    for the pattern (also: prefer a raw in-page `el.click()` over Playwright's `.tap()` for a coarse-
    context interaction — `.tap()` still repositions Chromium's virtual pointer for actionability
    before dispatching touch events, which can independently trigger the same flip).
  - **Capability detection**: reveal gate + menu-shell selector (bottom sheet vs desktop popover) now
    read `useIsCoarsePointer()` (live `matchMedia`), not `useWebShare().isMobile` (a UA sniff that
    misses touchscreen Windows). `useWebShare().isMobile` had NO remaining consumer once Share/Copy
    Link were both unconditionally listed, so it was dropped from `DownloadsPanel`→`ReelTile` prop
    wiring entirely (not kept "just in case" — CLAUDE.md: no dead code).
  - When T6180 ships DraftTile's ready-state kebab, keep the two tiles' formulas byte-identical
    (same `isCoarsePointer` opacity branches, same corner, same `aria-haspopup`/`aria-expanded`).
  - Covered by `ReelTile.test.jsx` (capability-gated visibility, every menu item fires, dot/kebab
    stacking) + `e2e/T6300-reel-tile-persistent-actions.qa.spec.js` (live touch-Windows repro: coarse
    pointer + non-UA-sniffed-mobile context, at-rest opacity/pointer-events read directly, every
    kebab item reachable with zero hover and zero long-press).

- **Tile inline hover preview (T6420) — the shared `TilePreviewVideo` primitive.**
  Draft + reel tiles play a muted/looping inline video on desktop HOVER (poster-first
  crossfade), instead of only a static poster. Epic child 1/3 (touch = T6430, setting
  = T6440); this child is **fine-pointer ONLY** — touch is byte-identical (DraftTile's
  long-press reveal + ReelTile's coarse kebab untouched).
  - **Two pieces, both new, both store-free** (T6320 rule — a store import would break
    the landing build via the `@editor` alias): `src/frontend/src/hooks/useTilePreview.js`
    (the activation state machine) + `src/frontend/src/components/collections/TilePreviewVideo.jsx`
    (the `<video>` + crossfade). Two consumers is below the abstract-on-3rd-dup bar, but the
    sibling tiles MUST NOT diverge (T6300 history) — same justification as T6320's shared
    progress-track primitive.
  - **Warm early, reveal late** — the intent delay gates the REVEAL, not the fetch.
    Timeline (both constants tuned in ONE place, `useTilePreview.js`
    `PREVIEW_WARM_DELAY_MS=100` / `PREVIEW_REVEAL_DELAY_MS=450`): t0 grace (a straight-line
    grid crossing fires ZERO requests) → ~100ms WARM (attach `src`, `load()`, buffer, still
    paused, poster showing) → ~450ms REVEAL (`.play()` + crossfade in on the first rendered
    frame via `requestVideoFrameCallback`, `playing` event as fallback) → leave/teardown
    (pause, `removeAttribute('src')`, `load()` — RELEASES the stream).
  - **`PREVIEW_PHASE` = { IDLE, WARM, REVEAL }.** The tile owns activation (wires
    `onPointerEnter`/`onPointerLeave` on its root, passes `phase` + `streamUrl` to the
    component). Component is pure imperative DOM control driven by `phase` — no store, no
    writes, no watched-marking, no achievements (EPIC: preview is EPHEMERAL; the real
    player's watched-marking at `DownloadsPanel.jsx:130-140` is the write path preview must
    NOT touch).
  - **Single-active registry** is module-level in `useTilePreview.js` (`activePreviewStop`):
    a tile claims the slot at WARM (force-stopping whoever was active), so at most ONE preview
    buffers/plays app-wide. Sized so T6430 reuses it as-is. `claimActivePreview` swaps the slot
    BEFORE invoking the previous `stop()`, so the loser's identity-checked `releaseActivePreview`
    is a no-op and can't recurse.
  - **Gate = `useIsCoarsePointer()`** (live matchMedia, never width/UA) AND
    `prefers-reduced-motion: reduce` (disables entirely, EPIC invariant) AND a non-null
    `streamUrl`. Coarse/reduced-motion make `onPointerEnter` an inert early-return.
  - **Stream URL** = `${API_BASE}/api/downloads/${id}/stream` (same endpoint the full players
    use via `playerReels.js`): DraftTile gates on `project.final_video_id` (no source-clip
    fallback for an unrendered draft — no preview, no error, nothing) and nulls `streamUrl`
    while the full preview modal is open; ReelTile builds it from `download.id` and calls
    `preview.stop()` on the Play button so the full player opening releases the inline stream.
  - **z-layering / no portal:** `<video absolute inset-0 object-cover pointer-events-none>`
    layered directly above the poster (implicit z-0), below scrim(z-10)/badges(z-20)/actions
    (z-30)/kebab(z-40). `pointer-events-none` keeps the T5910/T6300 hover action reveal working
    over the playing video. NEVER portaled (T5900: the tile's hover-scale transform is the
    containing block; a `fixed` child would detach — but `absolute` rides it correctly).
    `preload="none"` until warmed = grid at rest fires ZERO video requests (T6290's lesson).
  - **`muted` is set imperatively** (`v.muted = true`) before `play()` — React's JSX `muted`
    attribute is not reliably reflected to the DOM property, and muted-autoplay needs the
    property.
  - Covered by `useTilePreview.test.jsx` (gating, grace window, warm/reveal timing, registry,
    teardown), `TilePreviewVideo.test.jsx` (zero-at-rest, warm attaches src, reveal plays +
    crossfade, teardown releases, idempotency), `ReelTile.preview.test.jsx` (fine/coarse gating,
    leave-releases, Play-teardown, no-write ephemerality), and the mandatory real-browser
    `e2e/T6420-tile-preview-desktop-hover.qa.spec.js` (network-counter evidence: zero-at-rest,
    warm/reveal/leave, straight-line=0 requests, single-active, coarse-untouched,
    reduced-motion-disabled — jsdom gives false confidence, T5380).

## Perf attribution (T4770, 2026-07-09)
- **Annotate video 302→R2 is FAST live (~100ms), NOT slow.** `GET /api/games/{id}/load` and
  `GET /api/games/{id}/video` (302→presigned R2) both re-time ~90–150ms in isolation (co-timed
  `/api/health` ~80ms). In a session HAR they can show 1100–1450ms TTFB — that is **contention
  from `warmAllUserVideos()` (App.jsx:233,336)** streaming many `working_video/stream` through the
  1-vCPU Fly box concurrently, NOT endpoint work. Classic T4000 trap: re-time live before "fixing"
  `/load`/`/video`. T4000's early-src parallelization (load ∥ video) is confirmed working.
- **Home games are gated on `GET /api/bootstrap`** (`setFromBootstrap(data.games)`, App.jsx:212),
  which uses `list_games_metadata` (no presign) — the "defer presigning" suspect is ruled out
  (`GET /api/games` presigns all 6 in ~100ms live). Warm cache barely helps home → server-bound.
- **T4771 landed (2026-07-09): bootstrap PARALLELIZED, not split.** The two read groups now run
  concurrently (user.sqlite on a worker thread, profile.sqlite on the loop) — live TTFB **~657ms→~360ms
  median** (co-timed `/health` ~8ms). Single endpoint, single response shape, read-only. See
  backend-services.md § Landmines for the contextvars-into-thread detail.
- **T4771 games skeleton (perceived-perf).** `gamesDataStore.isLoading` defaults **true**; the Games tab
  renders `<GamesListSkeleton>` (ProjectManager.jsx, shell-shaped `animate-pulse` cards) instead of
  bare "Loading games..." text until the first bootstrap/fetch lands. NOTE: the opaque index.html
  preloader (App.jsx `dismissPreloader`, fires AFTER bootstrap) covers the true first paint, so the
  skeleton is seen on non-preloader games-loading transitions (profile switch, empty refetch, fallback),
  not the very first paint — the first-paint latency win comes from the shorter bootstrap. Preloader
  timing deliberately NOT moved (revealing the shell early would flash an empty header/continue-cards).
  Fix fan-out sibling: T4772 (tame the warm storm).
- **My Reels `rank/confidence` dedup (T4775).** `GET /api/rank/confidence` is read via one shared
  in-flight guard: `src/frontend/src/utils/rankConfidence.js` (`fetchRankConfidence(ratio)`, a
  `Map<ratio,Promise>` cleared on settle — mirrors `gamesDataStore._getGameInflight`). All confidence
  reads route through it: `ConfidenceBanner` (My Reels open, both ratios via `Promise.all`),
  `RankingGame` (ratio probe), `useRanking` (in-game refresh). Opening My Reels mounts only the
  banner; it reads BOTH ratios (portrait+landscape) — **2 distinct calls, both needed** (not a dup).
  The "3× rank/confidence" in the T4770 ledger was the StrictMode dev double-invoke (2 ratios × 2
  mounts = 4 in the HAR); the guard collapses each ratio's concurrent dup to one in-flight fetch,
  measured 4→2 per My Reels open (portrait once, landscape once, every run). **Prod single-mount cold
  open had no dup to remove (already 2);** the guard's prod value is defensive coalescing of genuinely
  concurrent callers (banner `refreshKey` refetch racing, banner+ranker overlap) + a single read path.
  Note: the T4770 walkthrough's `myreels:clicked→settled` is a fixed `waitForTimeout(2500)` (spec
  line 291), so it can't move with this fix — the request count is the real signal.

## Cache warming (post-T4772, 2026-07-09)
- **`warmAllUserVideos()` is NO LONGER called synchronously** on home mount / login. App.jsx uses
  `scheduleWarmAllUserVideos()` (cacheWarming.js), which defers the whole warm-all to
  `requestIdleCallback` (timeout 3s; `setTimeout` 1.5s fallback) so warming never competes with
  bootstrap + first paint + the user's first navigation.
- **Warm concurrency is hard-capped at 1** (`MAX_WARM_CONCURRENCY`, `getWorkerCount()` returns 1).
  Every same-origin warm streams THROUGH the 1-vCPU Fly bounded proxy; N-at-once starves the
  foreground. Was up to 4 (connection-type dependent); now always serialized.
- **Off-screen working (draft) videos are NOT warmed from home.** `warmAllUserVideos` no longer
  enqueues `data.working_urls` (workingQueue stays `[]`) and skips the tier-1 `has_working_video`
  branch (`continue`). Only targeted **clip ranges** (1MB head + clip region on the active game),
  `game_urls`, and `gallery_urls` warm. A draft's `working_video/stream` is fetched by the player
  when the user actually opens it; the 1KB pre-warm bought marginal edge-priming at the cost of the
  systemic storm. Working-video byte-path speed itself is T4773 (proxy TTFB / 302→R2).
- **Evidence (T4772 walkthrough, medians of 3):** warm `working_video/stream` overlapping the
  Annotate/Overlay/My-Reels foreground windows dropped **3→0** (16→0 total in HAR); overlay foreground
  stream TTFB 848→626ms. FOREGROUND_PROXY/DIRECT abort + `clearForegroundActive` resume machinery is
  unchanged — a warmed foreground video (game clip ranges / gallery) still starts fast.

## Shared player contract (T6320, post-T5130)
- **`ProgressTrack` + `PlayheadHandle`** (`src/frontend/src/components/shared/`) are the shared,
  **store-free** progress-bar primitives. `VideoControls.jsx` (the continuous scrub bar, used by
  `MediaPlayer` → `DraftTile`/`SharedVideoOverlay`, and directly by `TutorialVideoModal`) and
  `CollectionPlayer.jsx` (the segmented story-bar, used by `DownloadsPanel`/My Reels,
  `SharedCollectionView` public viewer, `RankingGame`, and the `collectionplayerdiag` dev harness)
  both compose them. **Never import a store inside either primitive** — `VideoControls` is
  transitively pulled into the **landing build** via the `@editor` Vite alias, so a store import
  there breaks that build.
- **Parameterize, not converge**: `ProgressTrack` takes full `trackClassName`/`fillClassName`/
  `trackStyle` strings (not semantic color/height tokens) because the two surfaces' markup
  genuinely differs (fill positioning/rounding, `overflow-hidden` clipping). Each caller keeps its
  exact current visual look; this was an explicit design-gate decision, not an oversight — do not
  "clean up" the two surfaces onto one visual treatment without a fresh gate.
- **Nesting rule**: `PlayheadHandle` may nest as a `ProgressTrack` child ONLY when that track has no
  `overflow-hidden` (`VideoControls`). When the track clips (`CollectionPlayer`'s segments), render
  `PlayheadHandle` as a **sibling** in the same positioned ancestor instead — nesting it inside would
  clip the ball at a segment boundary instead of letting it overflow (approved: allow overflow,
  don't clamp).
- **My Reels' handle is prop-gated**: `CollectionPlayer` takes an optional `handleGlyph` prop and
  renders `PlayheadHandle` on the **active segment only**, only when present. `DownloadsPanel`
  resolves it the same way `ProfileSportButton` does — `profiles.find(p => p.id ===
  currentProfileId)?.sport` → `sportEmoji(sport)` — and passes `undefined` for an unset profile
  sport (no handle at all). The public share viewer, RankingGame, and the diag harness deliberately
  never pass this prop, so they render byte-identical to pre-T6320.
- Characterization tests (`VideoControls.characterization.test.jsx`,
  `CollectionPlayer.characterization.test.jsx`) pin the byte-identical track/fill/handle markup for
  both surfaces — keep them green through any future player-polish change; they're the regression
  guard against the two bars silently drifting apart again.

## Active/upcoming work
- ~~**T4220**~~ DONE 2026-07-11 (speed re-index).
- ~~**T4260**~~ DONE 2026-07-11 (reactive PATCH removed; clears way for T4290 ESLint guardrail).
- ~~**T4270**~~ DONE 2026-07-11 (saveAnnotations + PUT endpoint deleted; DELETE /dedupe/{id} fixed to use cascade cleanup, not deleted).
- **T4320** (Durability epic): `Depends(durable_sync)` on `/clips/raw/save` + finalize —
  annotation saves currently ride fire-and-forget R2 sync (0.5s deferral); machine replacement can
  revert a whole toasted session.
- **T4340**: canonicalize segments_data at write time + migration rewriting existing rows (tuple
  row-factory gotcha); readers then stop normalizing.
- **T4500** (Editor Decoupling, audit D5): annotate API data (gameVideos/tags/share) →
  gamesDataStore selectors; **T4440** deletes `annotateHasSelectedClip` + its reactive writer.
