---
domain: annotate
updated: 2026-08-01 (T5695 adding a sport now has a CROSS-REPO landing-site mirror — see "Adding a sport" below; T5700 team/my-athlete layer + two-lane timeline follow-up; T5710 per-layer recap tabs)
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
  `games.py:_compute_storage_status(expires_at_val, auto_export_status)` — the single source of
  truth shared with `list_games` (game_storage expiry passed, OR no ref but `auto_export_status`
  set = source deleted post-grace). `applyGameData` maps it to `annotateSourceExpired`.
- **One annotation = one `raw_clips` row** (per-user SQLite, not Postgres). Region shape:
  `{id, rawClipId, startTime, endTime, name, tags, notes(≤280), rating(1-5, default 4),
  videoSequence, tagged_teammates, my_athlete, autoProjectId}` (useAnnotate.js:10-30, constants
  L209-213). Natural key everywhere: `(game_id, end_time, video_sequence)`.
- **Gesture persistence** (ClipDetailsEditor → `updateClipRegionWithSync`, AnnotateContainer:832-948):
  - create → `POST /api/clips/raw/save` (`save_raw_clip`, clips.py:911) — idempotent on the natural
    key; new rows have empty `filename` until extraction. **T4175**: for a game clip that reaches
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
- Playhead: `POST /{game_id}/playhead` (direct overwrite) on tab-hide/pagehide with `keepalive`
  (AnnotateContainer:1206-1222); `POST /{game_id}/finish-annotation` sets
  `viewed_duration = MAX(...)` high-water.

## Invariants & rules
- **segments_data dual format** (working_clips.segments_data, msgpack): gesture `split_segment`
  stores **splits-only** boundaries (no 0, no duration — clips.py:466-481) while PUT full-state
  stores the **full list** `[0, ...splits, duration]`. Every consumer MUST call
  `canonicalize_segments_data` (`src/backend/app/highlight_transform.py:87-131`; detects format by
  `boundaries[0] <= 0.01`) before walking boundary pairs — `segmentSpeeds` is keyed by interval
  index over the FULL list, so walking splits-only pairs shifts every speed by one (Bug 20p:
  slow-mo/realtime swapped). Callers: export/framing.py:456, export/multi_clip.py:1925/2092.
  **Non-caller (latent)**: export/overlay.py:1307-1320 reads raw and uses `boundaries[-1]` as
  duration. T4340 moves canonicalization to write time.
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
- **New-clip layer is INHERITED, not toggled (T6400 — supersedes T5700's "Surface (a)").** The
  "New clips go to:" mode toggle in the `ClipsSidePanel` header was REMOVED (it cost sidebar space
  for little value). A new clip now defaults to the LAST layer the user assigned. `newClipLayerIsMine`
  is still the ephemeral, screen-owned boolean in `useAnnotateState.js` (never persisted), but its
  setter is now internal to `AnnotateContainer` and driven by GESTURES, never a control:
  resolution order — (a) the last layer assigned this session (creating a clip via
  `handleFullscreenCreateClip`, or changing a clip's layer via `updateClipRegionWithSync` — both
  call `setNewClipLayerIsMine` imperatively; the switch path IGNORES imported clips, `shared_by`
  set, whose Team layer is forced and expresses no intent); else (b) on game open, seeded from the
  game's most recently created OWN clip (`resolveInheritedNewClipLayer(gameData.annotations)`,
  exported from `useAnnotate.js` — highest raw_clip `id`, skipping `shared_by` clips, legacy-NULL
  rule for the layer read); else (c) My Athlete for a game with no own clips. Still reset per game
  open (via 2b) and NEVER via a state-watching effect (the banned reactive shape — it would also
  fight the user mid-edit). No sessionStorage, no DB column, no backend change.
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
  those on `my_athlete = 1`); already-published reels are unaffected. Migrations do NOT auto-run --
  hit `POST /api/admin/migrate` per env. Covered by `ClipDetailsEditor.teammates.test.jsx`,
  `AnnotateFullscreenOverlay.teammates.test.jsx`, `test_t5725_reclassify_teammate_clips.py`, and
  `e2e/T5725-teammates-team-only.qa.spec.js`.
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
  `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`). The older `GameCard`/`GameMetaRow`/`RatingChip`
  list component was fully removed (T5990) — it had been dead since T5681 but its Vitest specs still
  rendered it directly and passed green, which masked real drift: `T5675-home-hero-legibility.spec.js`
  asserted `Uploaded`, `Footage quality N/100` and the rating chips that live only in `GameMetaRow`,
  so the E2E broke while the unit tests stayed green. Lesson: a component only reachable from its own
  tests is dead, not covered. The tile's verbose meta row is GONE by design — the scrim shows only
  name + short date + clip count; all game actions live behind the tile's kebab menu. NOTE the tile
  gates the recap entry on `recap_video_url` (hasRecap), NOT on clip_count, and shows no recap entry
  for an expired game with no recap video — a deliberate divergence from the old GameCard.
  Covering specs: `GameTile.test.jsx`, `GameTile.posterUrl.test.jsx`, `T5681-games-poster-grid.spec.js`.

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
