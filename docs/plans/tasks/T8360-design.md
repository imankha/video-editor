# T8360 — Design: Split single-clip vs multi-clip drafts into separate views

**Status:** APPROVED — implementation in progress. 2026-09-02.
**Author:** UI Designer agent, 2026-09-02
**Depends on / consistent with:** T8130 approved naming table (Plays / Clips / Highlight Reels),
T8070 `auto_project_id` + `reel_source_*`, T8350 (queued next — this doc only reserves its landing spot).

---

## 0. Decisions Taken (user ruling, 2026-09-02)

**Design APPROVED.**

**OQ-1 (§10) = Option A (recommended).** In-progress "Highlights" live as a section on the
Highlight Reels panel (`DownloadsPanel`), with the "Create Highlight Reel" button relocated
there, exactly as §3.1 Q3 / §4.2 specify. Home stays two tabs (Games | Clips).

**Rename ruling — STOP the `auto_project_id` clearing on rename.** The user required renaming
a single-clip draft to NEVER move it between surfaces (no teleport Clips → Highlights). Investigated
whether `UPDATE raw_clips SET auto_project_id = NULL WHERE auto_project_id = ?` in
`update_project` (`projects.py:988-990`) serves either candidate live purpose before removing it:

1. **"Freezes a user-chosen name against auto-naming regeneration"? NO — dead since
   commit `73291399` (2026-05-06), pre-dates this task.** That commit deleted the
   `is_auto_created` branch from `getProjectDisplayName` (`clipDisplayName.js`) specifically
   because it was overriding a user's rename by re-deriving "Brilliant Interception" from
   clip rating+tags on every render. `project.name` is now the unconditional single source of
   truth for display, auto-created or not. The comment left on `projectsStore.js:234-236`
   ("clear is_auto_created so getProjectDisplayName returns the user-chosen name") describes
   behavior that no longer exists — stale by omission, not by intent. This purpose is gone;
   nothing to decouple.
2. **T4800 draft-dies-with-clip lifecycle? NO — the clearing actively BREAKS it, it does not
   serve it.** `delete_raw_clip` (`clips.py:1521-1531`) reads `raw_clips.auto_project_id`
   FRESH from the DB at delete time and only calls `_delete_auto_project` (T4800's cleanup)
   when that link is still set. Once rename clears the link, deleting the draft's last source
   clip no longer invokes cleanup AT ALL — the renamed draft survives forever as a **0-clip
   orphan**, which is exactly the bug class T4800 exists to eliminate. So today, renaming an
   auto-draft silently disables its own T4800 cleanup; it is a live bug, not a feature to
   preserve.

**Conclusion: no decoupling needed — there is no live purpose to keep.** Both backend
(`projects.py:986-990`) and the mirrored frontend clear in `projectsStore.js:234-238`
(`renameProject`, which also sets `is_auto_created: false` locally) are removed outright.
Renaming now only updates `name`; `is_auto_created` / `raw_clips.auto_project_id` are untouched
by rename, so routing (by `is_auto_created`, per §3 "The signal we can trust") never flips on
rename.

**Bonus fix (side effect of the same root cause):** `update_raw_clip`'s create-reel dedup
(`clips.py:1427-1436`) also reads live `raw_clips.auto_project_id` to decide whether "Create
Reel" on an already-drafted clip should reuse the existing auto-project or mint a new one. With
the clearing removed, re-tapping Create Reel on a renamed clip now correctly reuses its existing
draft instead of silently minting a duplicate second draft (previously masked by the same stale
link this task removes).

**Accepted consequence (explicit, per user instruction):** with the clearing removed, a renamed
single-clip draft **still dies with its source clip per T4800** — `is_auto_created` and the
`raw_clips.auto_project_id` link persist for the draft's whole lifetime regardless of rename, so
deleting its one source clip deletes the draft same as before. This is consistent with a renamed
single-clip draft staying a **Clip** (never promoted to a standalone multi-clip Highlight by the
act of renaming) and is fine by default — no user-facing change to when a Clip disappears, only
a fix to where it lives while it's alive.

**Implementation scope added by this ruling:**
- `src/backend/app/routers/projects.py` — delete the `UPDATE raw_clips SET auto_project_id = NULL ...` block from `update_project` (~L986-990).
- `src/frontend/src/stores/projectsStore.js` — `renameProject` (~L218-239): stop setting `is_auto_created: false`; only `name` changes in the optimistic local update.
- No migration needed (no schema change, behavior-only).

---

## 1. One-line recommendation

**Rename the existing single Home tab in place: `Reel Drafts` → `Clips`, keep it as the
single-clip surface, and MOVE the multi-clip world (the "Create Highlight Reel" assembly button
+ its resulting multi-clip drafts) onto the existing Highlight Reels surface (`DownloadsPanel`) as
an in-progress "Highlights" section above the published reels — so Home stays a two-tab structure
(Games | Clips) and the "Highlights → Highlight Reels" lifecycle lives together on one surface.**

---

## 2. Current state

### Home IA today (verified in `ProjectManager.jsx`)
- Home has exactly TWO tabs, styled like `ModeSwitcher` (`ProjectManager.jsx:1150-1191`):
  - **Games** — `/home/games`, id `games`.
  - **Reel Drafts** — `/home/reels`, id `projects`, label `SECTION_NAMES.DRAFTS` (`displayNames.js:2`).
- Tab is URL/session state only, never persisted (`tabFromPath`, `:361-368`; `setActiveTab`
  `replaceState`, `:433-439`). No persisted-view-state migration exists to worry about.
- **Highlight Reels** is NOT a Home tab. It is the published surface = `DownloadsPanel`, opened via
  the fixed top-right `onOpenDownloads` button (`:1035-1051`), header `SECTION_NAMES.LIBRARY`
  (`DownloadsPanel.jsx:722`).

### The Reel Drafts tab is genuinely two content types in one list
- **Single-clip auto-drafts:** created by tapping "Create Reel" on one clip (T8070
  `auto_project_id`). Backend flags them `is_auto_created = true` — computed as
  `EXISTS(SELECT 1 FROM raw_clips rc WHERE rc.auto_project_id = p.id)` (`projects.py:361-364`).
- **Multi-clip assembled drafts:** created by the "Create Highlight Reel" button (`:1205-1215`,
  renamed from "New Reel" by T8130) → `GameClipSelectorModal` multi-select → `POST /projects/from-clips`,
  which lands back on this SAME tab (`handleProjectCreated`, `:992-1003`; `is_auto_created = false`).
- Today disambiguated only by a `Layers` "Contains N clips" badge when `clip_count > 1`
  (`DraftTile.jsx:534-548`), a "sort last" comment (`ProjectManager.jsx:689-693`), and the
  **Created By: Auto / Custom** filter chips (`:1523-1546`, backed by `is_auto_created`,
  `filteredProjects` `:522-526`).
- Dead-end guard: `reelDraftsDisabled = !loading && !gamesLoading && projects.length===0 && !hasClips`
  (`:426-427`); disables the tab (`:1171-1172`) and bounces `activeTab` back to Games (`:885-889`).

### The signal we can trust
`is_auto_created` (auto_project_id link) is the authoritative "this is a single-clip auto-draft"
flag and is ALREADY computed on every project row and shipped to the client. It is the clean
routing key for the split — NOT `clip_count > 1` alone (an auto-draft is conceptually single-clip
even in the T4800 window before its last source clip is deleted; and a `from-clips` project with
one selected clip is conceptually a Highlight, not an auto-draft). **Route by `is_auto_created`,
not by `clip_count`.** `clip_count` remains the display badge only.

### Naming state after T8130 (binding)
| Concept | String today | Source of truth |
|---|---|---|
| Per-clip work | (n/a as tab) | approved vocabulary: **"Clips"** |
| In-progress multi-clip assembly | "Reel Drafts" (mixed) | user 2026-09-02: **"Highlights"** |
| Published multi-clip video | "Highlight Reels" | `SECTION_NAMES.LIBRARY` |
| Assembly button | "Create Highlight Reel" | `ProjectManager.jsx:1213` |

---

## 3. Target state

### 3.1 Resolved open questions

**Q1 — IA shape: rename the existing tab in place; do NOT add a third Home tab.**
Home stays **Games | Clips** (two tabs). The multi-clip surface is not a third Home tab — it moves
to the already-existing Highlight Reels surface (`DownloadsPanel`). Justification:
- A third Home tab (Games | Clips | Highlights) breaks the deliberate two-tab `ModeSwitcher`
  symmetry, adds a second dead-end-tab problem to solve (`reelDraftsDisabled` currently guards one
  tab), and splits the "Highlights → Highlight Reels" lifecycle across two surfaces (a Home tab AND
  the Downloads panel) — the exact commingling smell this task exists to remove, relocated one level
  up. The user's naming decision ("Highlights" pairs with published "Highlight Reels") is itself the
  argument for co-locating them: in-progress and published multi-clip reels belong on ONE surface.
- Home tab id stays `projects` and URL stays `/home/reels` (avoids touching `tabFromPath`,
  `initialTab`, the tab-hint path, and every e2e deep-link) — **only the LABEL changes** to `Clips`.

**Q2 — single-clip auto-drafts stay a drafts-style surface, renamed "Clips", NOT a new per-clip
Focus/Overlay stage editor.** They keep the exact `DraftTile` + stage-carousel rendering they have
today (poster tile, `SegmentedProgressStrip` deep-link into Focus/Overlay, By Phase / By Game
toggle). Justification: the tiles ALREADY expose per-clip Focus/Overlay stage progress via the
segmented strip and stage rows (`DraftStageRows` / `groupedByPhase`); building a parallel
`ClipDetailsEditor`-style control would duplicate that pipeline surface for no new capability and is
out of scope. The change here is subtractive (remove the multi-clip entries + the now-redundant
Created-By filter) + a rename, not a new editor.

**Q3 — the assembly flow AND multi-clip "Highlights" drafts both move to the Highlight Reels
surface.** "Create Highlight Reel" (the `GameClipSelectorModal` entry) relocates from the Clips tab
onto `DownloadsPanel` (matching T8130's approved table row "Assembly button location → moves to the
Highlight Reels surface"). The multi-clip drafts it produces render on that SAME surface, in a new
**"Highlights" (in-progress)** section that sits ABOVE the published Highlight Reels list.
- **"Highlights" vs "Highlight Reels" boundary (settled):** *Highlights* = in-progress multi-clip
  assemblies (`is_auto_created = false`, unpublished). *Highlight Reels* = published (`is_published`).
  They live on one surface (`DownloadsPanel`) as two stacked sections of the same lifecycle. The word
  "Highlights" is a SECTION HEADING on that surface, not a new Home tab and not a rename of the
  published `SECTION_NAMES.LIBRARY`.
- **Assembly-flow copy scope:** the button KEEPS "Create Highlight Reel" (approved, unchanged). The
  `GameClipSelectorModal` internal copy ("Create a project from library clips", "Select games")
  is out of scope for the string sweep except where it literally says "project"/"reel draft" in
  user-facing headings — see §6 sweep list. "Highlights" does NOT extend into the modal's field
  labels (avoids churn; the modal already reads as reel assembly).

**Q4 — transition + empty states:** existing mixed drafts self-route by `is_auto_created` with zero
migration (both surfaces read the same `projects` array, already client-side). See §5.

**Q5 — T8350 landing spot:** reserved on the Clips-tile scrim and on the new Highlights tile. See §7.

### 3.2 Surface map (target)

```
HOME (two tabs, unchanged structure)
├── Games            /home/games   id=games
└── Clips            /home/reels   id=projects   ← was "Reel Drafts"
        renders ONLY projects where is_auto_created === true
        (single-clip auto-drafts; DraftTile + stage rows, unchanged tile chrome)
        NO "Create Highlight Reel" button here anymore
        NO "Created By: Auto/Custom" filter here anymore (all rows are Auto now)

HIGHLIGHT REELS SURFACE  (DownloadsPanel, opened by top-right button — unchanged entry)
├── [Create Highlight Reel]  ← relocated assembly button (opens GameClipSelectorModal)
├── Highlights (in-progress)      ← NEW section: projects where is_auto_created === false
│       renders DraftTile (multi-clip), same stage strip + By Phase/By Game affordances
└── Highlight Reels (published)   ← existing DownloadsPanel content, unchanged
```

---

## 4. Concrete layouts

Reuse existing components verbatim; the split is a routing/label change, not new chrome.

### 4.1 Home — Clips tab (desktop ≥ sm and mobile 375px)

Tab bar (`ProjectManager.jsx:1150-1191`) — only the label token changes:

```
┌───────────────────────────────────────────────┐
│  [🎮 Games  12]   [📂 Clips  7]                 │   ← REEL.bg pill on active
└───────────────────────────────────────────────┘
```
- Active tab keeps `REEL.bg text-white shadow-lg`; label = `SECTION_NAMES.CLIPS` (new token, §6).
- Count pill unchanged (`:1183-1189`) — now counts only auto-drafts (see §5 count note).
- **No action button row** under the tab for Clips (the `Create Highlight Reel` `<Button variant="cyan">`
  block `:1204-1215` is REMOVED from this tab; the `activeTab === 'games'` Add Game branch is
  untouched). This removes the awkward "create a multi-clip thing from the single-clip surface".

Body: identical to today's drafts body (`:1433-1696`) minus the Created-By filter group
(`:1509-1548`, now vacuous — every row is Auto) and minus the multi-clip sort-last special case
(`:689-693`, now moot — no multi-clip rows here). Filters that remain useful: **Phase**
(`:1446-1477`) and **Aspect Ratio** (`:1479-1507`); **By Phase / By Game** toggle unchanged
(`:1565-1586`).

Mobile 375px: unchanged — tabs already wrap/compact (`px-3 py-2 sm:px-4`), tiles are `40vw` posters
in snap carousels (`DraftTile` / `CardCarousel`), 44px coarse-pointer floors already in place.

### 4.2 Highlight Reels surface — DownloadsPanel (`DownloadsPanel.jsx`, header `:722`)

```
┌─ Highlight Reels ──────────────────────────────── [X] ┐
│                                                        │
│   [ + Create Highlight Reel ]   ← relocated assembly    │  cyan Button, icon={Plus}
│                                                         │
│   HIGHLIGHTS (IN PROGRESS)          3                   │  section heading + count pill
│   ┌────┐ ┌────┐ ┌────┐                                  │  DraftTile row (CardCarousel)
│   │▓▓▓▓│ │▓▓▓▓│ │▓▓▓▓│   ← multi-clip DraftTiles        │  Layers "N clips" badge stays
│   └────┘ └────┘ └────┘      (is_auto_created===false)   │
│                                                         │
│   HIGHLIGHT REELS                                       │  existing published content
│   ┌────┐ ┌────┐ …           (unchanged ReelTile rows)   │
│   └────┘ └────┘                                         │
└─────────────────────────────────────────────────────────┘
```

Tailwind, following existing conventions:
- **Build button** (relocated, top of panel body):
  ```jsx
  <Button variant="cyan" size="lg" icon={Plus}
          disabled={!hasClips}
          title={!hasClips ? 'Extract clips from a game first using Annotate mode' : undefined}
          onClick={() => setShowNewProjectModal(true)}>
    Create Highlight Reel
  </Button>
  ```
  Same props as the current `ProjectManager.jsx:1205-1215` block — moved, not rewritten.
  `GameClipSelectorModal` + `handleProjectCreated` move with it (or stay in `ProjectManager` and are
  passed a callback that opens the panel — see §8 risk on component ownership).
- **Section heading** (borderless label row, matches the style-guide "borderless inline filter rows"
  / phase-section heading pattern `ProjectManager.jsx:1616-1623`):
  ```jsx
  <div className="flex items-center gap-2 px-3 py-2 min-h-11">
    <span className="text-sm font-medium text-gray-200 flex-1">Highlights</span>
    <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full">{count}</span>
  </div>
  ```
- **Highlights tiles:** reuse `DraftTile` exactly as the Clips tab does (poster, `Layers` "N clips"
  badge `:534-548`, `SegmentedProgressStrip` deep-link into Focus/Overlay). Wrapped in `CardCarousel`
  to match the poster-row idiom of both DraftTile and ReelTile surfaces.
- **Published `Highlight Reels`** list below: byte-for-byte unchanged.

Mobile 375px: `DownloadsPanel` is already a full-height panel; the new section stacks above the
published list with the same `CardCarousel` horizontal snap behavior. Build button is full-width
(`size="lg"`), ≥44px.

---

## 5. Empty states + transition

### 5.1 Transition (existing user, mixed drafts, first load after ship)
No migration, no persisted-state concern. Both surfaces read the same in-memory `projects` array and
partition it client-side by `is_auto_created`:
- `is_auto_created === true`  → Clips tab.
- `is_auto_created === false` → Highlights section on the Highlight Reels surface.
Every existing item lands on exactly one correct surface by that flag on the first render. A user who
had 4 auto-drafts + 3 assembled drafts sees 4 tiles on Clips and 3 under Highlights — nothing is lost
or duplicated.

**Count semantics (must move together):** the Clips tab count pill (`:1183-1189`) and the
`reelDraftsDisabled` guard must count **auto-drafts only** now, or the tab shows "7" but renders 4.
Introduce a derived `clipDrafts = projects.filter(p => p.is_auto_created)` and drive the tab count,
the "Your Clips / Showing N of M" heading (`:1553-1556`), and the dead-end guard off it. The
Highlights section counts `projects.filter(p => !p.is_auto_created)`.

### 5.2 Empty states

| Surface | Condition | Copy / behavior |
|---|---|---|
| **Clips tab (populated → empty)** | no auto-drafts but user has extracted clips | Keep today's structure at `:1428-1432` but re-copy: heading **"No clips yet"**, sub **"Tap 'Create Reel' on a clip in Annotate to start one."** (points at the real single-clip gesture, not the assembly button which no longer lives here). |
| **Clips tab (dead-end)** | `clipDrafts.length===0 && !hasClips` | Tab stays disabled with tooltip **"Extract clips from a game first using Annotate mode"** (existing `:1172` copy) and bounces to Games — see §5.3. |
| **Highlights section** | no in-progress multi-clip drafts | Section renders a one-line placeholder under the Build button: **"No highlights in progress. Tap Create Highlight Reel to assemble one."** (Do NOT hide the Build button — it is the surface's entry point.) The published Highlight Reels list below shows its own existing empty/loading states, unchanged. |
| **Highlight Reels surface (fully empty)** | no highlights AND no published reels | Build button + the "No highlights in progress" line + DownloadsPanel's existing empty published state. No dead-end here (the panel is opened deliberately, not a persistent tab that can trap the user). |

### 5.3 Dead-end-tab logic under the new shape (`reelDraftsDisabled`, `:426-427`, `:885-889`)
- The guard's PURPOSE is preserved but its subject narrows from "any draft" to "any single-clip
  draft": `clipsTabDisabled = !loading && !gamesLoading && clipDrafts.length===0 && !hasClips`.
  (Renaming the identifier is optional per greppability; if kept as `reelDraftsDisabled`, add a
  comment. Recommend renaming to `clipsTabDisabled` since the surface it guards is now "Clips".)
- The Games-bounce effect (`:885-889`) and the disabled-tab tooltip (`:1171-1172`) are unchanged in
  behavior; they just key off the narrowed condition. A user with only multi-clip Highlights but no
  auto-drafts now correctly sees the Clips tab as a dead end (there ARE no clips) and their Highlights
  live on the always-reachable Downloads surface — which is strictly better than today, where those
  multi-clip drafts were the only thing keeping an otherwise-empty per-clip tab alive.

---

## 6. Exact `displayNames.js` / string changes + full stale-string sweep

### 6.1 `src/frontend/src/config/displayNames.js`
Extend, do not duplicate. `DRAFTS`/`DRAFTS_LOWER` become **obsolete as a tab label** but are still
referenced by quest copy and breadcrumbs (see sweep). Target:

```js
export const SECTION_NAMES = {
  // Single-clip auto-draft surface (Home tab). Was DRAFTS = 'Reel Drafts' (T8360).
  CLIPS: 'Clips',
  CLIPS_LOWER: 'clips',

  // In-progress multi-clip assemblies, shown on the Highlight Reels surface (T8360).
  HIGHLIGHTS: 'Highlights',
  HIGHLIGHTS_LOWER: 'highlights',

  // Published multi-clip reels (DownloadsPanel header). Unchanged.
  LIBRARY: 'Highlight Reels',
};
```
- **Remove `DRAFTS` / `DRAFTS_LOWER`** once every consumer is swept (below). No surface may be left
  rendering "Reel Drafts".

### 6.2 Stale-string sweep (every surface that must change or be re-pointed)

| File:line | Today | Action |
|---|---|---|
| `config/displayNames.js:2-3` | `DRAFTS`/`DRAFTS_LOWER = 'Reel Drafts'` | Replace with `CLIPS`/`HIGHLIGHTS` tokens above. |
| `components/ProjectManager.jsx:1182` | tab label `SECTION_NAMES.DRAFTS` | → `SECTION_NAMES.CLIPS`. |
| `ProjectManager.jsx:1415,1420,1430` | Loading/error/empty "reel drafts" | → `CLIPS_LOWER` + re-copy per §5.2. |
| `ProjectManager.jsx:1553-1556` | "Your Reel Drafts" / "Showing N of M Reel Drafts" | → `CLIPS` and count `clipDrafts`. |
| `ProjectManager.jsx:1204-1215` | Create Highlight Reel button block | **Relocate** to DownloadsPanel (§4.2). |
| `ProjectManager.jsx:1509-1548` | Created By: Auto/Custom filter + `:1542` "Manually created reel drafts" title | **Remove** the filter group from the Clips tab (vacuous — all Auto). Drop `creationFilter` from `filteredProjects` for this surface. |
| `ProjectManager.jsx:689-693` | multi-clip "sort last" special case | Remove/simplify (no multi-clip rows on Clips). |
| `stores/editorStore.js:95` | `PROJECT_MANAGER.label = SECTION_NAMES.DRAFTS` (breadcrumb/mode label) | → `SECTION_NAMES.CLIPS`. |
| `App.jsx:928` | `breadcrumbType={SECTION_NAMES.DRAFTS}` | → `SECTION_NAMES.CLIPS`. |
| `components/shared/Breadcrumb.jsx:9` | doc comment "'Games' or 'Reel Drafts'" | → "'Games' or 'Clips'". |
| `config/questDefinitions.jsx:163,169` | "Switch to [Reel Drafts]…" / "under Reel Drafts" | → `SECTION_NAMES.CLIPS`. **Coordinate with T7620 tutorial copy** (CLAUDE/T8130 note: guided path must say the same words). |
| `questDefinitions.jsx:84,176` | comments/"Reel Draft card" preview copy | Re-word to "Clip" (single-clip context) — verify the quest still points at the right surface. |
| `DownloadsPanel.jsx` (new) | — | Add Build button + Highlights section (§4.2). |
| **Tests** `ProjectManager.homeTabDefaults.test.jsx:91,98,103-104,122,128-140` | assert on `/Reel Drafts/i`, "Create Highlight Reel" on the drafts tab | Update to `Clips` tab + assert Build button is NOT on Home (moved). |
| **Tests** `config/questDefinitions.test.jsx:9,15-17` | expects `/Reel Drafts/` | → `/Clips/`. |
| Comments only (no UI): `ProjectManager.jsx:361,420,689,869,880`; `DraftTile.jsx:27`; `utils/draftStage.js:1`; `settingsStore.js:28`; `utils/timeFormat.js:115`; `ClipsSidePanel.jsx:296`; `ClipDetailsEditor.jsx:121`; `constants/aspectRatios.test.js:9`; `CropOverlay.test.jsx:31-32`; `*.gameClock.test.jsx:5` | "Reel Drafts" in comments | Update opportunistically for accuracy; non-blocking (not user-visible). |
| **e2e** (grep `Reel Drafts` / `New Reel` in `src/frontend/e2e/`) | nav-tab locators | Sweep in full (T8130 already swept "My Reels"/"New Reel" specs; mirror that for the tab label). |

---

## 7. T8350 landing spot (reserve only — do NOT design the cue)

T8350 is the per-clip staleness visual for multi-clip reels (`reel_source_*` mismatch). Known trap:
`SegmentedProgressStrip.jsx:43` collapses per-clip segments once `has_working_video || has_final_video`,
and `DraftTile.jsx:630` suppresses the strip entirely in the ready-to-publish state — so a PRODUCED
multi-clip tile has no per-clip carrier for a staleness cue.

**Reserved landing spot:** the **Highlights-section `DraftTile` bottom scrim / badge cluster**
(`DraftTile.jsx:534-574`, the same top corners that host the `Layers` "N clips" and "Ready" badges).
A per-clip-stale indicator on a multi-clip Highlights tile should live as a **tile-level badge in
that cluster** (e.g. a top-corner "N stale" chip beside the `Layers` count), NOT inside the
segmented strip — because the strip is exactly the surface that collapses/suppresses when produced.
This surface exists on BOTH the Clips tab and the Highlights section, but T8350 targets multi-clip
reels, so its home is the **Highlights section tile**. (Single-clip auto-drafts already surface
staleness in `ClipDetailsEditor` per T8070; no new Clips-tab cue is required by T8350.) This doc
only NAMES the spot; the cue's visual is T8350's to design.

---

## 8. Files-affected map (short — no implementation/test plan)

| File | Change |
|---|---|
| `src/frontend/src/config/displayNames.js` | New `CLIPS`/`HIGHLIGHTS` tokens; remove `DRAFTS`/`DRAFTS_LOWER`. |
| `src/frontend/src/components/ProjectManager.jsx` | Tab label → Clips; partition `projects` by `is_auto_created`; count/guard off `clipDrafts`; remove Build button + Created-By filter + multi-clip sort-last from this tab; empty-state copy. |
| `src/frontend/src/components/DownloadsPanel.jsx` | Add relocated **Create Highlight Reel** button + **Highlights (in-progress)** section (DraftTile rows via CardCarousel) above the published list. |
| `src/frontend/src/components/GameClipSelectorModal.jsx` | No API change; ensure it can be opened from the Downloads surface (ownership question below). |
| `src/frontend/src/config/questDefinitions.jsx` (+`.test.jsx`) | Re-point Reel-Drafts references to Clips; coordinate T7620. |
| `src/frontend/src/stores/editorStore.js`, `App.jsx`, `components/shared/Breadcrumb.jsx` | Breadcrumb/mode label `DRAFTS` → `CLIPS`. |
| `src/frontend/src/components/ProjectManager.homeTabDefaults.test.jsx` | Update tab label + Build-button-location assertions. |
| e2e specs referencing `Reel Drafts` / the drafts-tab Build button | Sweep. |

**Ownership note (implementation decision, not a user question):** the assembly modal +
`handleProjectCreated` currently live in `ProjectManager`. Two clean options — (a) lift
`GameClipSelectorModal` state into whatever renders `DownloadsPanel` so the Build button owns it
there; or (b) keep the modal in `ProjectManager` and have the DownloadsPanel Build button invoke a
passed-in `onOpenAssembly` callback. Recommend (b) for a smaller diff (no state migration; the modal
already sits in `ProjectManager`'s tree and `handleProjectCreated` just refreshes `projects`). Flag
for the Architect at implementation; backend (`/projects/from-clips`) is untouched either way.

---

## 9. Risks

1. **`is_auto_created` is the ONLY routing key.** It is computed per-fetch from the `auto_project_id`
   link (`projects.py:361-364`) and already on the wire — but if a project ever loses its
   `auto_project_id` (e.g. all source clips deleted in the T4800 window before the draft itself is
   deleted), it would flip from Clips to Highlights for its remaining lifetime. Per T4800 an auto-draft
   dies with its last source clip, so this window is momentary; acceptable, but note it. Do NOT
   secondarily route by `clip_count` (reintroduces the ambiguity this task removes).
2. **Count/guard drift.** If the tab count or `reelDraftsDisabled` is left counting ALL `projects`
   while the body renders only `clipDrafts`, the pill lies and the dead-end guard mis-fires. §5.1
   makes moving them together mandatory — call it out in review.
3. **Discoverability of Highlights.** Moving in-progress multi-clip drafts off Home and into the
   Downloads panel means a user mid-assembly must reopen the panel to find their draft. Mitigated by
   co-locating with the published reels they're headed toward and by the Build button living there;
   but it IS a behavior change from "draft appears on Home". This is the main UX tradeoff of the
   recommended IA vs the third-tab alternative (see §10).
4. **DownloadsPanel scope creep.** The panel was a pure "published reels" surface; adding an
   in-progress section + a create button makes it the multi-clip hub. Intended per T8130's table, but
   verify the panel's poster endpoints don't get confused (Highlights use the DRAFT poster endpoint
   `/api/projects/{id}/poster.jpg` via `DraftTile`, published use `/api/downloads/{id}/poster.jpg` via
   `ReelTile` — keep the two tile components, don't unify).
5. **Quest/tutorial coupling (T7620).** Onboarding copy names the "Reel Drafts" tab and walks the user
   there to frame. Renaming to "Clips" AND moving multi-clip assembly off Home must be reflected in the
   guided path or the tutorial dead-ends. Coordinate before ship.

---

## 10. Open questions for the user (minimal, opinionated)

**OQ-1 — Where do in-progress multi-clip "Highlights" drafts live? (the one real IA fork)**
- **Recommended:** on the **Highlight Reels surface (`DownloadsPanel`)** as an in-progress
  "Highlights" section above the published reels, with the Build button relocated there (§3.1 Q3).
  Keeps Home two tabs, co-locates the Highlights → Highlight Reels lifecycle, matches T8130's approved
  "assembly button moves to the Highlight Reels surface" row.
- **Alternative:** a **third Home tab "Highlights"** (Games | Clips | Highlights). More discoverable
  for a user mid-assembly (stays on Home), but breaks the two-tab symmetry, needs a second dead-end
  guard, and splits the lifecycle from the published surface. Only pick this if keeping in-progress
  drafts on Home outweighs the split-lifecycle cost.

*(Everything else — rename Reel Drafts→Clips in place, route by `is_auto_created`, keep DraftTile
chrome, drop the Created-By filter, T8350 landing on the Highlights tile badge cluster — is settled by
the binding decisions and needs no user pick.)*

---

## 11. Recommendation summary

Rename Home's `Reel Drafts` tab to **Clips** in place (single-clip auto-drafts only, routed by
`is_auto_created`), and move the **Create Highlight Reel** button plus its multi-clip **Highlights**
drafts onto the existing **Highlight Reels** (`DownloadsPanel`) surface as an in-progress section
above the published reels — keeping Home two tabs and the Highlights→Highlight Reels lifecycle on one
surface.
