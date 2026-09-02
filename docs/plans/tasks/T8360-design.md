# T8360 — UI/IA Design Spec: Split single-clip vs multi-clip drafts into separate views

**Status:** DESIGN — USER-APPROVAL-GATED (no source code written in this phase)
**Author:** ui-designer pass, 2026-09-02
**Feeds implementation of:** T8360 (this task); forward-compat landing spot for T8350
**Consistent with:** T8130 approved naming (Plays → Clips → Highlight Reels), T8070 per-clip `reel_source_*` staleness data

---

## 0. TL;DR (the decisions this spec makes)

1. **Surface shape:** THREE tabs in the existing Home tab bar — **Games | Clips | Highlights**. The published surface **Highlight Reels** stays exactly where it is today (the top-right Gallery button opening `DownloadsPanel`), i.e. it is NOT a fourth tab.
2. **Single-clip auto-drafts** live on the new **Clips** tab (`SECTION_NAMES.CLIPS = 'Clips'`). It is the existing Reel-Drafts list machinery, scoped to single-clip drafts (`clip_count <= 1`).
3. **Multi-clip assembled drafts** move to the new **Highlights** tab (`SECTION_NAMES.HIGHLIGHTS = 'Highlights'`) = in-progress multi-clip assemblies. This is the surface that houses the **Build Highlight Reel** button (satisfying T8130's "assembly button moves to the Highlight Reels surface" by placing it on the in-progress sibling of Highlight Reels, on-tab, where its output lands).
4. **No surface says "Reel Drafts" after the split.** `SECTION_NAMES.DRAFTS` / `DRAFTS_LOWER` are retired from live UI (kept only if a test needs a transitional alias; recommend deletion).
5. **T8350 landing spot (do NOT build here):** the per-clip staleness cue lives on the **Clips** tab tile (single-clip: on the `DraftTile` status-chip region) and, for multi-clip, as a stated future carrier on the **Highlights** tile — a persistent post-production band that survives the `SegmentedProgressStrip` collapse. Stated, not designed.

---

## 1. Current State

### 1.1 Home IA today (`ProjectManager.jsx`)

```
ProjectManager (Home)
├── top-right controls (fixed, z-30)          L1032-1051
│     └── [Highlight Reels] Gallery button  → onOpenDownloads → DownloadsPanel (modal/drawer)
│                                             (SECTION_NAMES.LIBRARY, ProjectsScreen.openGallery)
├── Tab bar (two tabs)                         L1149-1191
│     ├── Games        activeTab='games'       (Gamepad2 icon, GAME color, count badge)
│     └── Reel Drafts  activeTab='projects'    (FolderOpen, REEL color, SECTION_NAMES.DRAFTS, L1182)
│           └── disabled when reelDraftsDisabled (L426): no drafts AND no extractable clips
├── Action row                                 L1193-1216
│     ├── games:    [+ Add Game]  (success)
│     └── projects: [+ Build Highlight Reel]  (cyan, disabled unless hasClips, L1209-1213)
│                     → setShowNewProjectModal → GameClipSelectorModal (multi-select)
│                     → handleProjectCreated (L992): closes modal + onRefreshProjects, NO navigation
└── Content
      ├── games:    GamesListSkeleton / GameTile grouped grid
      └── projects: filter row + list  (THE COMMINGLED SURFACE)
            ├── Classification toggle: By Phase | By Game   (L1565, session-only)
            ├── Created By: All | Auto | Custom             (L1510-1547, session-only)
            ├── Status / Aspect filters                     (L1490 area)
            ├── groupedByPhase / groupedProjects (game grouping)
            └── DraftTile per project
                  ├── single-clip auto-draft  (T8070 auto_project_id)
                  └── multi-clip assembled draft
                        └── "Contains N clips" Layers badge  (DraftTile.jsx:537, only disambiguator)
                        └── multi-clip drafts sort last within a game group (L691-693)
```

Key facts:
- `activeTab` is `useState` seeded from the URL (`tabFromPath`, L364-366) — `/home/games` → `'games'`, `/home/reels` → `'projects'`. It is **session/URL state, never persisted to the DB** (`feedback_no_persisted_view_state`).
- `reelDraftsDisabled` (L426) disables the projects tab in the dead-end case; effect L885-889 falls back to Games if the active tab becomes disabled.
- **Highlight Reels (published) is already a separate surface** — a `DownloadsPanel` overlay, not a tab. The tab bar today is only Games | Reel Drafts.
- `creationFilter='auto'` (L1524) already isolates auto-created drafts, but auto vs custom is **not the same axis as single vs multi-clip** (a user CAN manually build a single-clip reel; an auto-draft is always single-clip but the reverse isn't guaranteed). The clean structural axis is `clip_count`, the same axis `DraftTile.jsx:537` and the L691 sort already use.

### 1.2 The problem (from the task)

One list holds two conceptually different objects: per-clip work (single-clip auto-drafts) and assembled highlight videos (multi-clip). They are told apart only by a small "Contains N clips" badge and a sort-last rule. T8130 could not rename the tab to "Clips" (misrepresents multi-clip entries) or to "Highlight Reel Drafts" (misrepresents single-clip entries), so the split was deferred here.

---

## 2. Target State

### 2.1 Surface shape decision — THREE tabs: Games | Clips | Highlights

**Recommendation:** split the single commingled projects tab into two sibling tabs on the SAME existing tab bar, giving **Games | Clips | Highlights**. Keep **Highlight Reels** (published) exactly where it is: the top-right Gallery button → `DownloadsPanel`.

**Why tabs, not "one tab / two sections" and not "a filter within one list":**

| Option | Verdict | Reason against existing structure |
|--------|---------|-----------------------------------|
| **A. Two tabs (Clips, Highlights) + existing Games** ✅ | **CHOSEN** | The tab bar is already the app's top-level IA lever (Games ↔ projects). Adding a third peer tab is the smallest conceptual delta and reuses every existing mechanism: URL routing (`tabFromPath`), count badges, the dead-end guard, and the per-tab action row. Two genuinely different nouns get two genuinely different homes — exactly the user's stated intent (split, don't rename). |
| B. One tab, two labeled sections | Rejected | Re-creates the commingling problem one level down: the assembly button (Build Highlight Reel) has no unambiguous home on a two-section tab, and the By-Phase/By-Game classification toggle would have to run inside each section separately or span both (both are worse than today). A section header is weaker signal than a tab; the user explicitly wanted separate VIEWS. |
| C. A filter within one list (extend Created-By) | Rejected | This is essentially today's state. `creationFilter` already exists and did not resolve the ambiguity — a filter is session-ephemeral and defaults to "All", so the default view is STILL commingled. It also conflates the auto/custom axis with the single/multi axis (see §1.1). A user who lands on the projects tab must not see a mixed list by default. |

**Where Highlight Reels (published) sits relative to the tabs:** unchanged. It remains the top-right Gallery button opening `DownloadsPanel` (`SECTION_NAMES.LIBRARY`). Rationale: it is a celebration/output surface (published, per-profile, `ReelTile` idiom, no draft chrome) and is already visually separated as an overlay. Promoting it to a fourth tab is out of scope for T8360 and would crowd the tab bar to four items on mobile. The naming pair the user chose is honored across the split: **Highlights** (in-progress multi-clip, a tab) → **Highlight Reels** (published, the Gallery overlay).

**Resulting tab bar:**

```
Home tab bar (L1149-1191 area)
┌────────────┬────────────┬──────────────┐
│  Games     │  Clips     │  Highlights  │
│  Gamepad2  │  Film/Clap │  Layers      │
│  GAME      │  REEL      │  REEL        │        top-right: [Highlight Reels] → DownloadsPanel
└────────────┴────────────┴──────────────┘
   activeTab:  'games'      'clips'        'highlights'
   URL:        /home/games  /home/clips    /home/highlights
```

Icon guidance (Lucide, per style guide §Icons):
- **Clips** — `Film` (or `Clapperboard`); a per-clip work item. Distinct from Games' `Gamepad2` and from Highlights.
- **Highlights** — `Layers` (already the multi-clip semantic in `DraftTile.jsx:545`) — the multi-clip stack idiom the user already reads as "multiple clips assembled".
- Keep the existing REEL color token for both Clips and Highlights (they are the two halves of the old projects tab); Games keeps GAME. Count badge pattern (L1161-1167) reused verbatim per tab.

### 2.2 What each surface contains

| Surface | Content | Populated from | Empty when |
|---------|---------|----------------|------------|
| **Games** | game footage tiles (unchanged) | `games` | no games |
| **Clips** (`SECTION_NAMES.CLIPS`) | single-clip drafts (`clip_count <= 1`), incl. all T8070 auto-drafts | `projects.filter(clip_count <= 1)` | no single-clip drafts |
| **Highlights** (`SECTION_NAMES.HIGHLIGHTS`) | multi-clip assembled drafts (`clip_count > 1`), in progress toward publish | `projects.filter(clip_count > 1)` | no multi-clip drafts |
| **Highlight Reels** (`SECTION_NAMES.LIBRARY`, unchanged) | PUBLISHED reels | `DownloadsPanel` (`/api/downloads`) | no published reels |

**Split axis = `clip_count`**, the exact same field `DraftTile.jsx:537` badges on and the L691 sort keys on. This is a pure client-side partition of the already-fetched `projects` array; **no new backend field is required** (`clip_count` is already on the project list response). The "Contains N clips" badge (`DraftTile.jsx:537`) becomes redundant on the Highlights tab (every tile there is multi-clip by definition) — see §2.5.

### 2.3 Does the multi-clip assembly flow move? — YES, onto the Highlights tab

- **Build Highlight Reel button** moves from the (retired) Reel-Drafts action row to the **Highlights** tab action row. On the **Clips** tab, the action row shows **no assembly button** — creating a single-clip draft is not a Home gesture (it originates in Annotate via "Create Reel" on a clip, T8070). If a Clips-tab action is wanted, the recommended default is **none** (keep the row empty / omit it), because the Clips-populating gesture lives in Annotate; see Open Question Q2.
- **`handleProjectCreated` (L992)** currently closes the modal + refreshes and does NOT navigate. Recommended change: after a successful multi-clip build, **switch to the Highlights tab** (`setActiveTab('highlights')`) so the freshly-built draft is visible where it now lives, instead of silently landing on a tab the user may not be viewing. This is a navigation-on-explicit-gesture (the Build submit), not reactive persistence — allowed.
- **Residual "New Reel" / "Reel Drafts" copy:** all retired. The button already reads "Build Highlight Reel" (T8130). `SECTION_NAMES.DRAFTS`/`DRAFTS_LOWER` are removed from live UI; the `creationFilter` "Custom" title string that interpolates `SECTION_NAMES.DRAFTS_LOWER` (L1542) is re-worded (see §2.4).

**Why Highlights is the assembly home and not "under Highlight Reels":** T8130's table says the assembly button "moves to the Highlight Reels surface." The literal Highlight Reels surface is the published `DownloadsPanel` — but you cannot assemble an in-progress draft INTO a published-only surface (drafts have Focus/Overlay pipeline chrome; `ReelTile` deliberately has none, per style guide §Published-reel tile). The faithful realization of T8130's intent is: the in-progress multi-clip drafts get their own surface named **Highlights** that pairs with **Highlight Reels**, and that Highlights surface hosts the Build button. A finished Highlights draft, once published, graduates into Highlight Reels — the same draft→published relationship that already exists, now with names that read as a progression.

### 2.4 `SECTION_NAMES` changes (extend, do not duplicate strings)

```js
// src/frontend/src/config/displayNames.js  (TARGET)
export const SECTION_NAMES = {
  // NEW — single-clip work items (formerly the single-clip half of Reel Drafts)
  CLIPS: 'Clips',
  CLIPS_LOWER: 'clips',

  // NEW — in-progress multi-clip assemblies (formerly the multi-clip half of Reel Drafts)
  HIGHLIGHTS: 'Highlights',
  HIGHLIGHTS_LOWER: 'highlights',

  // UNCHANGED — the published surface (Gallery / DownloadsPanel), renamed by T8130
  LIBRARY: 'Highlight Reels',

  // REMOVED — no surface says "Reel Drafts" after the split:
  //   DRAFTS: 'Reel Drafts',
  //   DRAFTS_LOWER: 'reel drafts',
};
```

- Every current `SECTION_NAMES.DRAFTS` read site must be re-pointed to `CLIPS` or `HIGHLIGHTS` per which surface the string now describes (13 hits in `ProjectManager.jsx`; others in `questDefinitions`, `ClipsSidePanel`, `ClipDetailsEditor`, `Breadcrumb` — see §3).
- The "Custom" creation-filter title (L1542, `Manually created ${SECTION_NAMES.DRAFTS_LOWER}`) becomes `Manually created ${SECTION_NAMES.HIGHLIGHTS_LOWER}` if the Created-By filter survives on the Highlights tab (it likely does — a user can still auto vs manually distinguish multi-clip origins), or is dropped on the Clips tab (all Clips entries are auto-origin single-clip; the auto/custom axis is meaningless there — see Q3).

### 2.5 Component-level target (what changes, how)

```
ProjectManager (Home)
├── tab bar: THREE buttons  Games | Clips | Highlights
│     - add 'clips' + 'highlights' to the activeTab union; retire 'projects'
│     - tabFromPath: /home/games→games, /home/clips→clips, /home/highlights→highlights
│     - HOME_TAB_PATHS (editorStore.js:48) gains /home/clips, /home/highlights
│     - reelDraftsDisabled logic splits into clipsDisabled / highlightsDisabled (see §2.6)
├── action row (per tab)
│     - games:      [+ Add Game]                       (unchanged)
│     - clips:      (no assembly button; empty/omitted — Q2)
│     - highlights: [+ Build Highlight Reel]           (moved here, unchanged label/behavior)
├── content: shared list renderer, fed a pre-partitioned projects subset
│     - clipsProjects      = projects.filter(p => (p.clip_count ?? 1) <= 1)
│     - highlightsProjects = projects.filter(p => (p.clip_count ?? 1)  > 1)
│     - the existing groupedByPhase / groupedProjects / filter row / classification
│       toggle all run UNCHANGED over whichever subset the active tab supplies
├── DraftTile
│     - Clips tab: single-clip tiles; the "Contains N clips" badge NEVER shows (clip_count<=1) — no change needed
│     - Highlights tab: multi-clip tiles; the "Contains N clips" badge (L537) is now REDUNDANT
│       (every tile is multi-clip). Recommendation: KEEP the badge (it still conveys the exact N,
│       which varies per Highlights tile and is useful) but it is no longer load-bearing for
│       disambiguation. Do not remove in this task unless the user prefers a cleaner tile (Q4).
└── DownloadsPanel (Highlight Reels): UNCHANGED
```

The heavy list machinery (By Phase/By Game, phase sections, game grouping, status/aspect filters, `CardCarousel` rows, `SegmentedProgressStrip`) is **reused verbatim** — the only new thing is the `clip_count` partition that decides which subset feeds it, plus the third tab plumbing. This keeps the reviewable diff small and avoids reinventing draft-list code (per the task's "reuse, don't reinvent" note).

### 2.6 Dead-end guard, split in two

Today `reelDraftsDisabled` (L426) covers one tab. After the split:
- **Clips tab disabled** when `!loading && !gamesLoading && clipsProjects.length === 0 && !hasClips` — i.e. no single-clip drafts AND no extractable clips to make one. (Same shape as today.)
- **Highlights tab disabled** when `!loading && !gamesLoading && highlightsProjects.length === 0 && !hasClips` — no multi-clip drafts AND nothing to build one from.
- The L885 fallback effect generalizes: if the active tab becomes disabled, fall back to the first enabled tab in order **Games → Clips → Highlights** (Games is always enabled once a game exists; a brand-new user with zero games lands on Games, which shows the Add-Game empty state — unchanged behavior).

---

## 3. Implementation Plan (file-by-file — decision-oriented, not code)

Anchors below are verified against the current tree.

1. **`src/frontend/src/config/displayNames.js`** — add `CLIPS`/`CLIPS_LOWER`, `HIGHLIGHTS`/`HIGHLIGHTS_LOWER`; remove `DRAFTS`/`DRAFTS_LOWER` (or keep a transitional alias only if a test blocks — recommend clean removal).

2. **`src/frontend/src/stores/editorStore.js:48`** — `HOME_TAB_PATHS` gains `/home/clips`, `/home/highlights`. `modeFromPath` (L383 area) must map all three to `PROJECT_MANAGER`. `editorStore.test.js:103-119` asserts these paths — update in the same commit.

3. **`src/frontend/src/components/ProjectManager.jsx`** (the bulk):
   - `tabFromPath` (L364-366): map `/home/clips`→`'clips'`, `/home/highlights`→`'highlights'`; retire `/home/reels`→`'projects'`. Decide the redirect for a legacy `/home/reels` deep link (recommend → `/home/clips`, the higher-traffic single-clip surface; see Q1).
   - `initialTab` / `setActiveTab` (L430-439): three-way path mapping; default when bare `/home` → `clips` if `clipsProjects.length` else `games` (recommend, mirrors today's projects-first default; Q1).
   - `reelDraftsDisabled` (L426) → `clipsDisabled` + `highlightsDisabled` (§2.6). Fallback effect (L885-889) generalized to first-enabled-tab order.
   - Tab bar (L1149-1191): add the third `<button>`; three count badges. Icons per §2.1.
   - Action row (L1193-1216): move Build Highlight Reel to the `highlights` branch; `clips` branch has no assembly button (Q2).
   - Content partition: derive `clipsProjects` / `highlightsProjects` from `projects` by `clip_count`; feed the existing grouping/filter/list block by active tab. The L691-693 "multi-clip sort last" rule becomes moot within each subset (kept harmless).
   - `handleProjectCreated` (L992): after build, `setActiveTab('highlights')` (Q2/navigation).
   - Re-point all 13 `SECTION_NAMES.DRAFTS`/`DRAFTS_LOWER` hits (headings L1553-1556, creation-filter title L1542, etc.) to `CLIPS`/`HIGHLIGHTS` per surface.

4. **`src/frontend/src/components/DraftTile.jsx:537`** — no functional change required (badge already gated on `clip_count > 1`, which is only ever true on the Highlights tab). Optional cleanup deferred to Q4.

5. **`src/frontend/src/config/questDefinitions.jsx` + `src/frontend/src/data/questDefinitions.js`** — 2-3 `SECTION_NAMES.DRAFTS` references in quest copy; re-point to the surface the quest step actually lands on (a "build your first reel" quest → Highlights; a "your clip is ready" quest → Clips). Confirm each per quest step. `questDefinitions.test.jsx` asserts these strings — update together.

6. **`src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` and `ClipDetailsEditor.jsx`** — one `SECTION_NAMES.DRAFTS` reference each (Annotate copy referring to where a created reel goes). A single-clip "Create Reel" from Annotate lands in **Clips** → re-point to `SECTION_NAMES.CLIPS`. `ClipsSidePanel.gameClock.test.jsx` may assert this.

7. **`src/frontend/src/components/shared/Breadcrumb.jsx`** — one `SECTION_NAMES.DRAFTS` reference; re-point to the surface the breadcrumb targets (likely Clips, confirm at implementation).

8. **E2E / spec string sweep (large, mechanical, unavoidable):** `Reel Drafts` / `New Reel` / `SECTION_NAMES.DRAFTS` appear **67 times across 25 e2e files** (`src/frontend/e2e/`) and **38 times across 15 files under `src/frontend/src/`** (13 of those in `ProjectManager.jsx` itself). The task's "~228 stale hits" figure is the broad grep; the load-bearing subset is these ~105 occurrences plus route strings `/home/reels`. Every nav helper that clicks the "Reel Drafts" tab or waits on `/home/reels` must move to "Clips" or "Highlights" + the new routes. High-traffic offenders to expect: `helpers/*` (framingDraft.js, overlayDraft.js), `T5677-home-deeplinks-route-fallback.spec.js` (6 hits, route-fallback logic — must cover the new three-tab routing AND the legacy `/home/reels` redirect), `regression-tests.spec.js` (10), `new-user-flow.spec.js` / `T4770` (funnel), `derisk-staging-export.qa.spec.js` (6, a staging-gate spec). Mandatory staging-gate specs must be swept in full (this is the same class of miss called out in T8130's progress log).

9. **`ProjectManager.homeTabDefaults.test.jsx`** (9 hits) — the tab-default + dead-end fallback unit tests; rewrite for three tabs, `clipsDisabled`/`highlightsDisabled`, and first-enabled-tab fallback order.

**Tier note for the implementing agent:** this is frontend-only, no schema change, but it touches the top-level Home IA + a large spec sweep and adds a new pattern (three-tab partition). Classify **L** (per CLAUDE.md: new pattern + 6+ files + design-gated) so the Reviewer runs on the diff; the spec sweep alone warrants a careful review pass.

---

## 4. Naming vocabulary table (final, consistent with T8130)

| Concept | Object | Surface / control | Name (final) | `SECTION_NAMES` key |
|---------|--------|-------------------|--------------|---------------------|
| A moment in a game | annotation / `raw_clip` | Annotate create action | **Play** ("Add Play") | — (T8130) |
| Game footage | game | Home tab 1 | **Games** | — |
| One clip's reel-in-progress (single-clip draft, incl. T8070 auto-drafts) | project, `clip_count<=1` | Home tab 2 | **Clips** | `CLIPS` / `CLIPS_LOWER` |
| A multi-clip assembly in progress | project, `clip_count>1` | Home tab 3 | **Highlights** | `HIGHLIGHTS` / `HIGHLIGHTS_LOWER` |
| The assembly gesture | — | action button on Highlights tab | **Build Highlight Reel** | — (T8130) |
| A published, shareable reel | `final_video` (published) | Gallery overlay (`DownloadsPanel`) | **Highlight Reels** | `LIBRARY` (T8130) |
| RETIRED | — | (was Home tab 2) | ~~Reel Drafts~~ / ~~New Reel~~ | ~~`DRAFTS`~~ / ~~`DRAFTS_LOWER`~~ |

Reads as a progression: **Play → Clip → Highlight → Highlight Reel** (capture a play, that clip becomes a single-clip reel, assemble several into a Highlight, publish it into your Highlight Reels).

---

## 5. Empty states + the transition (existing user, first load after ship)

Tab/filter selection is **session-only, never persisted** (`feedback_no_persisted_view_state`), so there is no stored "last tab" to migrate — every user gets the default-tab logic below on first load after the split ships.

### 5.1 Which tab is default on first load

- Bare `/home` (no tab in URL): default to **Clips** if the user has any single-clip drafts, else **Games** (mirrors today's "projects if any else games", biased to the higher-traffic single-clip surface). See Q1 for the exact tie-break.
- A saved/bookmarked `/home/reels` (the retired route) **redirects to `/home/clips`** (recommend) so old links/bookmarks don't 404 into a dead tab. See Q1.
- `/home/games` unchanged.

### 5.2 How each surface populates for a mixed-draft user

An existing user whose old Reel-Drafts tab held, say, 4 single-clip auto-drafts + 2 multi-clip assemblies sees, with zero data migration (pure client partition on `clip_count`):
- **Clips** tab: the 4 single-clip drafts, in the existing By-Phase default grouping.
- **Highlights** tab: the 2 multi-clip assemblies, By-Phase default.
- **Highlight Reels** (Gallery): whatever they had published — unchanged.
- The "Contains N clips" badge no longer carries meaning across two lists (each list is now homogeneous by count) — the split IS the disambiguation the badge used to provide.

### 5.3 Empty-state copy per surface

Match the borderless/minimal Home idiom (style guide §Home / Card Patterns). Keep copy a launchpad, not a paragraph (the T8130 "empty state as button" principle).

| Surface | Empty condition | Copy + primary affordance |
|---------|-----------------|---------------------------|
| **Clips** | no single-clip drafts | Headline: **"No clips yet"**. Sub: "Tag a great play in a game, then tap Create Reel to start a clip." Primary: a link/button into **Games** (or Annotate for the most recent game). If `!hasClips`, the tab is disabled per §2.6 and the user never reaches this empty state (they're on Games). |
| **Highlights** | no multi-clip drafts (but `hasClips`) | Headline: **"No highlights yet"**. Sub: "Combine your best clips into one highlight video." Primary: the **Build Highlight Reel** button (already in the action row) — the empty state points straight at it. |
| **Highlight Reels** (Gallery) | no published reels | UNCHANGED (`DownloadsPanel` existing empty state). |
| **Games** | no games | UNCHANGED (existing Add-Game empty state). |

Empty-state visual: reuse the existing muted, centered empty pattern already present in the projects content block (`text-center py-8`, gray text, a single primary `Button`) — do not introduce a new card/panel treatment.

---

## 6. Forward-compat: T8350 staleness cue landing spot (STATED ONLY — do not build here)

T8350 will add a per-clip staleness cue when a produced reel no longer reflects a clip's current `start_time`/`end_time` (T8070 `reel_source_*`). This spec reserves WHERE it renders on each surface; it does not design the cue.

- **Clips tab (single-clip drafts):** the cue lands on the single-clip `DraftTile`, in/near the **status-chip region** (top corner, the `bg-black/60` chip area). A single-clip tile already surfaces its produced stage there; a "stale — source edited" state is a variant of that same chip. This is the natural home because a single-clip draft maps 1:1 to one clip, and `ClipDetailsEditor` already computes `reelReflectsClip` for the seed clip (annotate.md, T8070) — the same per-clip datum is available on the tile via the project's clip.

- **Highlights tab (multi-clip drafts) — the known trap:** the multi-clip `DraftTile` has **no carrier today** for a per-clip staleness cue that only matters AFTER a reel is produced:
  - `SegmentedProgressStrip.jsx:43-48` collapses the per-clip segments once `has_working_video || has_final_video` — so the per-clip strip that could host per-clip badges is gone exactly when staleness becomes relevant (post-production).
  - `DraftTile.jsx:630` suppresses the strip entirely when ready-to-publish.
  - **Stated landing spot for T8350:** a NEW persistent, post-production affordance on the multi-clip Highlights tile that does NOT depend on the collapsed/ suppressed segment strip — e.g. a small "N of M clips out of date" band or chip in the tile's bottom scrim / action region, shown only when the reel is produced (`has_working_video || has_final_video`) AND at least one member clip's `reel_source_*` mismatches its current boundaries (per-clip data already available via `WorkingClipResponse`, T8070). T8350 owns the exact shape, interaction, and thresholds. This spec only guarantees the Highlights tile is where it goes and that it must be a carrier independent of `SegmentedProgressStrip`.

---

## 7. Risks

1. **Large mechanical spec sweep (~105 load-bearing hits + routes).** The biggest risk is an incomplete sweep leaving a staging-gate e2e asserting on "Reel Drafts"/`/home/reels`. Mitigation: grep-driven checklist in §3.8; run the full frontend e2e job (layer-scoped Branch CI, not file-selected) before merge; the T8130 progress log shows this exact class of miss already bit once.
2. **Legacy `/home/reels` deep links / bookmarks.** Must redirect, not 404 into a removed tab. Covered by Q1 + the `T5677-home-deeplinks-route-fallback` spec rewrite.
3. **`clip_count` partition edge cases.** A draft with `clip_count == 0` (the T4800-guarded orphan signal — annotate.md invariant: a 0-clip draft is a deliberate visible bug signal, not to be hidden) must land SOMEWHERE, not vanish. Recommend: `clip_count <= 1` (including 0 and null) → **Clips**, so a 0-clip orphan still shows (preserving the T4800 "visible signal" invariant) rather than being filtered out of both tabs. Do NOT add a `clip_count == 0` filter (annotate.md explicitly bans it).
4. **Tie-break / default-tab churn.** Session-only tab state means every reload re-derives the default; a user mid-task who reloads could land on a different tab than before. This already happens today (projects vs games); the three-tab version just has one more option. Accepted, consistent with `feedback_no_persisted_view_state`.
5. **Mobile tab-bar width.** Three tabs + count badges must fit the mobile tab bar (currently two). The existing buttons use `px-3 py-2 sm:px-4` and short labels; "Games/Clips/Highlights" are short, and badges are optional-when-zero — should fit 375px, but verify at 320px (the T7590-class narrow viewport). If tight, drop the count badge on the narrowest breakpoint before shortening labels.
6. **Icon collision / meaning.** `Layers` for Highlights is already the multi-clip semantic; `Film`/`Clapperboard` for Clips must be visually distinct from Games' `Gamepad2` at 16px. Confirm at implementation.

---

## 8. Open Questions for the user (each with a recommended default)

1. **Default tab + legacy `/home/reels` redirect.** Recommend: bare `/home` defaults to **Clips** when the user has single-clip drafts, else **Games**; a legacy `/home/reels` link **redirects to `/home/clips`**. Alternative if you consider Highlights the more important surface: default/redirect to `/home/highlights`. **Default: Clips.**

2. **Clips-tab action button.** The Clips-populating gesture lives in Annotate ("Create Reel" on a clip), not on Home. Recommend the Clips tab action row has **no button** (an empty row, or omit it). Alternative: a secondary link "Tag plays in a game →" that routes to Games/Annotate. **Default: no button** (keeps the surface honest — you don't build single-clip drafts from Home). Related: after a multi-clip build, should Home auto-switch to the Highlights tab? **Recommend yes** (navigate-on-gesture so the new draft is visible).

3. **Created-By (auto/custom) filter fate.** On **Clips**, the auto/custom axis is nearly meaningless (essentially all single-clip drafts are auto-origin) — recommend **hiding the Created-By filter on the Clips tab**. On **Highlights**, it still distinguishes origins — recommend **keeping it there** (re-worded to `${HIGHLIGHTS_LOWER}`). **Default: hide on Clips, keep on Highlights.**

4. **Keep or drop the "Contains N clips" `Layers` badge on Highlights tiles.** It's redundant for disambiguation post-split but still tells you the exact N. Recommend **keep** (cheap, informative, no code change). Alternative: drop for a cleaner tile. **Default: keep.**

5. **Should "Highlights" copy extend into the assembly flow itself** (e.g. `GameClipSelectorModal` header/CTA copy referring to "highlight" rather than "reel/project")? T8130 already set the button to "Build Highlight Reel"; the modal internals were out of that scope. Recommend a **light touch**: keep the modal's internal mechanics/labels as-is for T8360 (avoid scope creep) and file any modal-copy alignment as a fast-follow. **Default: modal copy unchanged in T8360.**
