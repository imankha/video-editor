# T11300 Reel Builder - UI Proposal (decisions RULED 2026-10-20; decision 4 overridden: cut default, fade available)

Sources studied: `ProjectManager.jsx` (tab bar :1637-1674), `PublishedReelsPanel.jsx`, `collections/ReelTile.jsx`, `collections/CollectionHeader.jsx`, `collections/CollectionsTab.jsx`, `collections/CollectionPlayer.jsx` (`actionBar` slot :53), `introcards/IntroStoryPlayer.jsx` + `CompositeScrubber`, `CollectionShareModal.jsx`, `LinkReadyCard.jsx`, `DraftReelPreview.jsx` (phase machine), `shared/CtaBar.jsx` (`layout="modal"`), `.claude/references/ui-style-guide.md`, the deleted `GameClipSelectorModal.jsx` (surviving copy at `C:\work\tasks\t8630\src\frontend\src\components\GameClipSelectorModal.jsx`), `routers/collections.py` (Decision 4: collection downloads are free, no credit debit), `modal_functions/video_processing.py::stitch_members`, `services/ffmpeg_concat.py::concat_segments`, `services/serve_time_video.py::compose_serve_time_dispatched`.

Vocabulary used throughout: a single finished product is a **highlight**; the assembled product is a **highlight reel** (short form **Reel** in controls). Never "reel" for one highlight.

---

## 1. Entry point

| Option | Where "New reel" lives | Pro | Con |
|---|---|---|---|
| A. Fourth **Reels** tab after Finished | Tab body: TabGuideHeader + primary CTA (same shape as Games tab's Upload game block) | Matches the user's words ("Reels comes AFTER Published"); reels have their own lifecycle (not exported / exported / changed) that a mixed Finished list would muddle; the 4-tab bar already shipped (T8555) and worked at 390px | One more tab; retired `/home/reels-in-progress` path must NOT be reused (dead deep link) and `/home/reels` is already the Clips tab path (frozen), so the new path is `/home/highlight-reels` |
| B. Button on Finished tab + reels listed as a "Reels" group inside Finished | Zero IA change | Reels are a different object with a stale state; Finished tiles carry rank badges and ranking game that do not apply to reels; the tab count badge becomes ambiguous | |
| C. Multi-select mode on Finished tiles ("Select" -> tap tiles -> "Make reel") | Feels direct | Reverses T5678 (batch Select mode was deliberately removed); selection across game carousels with hidden ratio rows is error-prone; no place to resume a half-built reel | |

**Recommendation: A.** Tab order Games / Clips / Finished / Reels (the pipeline reads left to right). `grid-cols-4` below `sm` (icon-over-label, as T8555 shipped), `SegmentedTabButton` with `Icon={Clapperboard}`, `label="Reels"`, count = number of reels, `activeBg` = a new `REELS.bg` token (reuse `PUBLISHED` tint family; do not add a new accent). The Reels tab body with zero reels renders the shared `EmptyTabGuide` pattern: headline "Stitch your best highlights into one reel", body "Pick finished highlights, put them in order, add a title. Great for coaches and recruiting.", primary CTA **New reel** (locked with `lockedReason` "Finish a highlight first" when `publishedCount === 0`, `aria-disabled`, never `disabled`).

---

## 2. Screens (recommended flow)

Container for (a) and (b): one full-viewport takeover, `fixed inset-0 ${Z.MODAL} bg-gray-900 flex flex-col` on mobile; at `sm`+ a centered `bg-gray-800 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[92vh]` dialog on `bg-black/60 backdrop-blur-sm`. Header `px-4 py-3 border-b border-gray-700 flex items-center justify-between`: step title `text-lg font-semibold text-white`, step indicator `text-xs text-gray-500` ("Step 1 of 3"), X close (`text-gray-400 hover:text-white p-1`). Esc and X only; **no backdrop close**. Footer `px-4 py-3 border-t border-gray-700` holds `<CtaBar layout="modal">`. A `GuideScope` wraps the takeover so a Guide card can point at the primary.

### (a) Pick highlights

**Layout 390px:** header; ratio segmented pill (`Portrait | Landscape`, lucide `RectangleVertical`/`RectangleHorizontal`, selected `bg-blue-600 border-blue-500`, default = ratio with more finished highlights, tie -> Landscape); borderless filter rows (uppercase `text-[11px] text-gray-500` label + chips `px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded`): **Game** chips with counts, **Tag** chips with counts, a **Top ranked** chip (rank <= 20). Then the grid: `grid grid-cols-3 gap-2` for portrait, `grid-cols-2` for landscape; sticky footer.
**Desktop:** same, grid `sm:grid-cols-4` / landscape `sm:grid-cols-3`; filters in one wrapping row.

**Selectable tile** (new `SelectableHighlightTile`, built from ReelTile's poster idiom, no kebab, no hover-scale):
```jsx
<button type="button" role="checkbox" aria-checked={selected} aria-label={`${name}, ${length}`}
  className={`group/tile relative aspect-[9/16] rounded-lg overflow-hidden bg-gray-800 border transition-all duration-150
    ${selected ? 'border-cyan-400 ring-2 ring-cyan-400/60' : 'border-gray-700'}`}>
  <img loading="lazy" src={`${API_BASE}/api/downloads/${id}/poster.jpg`} className="absolute inset-0 w-full h-full object-cover" />
  {/* skeleton-shimmer while loading; branded gradient fallback on 404 (ReelTile pattern) */}
  {seasonRank <= 20 && <span className="absolute top-1.5 left-1.5 z-20 px-2 py-0.5 bg-cyan-500/90 text-black text-xs font-bold rounded-md">#{seasonRank}</span>}
  <span className={`absolute top-1.5 right-1.5 z-20 w-6 h-6 rounded-full border-2 flex items-center justify-center
    ${selected ? 'bg-cyan-500 border-cyan-500 text-slate-950' : 'bg-black/40 border-white/70'}`}>
    {selected && <Check size={14} />}
  </span>
  <div className="absolute inset-x-0 bottom-0 z-10 px-2 pt-8 pb-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
    <h3 className="text-white text-xs font-medium line-clamp-2">{name}</h3>
    <span className="text-[11px] text-gray-300">{gameShort} · {length}</span>
  </div>
</button>
```
The check ring is **always rendered** (discoverable-never-hover-only rule). A separate 32px `Play` chip (`bg-black/60 backdrop-blur-sm rounded-full coarse-pointer:min-h-[44px]`) bottom-right opens the existing single-reel `CollectionPlayer` (the DraftReelPreview one-reel pattern) so a parent can check a highlight before adding it; it `stopPropagation`s. Selected order is shown as a small ordinal in the check circle when > 1 selected (replaces the Check), so the user sees pick order will become play order under "Custom".

**Sticky footer (live totals card, salvaged):** `flex items-center justify-between` left: `Film` icon + `text-2xl font-bold text-white` count + `text-sm text-gray-400` "highlights", `Clock` + total via `formatLength(total, PRECISION.SECOND)` (hours case handled by `utils/timeFormat`). Right: `<CtaBar layout="modal" primary={{title: 'Arrange (7)', disabled: count === 0}} exit={{title: 'Cancel'}} />`. Total turns `text-yellow-300` with a `title`/caption "Over 5:00. Coaches rarely watch past the first minute." when above the advisory.

**States:** loading = skeleton grid (6 shimmer tiles, same grid class); empty for current ratio = "No Landscape highlights yet" + chip to switch ratio; zero after filters = "Nothing matches these filters" + "Clear filters" link; a highlight currently downloading or restoring is still selectable.

### (b) Arrange

**Layout 390px:** header "Arrange"; name input (style-guide text input) seeded by the salvaged `suggestedName` + `ensureUniqueName` (auto until edited; no "(auto)" chip, just the hint `text-xs text-gray-500` "Named from your games"); sort control (segmented `Best first | Game date | Custom`); the **ordered list**; a settings block; sticky footer with totals + `primary: 'Preview'`, `exit: 'Back'`.
**Desktop:** `lg:grid lg:grid-cols-[minmax(0,1fr)_320px]` with the list left and the settings block as a right column (SettingsRail idiom, no accent color).

**Member row** (`min-h-[64px] px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg flex items-center gap-3`): grip (`GripVertical` 16px in a 44x44 `touch-none` hit box, `text-gray-500`, always visible), ordinal `text-xs tabular-nums text-gray-400 w-5`, poster thumb (`w-9 aspect-[9/16]` or `w-16 aspect-video`, `rounded object-cover`), `flex-1 min-w-0`: name `text-sm text-white truncate` + `text-xs text-gray-400` "{game} · {length}", trailing kebab (`MoreVertical`, 44px coarse) with Move to top / Move up / Move down / Remove. Dragging row: `shadow-lg ring-2 ring-cyan-400/60 scale-[1.02]`; drop target: a 2px `bg-cyan-400` line between rows (same accent as the timeline playhead family, not a new color). Any manual move flips the sort to Custom.

**Joint affordance** between rows (only when "text frames" is on, see settings): a 28px-tall dashed slot `border border-dashed border-white/25 rounded-lg text-purple-200/80 text-xs flex items-center justify-center gap-1 hover:bg-white/5` reading `+ Add text frame` (the style guide's empty-slot pattern: dashed border plus `Plus` icon, not color alone). Tapping it inserts a **text frame row**: icon tile `w-8 h-8 rounded-lg bg-white/5` with lucide `Type`, inline input "Title line" (`maxLength 40`), second optional input "Subline" (`maxLength 60`), fixed 2.5 s badge, X remove. Text frame rows are draggable like members.

**Settings block** (`SettingRow` pattern, grouped "Reel"): **Transition** (`Cut | Fade`), **Title card** (`IntroCardCarousel` with the profile's cards; "None" allowed), **Text frames** toggle (reveals joint affordances), **Outro** read-only line "Reel Ballers outro" (branded outro is always appended, as today's stitched download).

**States:** a member deleted since the pick (lookup returns 404) renders the row with `opacity-60`, an amber `AlertTriangle` + "This highlight was deleted" and only Remove in its kebab; Preview is locked (`lockedReason` "Remove the deleted highlight first") while any such row exists.

### (c) Review and export

Reuse `IntroStoryPlayer` exactly as Finished's Play all: `intro` = chosen title card payload (same `/api/collections/intro-playback` shape), `reels` = members in order via `toPlayerReel`, the composite scrubber shows one segment per member. Text frames are rendered in the preview as 2.5 s static image segments (new `TextFramePreRoll`, an `IntroPreRoll` sibling fed by a server-rendered PNG from the same card compose; v1 fallback: a DOM card `bg-gray-900` with the text centered, if the PNG route is out of scope). Fade transitions are **not** previewed in-app; a `text-xs text-gray-400` line under the scrubber says "Fade between highlights is added when you export."

`actionBar` slot: `<CtaBar layout="inline" primary={{title: 'Export reel'}} exit={{title: 'Back to arrange'}} />`. Phase machine copied from `DraftReelPreview`: `idle -> exporting -> ready | failed`. **Exporting:** primary swaps to `Loader` + "Building your reel..." and a `statusBanner` cyan strip "Stitching 7 highlights. Usually under a minute." with a spinner, never a fake progress bar (CollectionHeader T7050 rule: no byte progress exists during compose). **Failed:** amber strip "Could not build this reel." + the same primary relabelled **Retry**. **Ready:** closes the takeover, lands on the Reels tab with the new tile first and a `JustPublishedCard`-style highlight ring on it.

### (d) Result (Reels tab tile)

Reuse `ReelTile` with a `variant="reel"`: same poster (the exported final video's poster endpoint), meta line "7 highlights · 2:48", persistent center **Play** + labeled **Share**; kebab: Download, Share, Copy link, **Edit reel**, Rename, Delete. No rank badge, no intro badge, no Re-rank, no Open as Draft, no Move to profile in v1. Play opens `CollectionPlayer` with the single exported MP4 (what the share recipient sees), not the live members. Share uses the existing per-video `ShareModal` (the export creates a `final_videos` row, so poster/stream/share/download plumbing is free).

**Tile states:** `Not exported` (a draft reel): `bg-yellow-900/70 text-yellow-300` top-left chip "Not exported", primary becomes `Pencil` **Continue**; `Changed` (a member was re-exported or deleted after export): same chip style reading "Changed", kebab gains **Re-export**, Play/Share still serve the last export (the link must match the video). Tab-level empty state as in section 1.

---

## 3. Decisions for the user

1. **Entry point.** (a) Reels tab, (b) button on Finished, (c) multi-select on Finished. A fourth tab costs 25% of the bar width on phones but gives reels a home with their own states; (c) reverses T5678. **Recommend (a).**
2. **Selection model.** (a) checkbox tiles with client-side filter chips as a pure view (payload = explicit ordered ids), (b) filter-driven definition like the old picker (filters are the membership, with exclusions), (c) drag into a tray. (b) recreates the dual client/server filter gotcha and makes the result a query; (c) is poor on a 390px screen. **Recommend (a).**
3. **Ordering default.** (a) rank order with manual override (Best first default, Custom on any drag), (b) pick order, (c) game-date order. Rank order delivers the "hook in the first 3 seconds" rule from the spec; pick order rewards careful tapping but most parents tap in scroll order. **Recommend (a)** with the three-way sort control.
4. **Transitions.** (a) hard cut only (today's `concat_segments`, stream-copy fast), (b) cut + fade to black (per-member fade in/out before concat, keeps the demuxer, modest new ffmpeg work), (c) crossfade/dissolve (`xfade`, full re-encode, overlap shifts every duration; Modal never did this). **Recommend (b)** as one reel-level setting; per-joint choice and dissolve deferred.
5. **Text frames.** (a) none, (b) title card only (existing intro card pre-roll, zero new compose), (c) title + between-clip text frames via the same card compose with a new minimal "section card" template (title + subline, 2.5 s). (c) is what makes a recruiting reel ("Goals", "Defending", "Set pieces") and reuses `compose_serve_time_dispatched`; the new cost is the template plus in-preview rendering. **Recommend (c)**, behind the Text frames toggle so the simple path stays simple.
6. **Cost and duration cap.** Collection stitches are already free (collections.py Decision 4) and every input was paid for at upscale. (a) free, soft advisory at 5:00, hard technical cap 15:00 / 40 highlights; (b) free, hard cap 5:00; (c) charge per stitch. Charging for a cut+concat of paid inputs reads as double billing; a hard 5:00 cap blocks the long "full season" reel some parents want. **Recommend (a)**, no cost line in the CtaBar.
7. **Membership: live vs frozen.** (a) frozen `final_video_id` list (a re-export silently orphans the member), (b) members keyed to the highlight's stable project id, with a **Changed** state when the current final video differs from the one stitched, and Re-export as the gesture, (c) live query like collections (reel re-stitches itself). (c) violates gesture-based persistence; (a) loses members. **Recommend (b).**
8. **Draft persistence.** (a) builder state in memory only (lost on reload), (b) a reel row created on the Arrange gesture, every reorder/text/transition change a surgical POST, no save copy anywhere, drafts shown on the Reels tab as "Not exported". A phone user who gets a call mid-arrange loses ten minutes under (a). **Recommend (b).**
9. **Mixed ratio.** (a) ratio pill first, other-ratio highlights hidden, (b) allow mixing with letterbox/pillarbox to the chosen ratio, (c) mixing with auto crop. Mono-ratio is the collections rule and keeps the stitch a stream copy; (b) is a later toggle ("Include landscape, letterboxed"). **Recommend (a)** with the empty-state chip to switch ratio.
10. **Where the result lives.** (a) Reels tab, (b) Finished tab as a tile, (c) both. Follows decision 1; (c) double-lists and confuses the Finished count. **Recommend (a).**
11. **Mobile reordering gesture.** (a) always-visible grip handle with immediate pointer-capture drag on the handle only (`touch-none` on the handle, list scrolls normally elsewhere) plus kebab Move up/down/top, (b) up/down buttons only, (c) long-press anywhere on the row. Long-press fights scroll and is undiscoverable; buttons alone are slow for 15 rows. **Recommend (a)**, Pointer Events per the timeline drag pattern.
12. **Preview fidelity.** (a) preview plays members in order with text frames as static segments and a caption that fades are export-only, (b) server renders a low-res preview stitch before export (adds a wait before every tweak). **Recommend (a).**

---

## 4. Reuse map

| Screen | Reused | Genuinely new |
|---|---|---|
| Tab | `SegmentedTabButton`, `TAB_PATHS` + `HOME_TAB_PATHS`, `EmptyTabGuide` / `TabGuideHeader`, `SECTION_NAMES.REELS` (exists, renders nowhere) | Reels tab body (`ReelsPanel`), path `/home/highlight-reels`, `REELS` theme token |
| Pick | ReelTile poster idiom (lazy img, shimmer, branded fallback, scrim), borderless filter rows, `useCollections` members (frozen `aspect_ratio` / `tags` / `duration` per spec 2.1), rank badge, `CollectionPlayer` single-reel preview, `formatLength`, `CtaBar layout="modal"`, `GuideScope` | `SelectableHighlightTile`, `HighlightPicker` step, live totals footer (ported from the deleted modal) |
| Arrange | style-guide input, `SettingRow` / `SettingsPanel` grouping, `IntroCardCarousel` for the title card, `suggestedName` + `ensureUniqueName` (resurrect `GameClipSelectorModal.suggestedName.test.jsx`), timeline Pointer-Events drag pattern, empty-slot dashed pattern, kebab shell from ReelTile | `ReelMemberList` with drag reorder, `TextFrameRow`, reel draft endpoints (surgical) |
| Review and export | `IntroStoryPlayer` + `CompositeScrubber`, `CollectionPlayer` `actionBar` / `statusBanner` slots, DraftReelPreview phase machine, `toPlayerReel`, `stitch_members` + `concat_segments` + `compose_serve_time_dispatched` + branded outro + T4947 cache | `TextFramePreRoll`, section-card template, fade step in the stitch, `POST /api/reels/{id}/export` |
| Result | `ReelTile` (variant), `ShareModal`, `LinkReadyCard`, `useDownloads` (download, rename, delete), poster/stream endpoints via a `final_videos` row, `JustPublishedCard` landing ring | `reels` table (members, order, transitions, text frames, exported `final_video_id`), stale detection, Edit reel re-entry |

Flagged while reading: `CollectionHeader` still shows a `Clock` "Max Duration" menu item and ReelTile's menu has grown past 360px (T7730 measured flip); nothing here depends on either, but the reel kebab should start from the smaller MenuItem set, not inherit all of ReelTile's.

**Rulings 2026-10-20: every recommendation accepted except decision 4 (user: hard cut default, fade as the customization). Rulings table lives in T11300-reels-v2-post-publish-stitcher.md. Architect gate still required before implementation.**
