# T9540 — Render, Job, Progress & Completion Labels — Design

**Task:** T9540 (Shared Vocabulary epic, task 3 of 6) — render-action / job / progress / completion labels + the substantive behavior half (UX-11: one object+stage vocabulary, no duplicate job/charge on double-click, honest backend-confirmed cost, jobs visible across navigation).
**Tier:** L (design-gated). This doc **requires human approval before implementation.**
**Author:** supervisor session acting as Architect (Opus-tier dispatch).
**Knowledge:** `.claude/knowledge/export-pipeline.md` (read in full).

---

## 0. Scope guardrails (from the epic + task file)

- **Rename the RENDER ACTION / JOB / PROGRESS / COMPLETION labels only.** Do NOT rename mode
  names ("AI Focus" / "Spotlight"), internal APIs, routes, store keys, WS event names, or
  analytics vocabulary (`EDITOR_MODES.*`, `framing_exported`/`overlay_exported`, `type: 'framing'|'overlay'`).
- **Out of scope (T9590 / adjacent):** `FOCUS_PUBLISH` / `OVERLAY_PUBLISH` action-bar labels
  (Publish Now, Add Spotlight Now, Reapply Spotlight, Save/Publish Later, etc.). Do not touch
  `displayNames.js` lines 142-210.
- **`displayNames.js` is the single source** for the new user-visible strings.
- **The distinction that must stay sharp:** the *mode* is "AI Focus" (a place you edit); the *job*
  is "generate framed clip" (a thing you do). Likewise the *mode* is "Spotlight"; the *job* is
  "export clip with effects".

---

## 1. Current state — the exact object+stage at each surface

The app has **two paid/render stages**, both dispatched from the ONE `ExportButtonContainer`/
`ExportButtonView` pair, keyed on `editorMode` → export `type`:

| Stage | editorMode | export `type` | endpoint | Charges credits? |
|-------|-----------|---------------|----------|------------------|
| Focus render (frame + upscale a clip) | `FRAMING` | `framing` | `POST /api/export/render` (single) / `/api/export/multi-clip` | **YES** — per output-second (`compute_export_credits`, `framing.py:493`, `multi_clip.py:2155`) |
| Spotlight render (burn highlight effects) | `OVERLAY` | `overlay` | `POST /api/export/render-overlay` | **NO — zero credits** (confirmed: no `reserve_credits`/`compute_export_credits` anywhere in `overlay.py`) |

### 1a. Button (CTA) — `ExportButtonView.jsx:80-86`
```
isCurrentlyExporting → 'Reel in progress...' (external) | 'Creating reel...'   ← same string BOTH modes
else isFramingMode   → 'Export Focused Video'  (+ ` (n/total)` when some clips unframed)
else (overlay)       → 'Add Spotlight'
```
Problems: "Creating reel..." is identical for both stages (can't tell which stage runs); "Add"
names a render (the report's flagged inversion); "Export Focused Video" is engineering-ish and
doesn't match the job noun ("framed clip").

### 1b. Progress toast / job list — `GlobalExportIndicator.jsx`
- Header line: `{N} Export{s} Active` + `getExportLabel(exp)` (= the reel NAME) + `{percent}%`.
- Expanded row: `{exp.type} Export` capitalized (e.g. "Framing Export" / "Overlay Export"),
  `exp.progress.message` (raw backend string, verbatim — see 1e), completion "Completed {time}".
- Completion toast (`:214`): title **"Export Complete"**, message `{reel} - {type} export finished successfully`.
- Failure toast (`:220`): title **"Export Failed"**.

### 1c. In-editor completion / progress copy — `ExportButtonView.jsx:167-172`, `ExportButtonContainer.jsx`
- Success cell (`View:170`): `Reel ready! Find it in ${SECTION_NAMES.LIBRARY}.` (= "…Highlight Reels.").
- Container progress strings (verbatim, free text): `Checking server...`, `Uploading...`,
  `Connecting...`, `Starting render...`, `Processing...`, `Export complete!`,
  `Loading into Spotlight mode...`, `Saving to Highlight Reels...`.

### 1d. Cost — `ExportButtonView.jsx:177-207`, `ExportButtonContainer.jsx:1022-1033`
- Framing only: `~{estimatedCredits} credit(s) · balance {n}` via `estimateExportCredits` (same
  `getRequiredCredits` calc the click-time check + backend charge use → already backend-consistent).
- Overlay: `estimatedCredits` is `null` → **no cost shown at all**. Backend charge for overlay is
  **0**, so "nothing shown" is not *wrong*, but it is *silent* about a genuinely-free stage.

### 1e. Backend progress messages (the "leaks internals" copy — N37)
Emitted by the render pipeline and surfaced verbatim as `exp.progress.message`. `websocket.py:20
make_progress_data` is the single payload builder and always carries a `phase` field. Observed
message strings and their origin:

| Observed message | Origin | Phase field |
|---|---|---|
| `Detecting players...` / `Detecting players (local GPU)...` | `multi_clip.py:328,873` | `detecting_players` |
| `AI upscaling frame {i}/{n}` / `Clip {k}: frame {i}/{n}` | **Modal** `video_processing.py:1590,2984` | `processing`/`upscaling` |
| `Downloading video...`, `Processing frames...`, `Uploading result...`, `Complete!` | `local_processors.py` | `ExportPhase.DOWNLOAD/PROCESSING/UPLOAD/COMPLETE` |
| `Download complete`, `Processing complete`, `Overlay complete` | Modal `video_processing.py:364,380,399` | `downloading`/`processing` |
| `Starting export...`, `Validating project...` | `framing.py:389,405` | (inline dicts, `processing`) |

"Computing hash / Hash complete" from the report belong to the **upload** flow, already renamed by
T9430 (`UPLOAD_STATE`, `uploadPresentation.js`) — NOT re-touched here (see `displayNames.js:126-140`).
N37 for T9540 is the **export/render** progress vocabulary above.

**Landmine:** several of these strings are baked into the **Modal image** (`video_processing.py`),
which cannot import `app` and requires a `modal deploy` to change. Renaming them at the source would
force a Modal redeploy (staging→verify→prod) for cosmetic copy — a poor trade.

---

## 2. Target state — one object+stage vocabulary, single source

### 2a. New `displayNames.js` block (single source; placed near `UPLOAD_STATE`, above `FOCUS_PUBLISH`)

Keyed on export `type` so button/job/toast/completion all resolve from ONE table — this is the
"one source of truth for what stage this is" the acceptance criterion demands.

```js
// T9540 (N19-N21/N37): render-action / job / progress / completion vocabulary.
// Keyed on the export `type` ('framing' | 'overlay') the store + WS payload already carry, so
// the button, the job list, the toast and the completion message never disagree about the stage.
// Mode names ("AI Focus" / "Spotlight") are deliberately NOT here — a mode names a PLACE, a job
// names a THING YOU DO. The post-export action-bar labels are T9590 (FOCUS/OVERLAY_PUBLISH), untouched.
export const EXPORT_JOBS = {
  framing: {
    // NOUN is "AI Focus" — the mode was renamed Framing -> AI Focus (T9320); carry that through to
    // the render job (one object, one stage). VERB is "Generate" (render/produce), deliberately NOT
    // "Apply": "Apply AI Focus" (T9330, annotate.md) is a DIFFERENT gesture that NAVIGATES INTO the
    // mode — reusing it here would confuse entering the mode with paying to render inside it.
    action:     'Generate AI Focus',        // N19 — button (render action), was "Export Focused Video"
    inProgress: 'Generating AI Focus...',   // N19 — progress/job label, was "Creating reel..."
    inProgressExternal: 'Generating AI Focus...', // replaces "Reel in progress..."
    completed:  'AI Focus ready',           // N21 — EXACT per user; was "Export Complete"
    jobNoun:    'AI Focus',                  // job-list row noun, was "Framing Export"
  },
  overlay: {
    action:     'Export clip with effects',// N20 — button (render action), was "Add Spotlight"
    inProgress: 'Exporting clip...',        // N20
    inProgressExternal: 'Exporting clip...',
    completed:  'Clip ready',               // N21
    jobNoun:    'Effects',
    // Q1 (approved, Option B): the Spotlight/effects render charges ZERO credits (confirmed: no
    // reserve_credits in overlay.py). Surface that honestly instead of staying silent.
    costNote:   'No credits · effects are free',
  },
};

// N37 — export PROGRESS vocabulary. Maps the backend `phase` (from make_progress_data, the single
// payload builder) to honest user copy. Counters stay as OPTIONAL secondary detail, never primary.
export const EXPORT_PROGRESS = {
  PREPARING:      'Preparing video',            // init/queued/validating/downloading
  UPLOADING:      'Uploading',                  // upload
  RENDERING:      'Rendering',                  // processing/modal_processing/rendering/upscaling
  FINDING_PLAYERS:'Finding players for spotlight', // detecting_players
};
```

### 2b. Rename table mapping (exact, per the spec)

| Group | Surface (file) | From | To (source) |
|-------|----------------|------|-------------|
| N19 | CTA framing (`ExportButtonView`) | `Export Focused Video` (+`(n/t)`) | `EXPORT_JOBS.framing.action` (+`(n/t)`) |
| N19 | in-progress CTA framing | `Creating reel...` / `Reel in progress...` | `EXPORT_JOBS.framing.inProgress` |
| N20 | CTA overlay (`ExportButtonView`) | `Add Spotlight` | `EXPORT_JOBS.overlay.action` |
| N20 | in-progress CTA overlay | `Creating reel...` | `EXPORT_JOBS.overlay.inProgress` |
| N21 | success cell (`ExportButtonView:170`) | `Reel ready! Find it in Highlight Reels.` | `${EXPORT_JOBS[type].completed}. Find it in ${SECTION_NAMES.LIBRARY}.` |
| N21 | complete toast title (`GlobalExportIndicator:214`) | `Export Complete` | `EXPORT_JOBS[type].completed` |
| N21 | job-list row noun (`GlobalExportIndicator:351`) | `{type} Export` | `EXPORT_JOBS[type].jobNoun` |
| N21 | job-list completion (`:413`) | `Completed {time}` | `${EXPORT_JOBS[type].completed} · {time}` |
| N37 | progress message everywhere it's displayed | raw backend msg (`Detecting players`, `frame 150/180`, …) | `exportProgressLabel(phase, message)` → friendly primary + optional counter detail |
| N37 | container progress strings (`ExportButtonContainer`) | `Processing...`, `Starting render...`, `Uploading...` | `EXPORT_PROGRESS.*` values |
| Q1  | overlay cost cell (`ExportButtonView` cost cell) | (silent — nothing) | `EXPORT_JOBS.overlay.costNote` = `No credits · effects are free` |

Resolved examples: framing success cell → `AI Focus ready. Find it in Highlight Reels.`; framing
complete toast title → `AI Focus ready`; overlay success → `Clip ready. Find it in Highlight Reels.`
The framing NOUN "AI Focus" is now identical across all four Focus surfaces (button `Generate AI
Focus` / in-progress `Generating AI Focus...` / job noun `AI Focus` / completion `AI Focus ready`) —
satisfying the one-object-one-stage criterion, and matching the mode name (T9320) without colliding
with the navigate-into gesture `Apply AI Focus` (T9330).

CTA in-progress must become **type-aware** (currently one shared "Creating reel..."). The View
already knows `isFramingMode`; thread the export `type` (or reuse `isFramingMode`) to pick the row.

### 2c. New pure presenter `utils/exportProgressPresentation.js` (mirrors `uploadPresentation.js`)

```js
// Maps a backend progress payload to { primary, detail } for display. Keyed on `phase` (stable
// machine vocabulary from make_progress_data); falls back to keyword-matching the raw message for
// any legacy/edge phase. Counter fractions (e.g. "150/180") are extracted as OPTIONAL detail.
export function exportProgressLabel(phase, message) { ... }   // → { primary: EXPORT_PROGRESS.*, detail: '150/180' | null }
```
Rationale: keeps `displayNames.js` the single source, and — critically — **avoids a Modal redeploy**
by mapping on the frontend rather than renaming Modal-baked strings. Backend phases are already the
stable contract (`make_progress_data` always sets `phase`). This is the same pattern T9430 used for
the upload states, so it's an established idiom, not a new abstraction.

---

## 3. Behavior half (UX-11)

### 3a. No duplicate job / no duplicate charge on double-click — **DECISION: minimal NEW backend guard + FE hardening. The existing CAS does NOT cover this.**

**Why existing machinery does not cover it:**
- `_claim_stage_for_finalize` (T7210) gates the `→detecting` FINALIZE transition of ONE job so two
  callers racing to *finish the same job* don't double-finalize. A double-click creates **two
  different jobs** (distinct client `export_id`s), each finalizing exactly once — the CAS sees no
  contention and lets both through. It is the wrong layer.
- Credit `reserve→confirm→refund` is keyed on `export_id`. Two clicks = two `export_id`s = two
  independent reservations = **two charges**. No dedup.
- The frontend `isCurrentlyExporting` disable is **necessary but not sufficient**: `handleExport`
  does `await useCreditStore...fetchCredits()` (`ExportButtonContainer.jsx:475`) BEFORE
  `setIsExporting(true)` (`:508`). During that network await the button is still enabled, so a
  second click enters `handleExport` concurrently and both reach the POST. Real gap.
- Latent bug found: the framing job INSERT (`framing.py:400-408`) and its siblings `try/except`
  and **continue on failure**, so even a PK collision would fall through and still reserve credits.

**The guard (durable, correct layer = the `export_jobs` rows that are already the in-flight source
of truth — no new table, no schema change):**

1. **Backend — atomic per-(project, type) in-flight guard at job creation, BEFORE any reservation.**
   Replace the unconditional `INSERT INTO export_jobs` in all three render entry points with a
   single conditional insert:
   ```sql
   INSERT INTO export_jobs (id, project_id, type, status, input_data)
   SELECT ?, ?, ?, 'processing', '{}'
   WHERE NOT EXISTS (
     SELECT 1 FROM export_jobs
     WHERE project_id = ? AND type = ? AND status IN ('pending','processing')
   );
   ```
   `cursor.rowcount == 0` → an active job for this (project, type) already exists → **raise
   `HTTPException(409, {"code": "export_in_flight"})` and return immediately — no reservation, no
   background task.** Because the credit reserve happens strictly AFTER the insert in every path
   (`framing.py`: insert :400 → reserve :496; `multi_clip.py`: insert :2093 → reserve :2161;
   `overlay.py`: insert :1504/2930, no reserve), the second click never charges. Atomic
   `INSERT…WHERE NOT EXISTS` closes the check-then-insert TOCTOU (single per-user SQLite writer +
   the write lock make this a true CAS at the DB layer).
   - Keyed on **(project_id, type)** so it blocks a duplicate Focus render but still allows the
     legitimate Focus→then→Overlay sequence (different `type`), and a re-render AFTER the first
     job leaves `processing` (correct: that re-render SHOULD charge again — see 3b).
   - Extract into ONE helper (`export_helpers.insert_export_job_if_none_active(...) -> bool`) so the
     three sites share it (abstract-on-3rd holds: 3 call sites). `create_export_job` (annotate,
     project 0) stays as-is — annotate has no per-project dedup need.
2. **Frontend — synchronous in-flight latch (backstop / avoids the wasted POST + 409 round-trip).**
   Set a `useRef` in-flight flag at the very TOP of `handleExport` (before the `await fetchCredits`),
   and early-return if already set; clear it in the same `finally`/terminal paths that reset
   `isExporting`. This makes the rapid double-click a no-op client-side; the backend 409 is the
   durable guarantee for any path that still slips through (programmatic trigger, multi-tab, retry).
3. **409 handling:** the container's `catch` treats `err.response.status === 409 &&
   detail.code === 'export_in_flight'` as **not an error** — it silently drops the duplicate (the
   first job's WS/store already drives the UI), cleaning up the redundant `export_id` without a
   toast. Do NOT show a failure.

### 3b. Retry billing (preserve draft on failure; re-render charges)
Confirmed current behavior is CORRECT and needs no change (verify with a test, don't rebuild):
- **Failure refunds:** `framing.py:722-724` refunds `credits_deducted` when the pipeline never
  entered; once inside `_export_clips`, it refunds itself. `multi_clip.py:1979-1995,2509-2510`
  refunds on pre-pipeline and in-pipeline failure. Draft/project pointers are restored (`T4010`,
  `framing.py:566-577` snapshots prior pointers; failure restores them). So a failed render that
  produced no output does NOT keep the charge. ✅ (criterion: "no re-charge for a failed render")
- **Legitimate re-render charges again:** once the failed/complete job leaves `processing`, the
  3a guard permits a new dispatch, which reserves fresh credits. ✅ (criterion: "a legitimate
  re-render after a successful one DOES charge again")

### 3c. Jobs visible across navigation; unrelated annotation not disabled — **already satisfied, no regression risk.**
- Durable rows: `get_active_exports()` selects `WHERE status IN ('pending','processing')`
  (`exports.py:376`), exposed at `GET /api/exports/active` (`:633`); the store hydrates from it on
  load and `GlobalExportIndicator` renders from the store regardless of the current screen. Not
  scoped to a project → visible everywhere.
- No global lock: the export button disable (`isButtonDisabled`) keys on
  `isExternallyExporting` = `exportingProject.projectId === selectedProjectId` — **per project**.
  A running export never disables a *different* project's annotate/edit controls. Verified in code;
  we add a regression test asserting the guard is project-scoped, and do not change this behavior.

### 3d. Backend-confirmed cost, no invented free stage
- **Framing:** already backend-consistent (same calculator on estimate + check + charge). No change
  beyond letting the renamed copy sit next to it.
- **Overlay:** backend charge is **0**. **RESOLVED (approved, Option B):** show an explicit,
  honest zero-cost caption in the overlay cost cell — `EXPORT_JOBS.overlay.costNote` =
  `No credits · effects are free`. Copy-only, sourced from the backend-confirmed fact (0), not a
  fabricated number.

---

## 4. Migration — **NO.** (explicit ruling)
No schema change. The 3a guard reuses `export_jobs.status` (existing column) via a conditional
INSERT; no new column/table/index, no `_SCHEMA_DDL`/`_USER_DB_SCHEMA` edit, no migration file, no
Migration agent. All other changes are frontend strings + a pure presenter. Modal is **not**
touched (the phase→copy map lives on the frontend precisely to avoid a redeploy).

---

## 5. Files touched (estimate ~180-260 LOC)

**Frontend**
- `config/displayNames.js` — add `EXPORT_JOBS`, `EXPORT_PROGRESS` (new block near `UPLOAD_STATE`).
- `utils/exportProgressPresentation.js` — NEW pure `exportProgressLabel(phase, message)`.
- `components/ExportButtonView.jsx` — CTA (type-aware in-progress), success cell, overlay zero-cost caption (if 3d-B).
- `components/GlobalExportIndicator.jsx` — toast title, job-row noun, completion line, progress via presenter.
- `containers/ExportButtonContainer.jsx` — synchronous in-flight ref latch; 409 `export_in_flight` swallow; progress strings → `EXPORT_PROGRESS`; pass `type` where the View needs it.

**Backend**
- `services/export_helpers.py` — NEW `insert_export_job_if_none_active(...) -> bool` (shared guard).
- `routers/export/framing.py`, `multi_clip.py`, `overlay.py` — use the guard at each render entry, 409 on duplicate, before any reservation.

**Tests** (Stage 3 red-first for 3a; the rest updated not deleted)
- Backend: `tests/test_t9540_double_dispatch_guard.py` — two concurrent `/render` for one project →
  one job row, one reservation, second gets 409; Focus→Overlay both allowed; re-render after
  terminal state allowed + charges. Plus a refund-on-failure regression (3b) and a project-scoped
  guard assertion (3c).
- Frontend: `ExportButtonView.test.jsx` / `GlobalExportIndicator.test.jsx` — updated to new copy;
  new `exportProgressPresentation.test.js` for the phase→copy map + counter extraction; a
  double-click test asserting only one POST fires (in-flight ref).

## 6. Risks
- **Copy assertions in existing tests** will fail on the rename — update them to the new strings
  (epic rule: update, never delete). Curate the relevant set (~10-15), don't run full suites.
- **Phase coverage for the presenter:** if any live path emits a `phase` not in the map, the
  keyword-message fallback catches it; a truly unknown phase shows the raw message (no worse than
  today). Enumerate the emitted phases during impl and add any missing key.
- **409 UX:** must be swallowed, never surfaced as "Export Failed" — explicit test.

---

## 7. Approver resolutions (2026-09-11 — design approved with corrections; no further gate)
1. **Overlay cost (Q1): APPROVED Option B** — explicit `No credits · effects are free` caption. Applied in 2a/2b/3d.
2. **Focus vocabulary (Q2): CORRECTED** — the AI Focus stage uses the noun **AI Focus** (carried from the T9320 mode rename), NOT "framed clip"/"Framing". Completion string is EXACTLY **AI Focus ready**. Render verb is **Generate** (`Generate AI Focus`), distinct from the T9330 navigate gesture `Apply AI Focus`. Applied consistently across all four Focus surfaces in 2a/2b.
3. Spotlight/overlay side unchanged (Export clip with effects / Exporting clip... / Clip ready / Effects) + the Q1 caption.

<details><summary>Superseded original open questions (for history)</summary>
1. Overlay cost display: (A) keep silent, or (B) explicit free caption? → resolved B.
2. Confirm the four progress phrases and the completion phrasings, and whether the framing completion should say "Framing ready" vs "Framed
   clip ready" (the spec lists both for N21 — I chose "Framed clip ready" as the object+stage; easy to switch). → resolved: neither; **AI Focus ready** (Q2 correction).
</details>
