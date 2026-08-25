# T7700: Rename Framing mode to Focus; relabel both export buttons

**Status:** STAGING
**Priority:** P1 (user-directed naming clarity pass, 2026-08-25)
**Impact:** 6
**Complexity:** 6
**Created:** 2026-08-25
**Updated:** 2026-08-25

## Problem

The editor's pipeline is Annotate → **Framing** (crop/upscale) → **Overlay** (highlights/text)
→ Gallery. Two naming problems, both user-reported 2026-08-25:

1. "Framing" doesn't communicate what the step does to a non-technical parent. "Focus" is a
   clearer name for the crop/upscale step.
2. The two export buttons on this path currently undersell what they actually do:
   - The Framing/Focus screen's advance button reads **"Next: Spotlight"** (shipped by
     T7580) — this reads as a trivial "next" navigation click, but it actually kicks off a
     REAL backend export (crop + upscale render) that takes several minutes. The copy should
     be honest that this is a real export, not just a "next" step.
   - The Overlay screen's finish button reads **"Create Reel"** (also shipped by T7580) —
     the user wants this changed to **"Add Overlay"**, since the step is about applying
     whichever overlay type (Spotlight today; text and other types in the future) you've
     configured. **Note for whoever implements this**: T7580 deliberately chose "Create Reel"
     to fix a *different* complaint (a user couldn't tell that this button produces the final
     downloadable reel — "there is no point to this website"). This task explicitly reverses
     that specific choice per direct user instruction 2026-08-25 — this is not an oversight,
     don't "fix" it back.

## Solution

A full audit (Explore agent, 2026-08-25) found "Framing" touches five different risk tiers.
Full findings are in the Progress Log below. **The scoping decision this task commits to:**
rename the UI-facing name, the component/file names, the route, and update tests/docs.
**Do NOT rename the persisted backend values** (`projects.current_mode = 'framing'`,
`export_jobs.export_type = 'framing'`, the Postgres `framing_exports` column, achievement
strings `'opened_framing_editor'` / `'watched_framing_tutorial'`) — keep these as internal
identifiers. An internal/DB name not matching the marketing-facing label is a normal,
low-risk pattern (the audit's explicit recommendation); renaming persisted enum values touches
production data for every existing user and buys nothing the user asked for. If this
mismatch is ever unacceptable, that's a separate, explicitly-scoped follow-up task — do not
fold it in here.

**Explicitly excluded from this task's scope:** `docs/plans/tasks/**` (416 historical task
files reference "framing" — these are dated records of completed work; rewriting them would
misrepresent history for no benefit).

## Context

### Relevant Files (REQUIRED — from the 2026-08-25 audit, not exhaustive line numbers, verify at implementation time since line numbers drift)

**Component/file renames** (`Framing*` → `Focus*`):
- `src/frontend/src/screens/FramingScreen.jsx`
- `src/frontend/src/containers/FramingContainer.jsx`
- `src/frontend/src/modes/FramingModeView.jsx`
- `src/frontend/src/modes/framing/FramingMode.jsx`
- `src/frontend/src/modes/framing/FramingTimeline.jsx`
- `src/frontend/src/modes/framing/` directory (contains `hooks/useCrop.js`, `hooks/useSegments.js`,
  `overlays/CropOverlay.jsx`, `contexts/`, `layers/`, `index.js` — internal files aren't named
  "framing" themselves, only the directory; decide whether the directory needs renaming to
  `modes/focus/` or whether that's excessive churn for internal-only files — your call, note
  the reasoning)
- `src/frontend/src/stores/framingStore.js` (exported hooks: `useFramingStore`,
  `useFramingVideoFile`, `useFramingIncludeAudio`, `useFramingChangedSinceExport`,
  `useRegisterActiveSaveHandler` — internal names, can stay `framing`-prefixed if you decide
  the internal/external mismatch is acceptable here too, OR rename for consistency; your call)
- `src/frontend/src/api/framingActions.js`
- `src/frontend/src/screens/framingOverlayTransition.js`
- Test-file siblings for all of the above (~32 frontend test files touch "framing" in some form)

**User-visible UI strings** (confirmed rendered text, not just internal names):
- `src/frontend/src/components/shared/ModeSwitcher.jsx` — `label: 'Framing'` (the actual mode
  tab users click: Annotate / Framing / Overlay), `data-testid="mode-framing"`, disabled-tab
  tooltip `'Export from Framing first to enable Overlay mode'`
- `src/frontend/src/stores/editorStore.js` — `SCREENS.FRAMING = { label: 'Framing' }` (a
  SECOND, duplicate source of truth for this same label — consolidate into one shared
  constant while you're in here rather than updating two places forever)
- `src/frontend/src/components/DraftTile.jsx` — `statusLabel = 'Framing'`, `"Open in Framing"`
  (button text + title attr)
- `src/frontend/src/utils/draftStage.js` — `DRAFT_STAGE_LABELS.IN_FRAMING = 'In Framing'`
- `src/frontend/src/components/ProjectManager.jsx` — `'Framing started'`, `'Framing Started'`
  (recent-item subtitle + filter dropdown option)
- `src/frontend/src/components/shared/SegmentedProgressStrip.jsx` — `label: 'Framing'` (×3:
  done/exporting/failed states), tooltip `'Started - export framing to complete'`
- `src/frontend/src/components/ExportButtonView.jsx` — `"Framing Settings"` heading, body copy
  mentioning "framing"/"follow-framing", AND the button-copy conditional itself
  (`isFramingMode ? 'Next: Spotlight' : 'Create Reel'`) — **this is where both button relabels
  land**: change to `isFramingMode ? 'Export Focused Video' : 'Add Overlay'` (preserve the
  existing multi-clip-count-suffix behavior for the Focus-mode variant)
- `src/frontend/src/components/ClipSelectorSidebar.jsx` — `'Needs framing — add crop keyframes'`
- `src/frontend/src/modes/OverlayModeView.jsx` — `"Switch to Framing Mode"` button,
  `'You have made edits in Framing mode. Export first...'` dialog copy
- `src/frontend/src/App.jsx` — `'Uncommitted Framing Changes'` dialog title + body copy
- Admin dashboard (internal audience, still real rendered text): `components/admin/UserTable.jsx`
  (`'Framing Opened'`, `'Framing Exported'` badges), `components/admin/FunnelChart.jsx`,
  `components/admin/PlatformBreakdown.jsx` (same two labels), `components/admin/UserDetailPanel.jsx`
  — **these read the SAME underlying `framing_opened`/`framing_exported` achievement/analytics
  keys, which are NOT being renamed (see Solution) — only the DISPLAY label changes, the key
  stays "framing" internally**

**Route:**
- `src/frontend/src/stores/editorStore.js` — `MODE_PATHS[EDITOR_MODES.FRAMING] = '/framing'`,
  `PATH_TO_MODE` reverse map, `modeFromPath()`
- `src/frontend/src/utils/editorContext.js` — `path.startsWith('/framing')` check
- Decide and implement a redirect for old `/framing` bookmarks/history entries rather than
  letting `modeFromPath()`'s unknown-path fallback silently dump users on Project Manager

**Backend** (module/function names only — no persisted value changes, see Solution):
- `src/backend/app/routers/export/framing.py` — module docstring, optionally the file name
  itself (the `/framing` wire path can stay as-is; a file rename is internal/cosmetic and
  optional — your call, don't let it block the task if it's not worth the churn)
- `src/backend/app/services/export_worker.py` — `if job_type == 'framing':` branch (comment
  only, the string VALUE itself is not renamed)
- `src/backend/app/routers/detection.py` — error string `"...Export from framing mode first."`
  — **verify whether this is actually surfaced to the end user in a toast/dialog** before
  deciding whether it needs updating; if backend-log-only, lower priority

**e2e tests** (34 files reference "framing"; the concentrated risk is one file):
- `src/frontend/e2e/regression-tests.spec.js` — **~6+ hard-coded
  `page.locator('button:has-text("Framing")')` locators**, helper functions
  `navigateToFramingAndWaitForVideo()`, `ensureFramingMode()`, ~15 test titles literally named
  `'Framing: ...'`. **Migrate these locators to `data-testid` (e.g. `mode-framing` →
  `mode-focus`, keeping the testid stable going forward) rather than just swapping the string**
  — a text-locator will silently re-break on the next copy tweak.
- `src/frontend/e2e/manifests/screenManifests.js` — `getByTestId('mode-framing')`,
  `reachFraming()` helper, screen manifest `name: 'Framing'`
- Other files with "Framing" in comments/test titles/logs (lower risk, still need updating):
  `T4550-overlay-transform.qa.spec.js`, `T4770-new-user-flow-perf-walkthrough.spec.js`,
  `T4880-mobile-editor-reachable.spec.js`, `T5642-overlay-working-video-presigned.qa.spec.js`,
  `T5674-overlap-overflow.qa.spec.js`, `T5676-aspect-stage-alignment.qa.spec.js`,
  `T5780-framing-effective-duration.qa.spec.js`, `T5790-export-credit-cost-estimate.qa.spec.js`,
  `T6180-ready-tile-primary-action.qa.spec.js`, `T6190-project-open-fetches.qa.spec.js`,
  `new-user-flow.spec.js`, `reedit-reel.spec.js`, `t5672-carousel-chevrons-auto-badge.spec.js`,
  `tutorial-capture-framing.spec.js` (filename itself)
- Fixture assets: `e2e/fixtures/tutorials/framing.vtt`, `framing.chapters.vtt` — check whether
  the caption TEXT itself says "Framing" (separate from the filename) before deciding whether
  these need re-authoring (tutorial video re-recording is likely out of scope — flag if so)

**Docs:**
- `CLAUDE.md` (repo root) — line ~4, the pipeline description every session reads at boot:
  `Annotate → Framing → Overlay → Gallery`
- `.claude/knowledge/keyframes-framing.md` — 1121 lines, substantially about the Framing/Focus
  screen. Decide: rename the file itself (e.g. `keyframes-focus.md`) or keep the filename and
  just update content — the file's scope is arguably broader than just this one mode (covers
  Overlay highlight keyframes too), so a blind rename may be wrong. Update the `.claude/knowledge/`
  index table in CLAUDE.md if the filename changes.
- `src/frontend/src/STYLE_GUIDE.md`, `.claude/references/ui-style-guide.md`,
  `src/frontend/.claude/skills/ui-style-guide/SKILL.md` — Framing-mode color convention entries
- `.claude/references/testing-matrix.md` — `### Framing Mode` section
- `.claude/knowledge/backend-services.md`, `annotate.md`, `export-pipeline.md`, `modal-gpu.md`,
  `persistence-sync.md` — passing cross-references, update as encountered
- `docs/marketing/feature-inventory.md` — `## 3. Framing — make raw footage look professional`
  section header + body (marketing copy, coordinate wording with existing landing-site voice
  per `.claude/references/` marketing docs if this task's worker also touches landing copy —
  likely out of scope for this task, flag rather than improvise marketing copy)

### Related Tasks
- Supersedes/reverses part of T7580 (Overlay button copy specifically — see Problem section)
- T7710 (Overlay settings tab "Overlay" → "Spotlight" label) and T7720 (thumbnail marker
  click behavior) are separate, file-disjoint tasks from this one — spawned in parallel,
  do not merge scope

### Technical Notes
- This is a rename, not a behavior change — per the Refactoring Rules in CLAUDE.md, keep code
  motion (file renames, import updates) as SEPARATE COMMITS from copy/behavior changes (the
  button relabels) within this branch, even though both land in the same PR. Sequence
  suggested: (1) component/file renames + import fixups [mechanical, no visible change],
  (2) user-visible string renames + route + button relabels [the actual user-facing change],
  (3) e2e locator migration + docs. This keeps each commit reviewable and bisectable.
- Watch for the file count: this task is large by file count (40+ files touched across
  frontend + e2e + docs) even though each individual change is low-risk. If the diff grows
  unreviewable, split further rather than forcing one giant PR — flag this at the design gate
  rather than discovering it mid-implementation.

## Implementation

### Steps
1. [ ] Architect design gate: confirm the DB/persisted-value exclusion decision, decide the
       `modes/framing/` directory rename question, decide the `keyframes-framing.md` filename
       question, propose the commit sequencing
2. [ ] Component/file/directory renames + import fixups (mechanical commit)
3. [ ] User-visible string renames: ModeSwitcher, editorStore.SCREENS (consolidate the
       duplicate label source), DraftTile, draftStage, ProjectManager, SegmentedProgressStrip,
       ExportButtonView (including both button relabels), ClipSelectorSidebar,
       OverlayModeView, App.jsx, admin dashboard labels
4. [ ] Route: `/framing` → `/focus` with a redirect for old links
5. [ ] e2e: migrate `has-text("Framing")` locators to `data-testid`, update test titles/helper
       function names, update fixture references
6. [ ] Docs: CLAUDE.md, knowledge docs, style guide, testing matrix
7. [ ] Tests: relevant set (component tests for every renamed/touched file, the migrated e2e
       specs, admin dashboard label tests if any exist)

### Progress Log

**2026-08-25**: Task filed from user-directed naming request + a full Explore-agent audit of
every "Framing" occurrence across the codebase. Audit recommended splitting into a UI-only
rename (this task) and an optional separate data-model rename (NOT started, NOT scoped here —
file separately if ever wanted). Full audit findings folded into the Relevant Files section
above.

## Acceptance Criteria

- [ ] The mode switcher tab, status chips, dialogs, and all other confirmed user-visible
      strings say "Focus" instead of "Framing"
- [ ] Focus screen's export button reads "Export Focused Video" (preserving the existing
      multi-clip-count-suffix variant)
- [ ] Overlay screen's finish button reads "Add Overlay"
- [ ] `/framing` route redirects to the new path rather than silently failing
- [ ] No `has-text("Framing")` e2e locators remain (migrated to `data-testid`)
- [ ] CLAUDE.md's pipeline description and the knowledge docs reflect the new name
- [ ] Backend persisted values (`current_mode`, `export_type`, `framing_exports`,
      achievement strings) are UNCHANGED — verify this explicitly, don't just assume
- [ ] `docs/plans/tasks/**` is untouched
- [ ] Tests pass; CI green
