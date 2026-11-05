# T14920 Design: "Next Step" panel (roadmap data inside the app)

**Task:** [T14920-next-step-panel.md](T14920-next-step-panel.md)
**Status:** approved 2026-11-05 (owner: "i approve of your plan"; restore the nine rows with statuses checked against git)
**Depends on:** T14900 (`journeyTargets.js`, committed 80d6c50ac), T14910 (`spend-readiness` payload, committed ba31f297a)
**Author:** Claude Fable 5.1, 2026-11-05

## 0. The decision this doc asks for

Option **A, build-time export**, as the task recommends, with these specifics:

1. `scripts/export_roadmap.py` (Python, standard library) parses `docs/plans/PLAN.md` and
   `docs/plans/PLAN-archive.md` with the task board's own parser (`parse_plan` imported from
   `scripts/task-manager.py`, so there is exactly one PLAN.md parser) and merges
   `docs/plans/roadmap-stage-map.json` into one file, `src/frontend/public/roadmap.json`
   (gitignored, like `public/build.json`).
2. The frontend build and dev server run it: `npm run roadmap` (a thin `generate-roadmap.js`
   next to `generate-version.js`) is chained into `predev` / `prebuild*`. Unlike the version
   step it **fails the build** when PLAN.md does not parse or the stage map is invalid.
3. The admin fetches `/roadmap.json` at runtime (`adminStore.fetchRoadmap`), the same way the
   Spend readiness payload is fetched. A missing or unparsable file renders the loud row.
4. Validation lives in `scripts/test_export_roadmap.py` under the **tooling** CI job, which
   every PR runs. It exports the LIVE PLAN.md + stage map and fails when a stage-map id has no
   board row, a transition or gate key has no entry, or a key is not a frozen key.

Option B (hand-maintained constants) is rejected for the task's reason: it rots the day PLAN.md
moves and nothing fails.

## 1. Current state

```
PLAN.md (ranking table + board rows)      admin Journey tab
  stage -> tasks, in order                  SpendReadinessPanel  (T14910: verdict, focus, gates)
  task -> status                            JourneyView          (T14900: coloured transitions)
        |                                          |
        | read by a human, task board              | numbers and colours, no "so what"
        v                                          v
   nothing connects the two
```

- `journeyTargets.js` already computes every transition's `{key, from, to, label, k, n, pct,
  rag, target, baseline}` from the Journey payload (`journeyTransitions(nodes)`), in ladder
  order. Absolute loss is not on the object; it is `t.n - t.k` (judged users who did not reach
  `to`, which is PLAN.md's "lost" = gone + stuck).
- The spend payload carries `focus {tier, gate, label, rag}`, `verdict.line`, and per gate
  `unblock.kind` ("task" means a roadmap task unblocks it; the backend never names ids, by
  T14910 decision 3).
- `scripts/task-manager.py::parse_plan(content)` returns milestones `[{name, tasks:[{id, task,
  status, link, name, ...}]}]` from any `| ID |` table under `###`/`####` headings. The board's
  status classes are todo / wip / waiting / blocked / staging / done / other.

**Finding while auditing (needs the owner's call, section 8):** commit d36ef1ce2 (2026-11-03,
"PLAN.md re-sorted with the Copy audit at the top") deleted nine board rows that the ranking
table still names: T14760, T14770, T14780, T14800, T14810, T14830, T14840, T14850, T14860. Their
task files exist; they have no row in PLAN.md or the archive on this branch or on master. The
validation test in this design would have caught that the day it happened.

## 2. Target state

```
build / dev                                  runtime (admin Journey tab)
-----------                                  --------------------------
npm run dev|build
  -> generate-version.js  (unchanged)        NextStepPanel            <- NEW, above SpendReadinessPanel
  -> generate-roadmap.js  (NEW)                1 Biggest leak          journeyTransitions(journey.nodes)
       python scripts/export_roadmap.py        2 Do next               roadmap.transitions[leak.key] -> tasks
         parse_plan(PLAN.md)                   3 Spend verdict         spend.verdict.line, spend.focus,
         parse_plan(PLAN-archive.md) (DONE)                            roadmap.gates[focus.gate] -> tasks
         roadmap-stage-map.json                4 Roadmap (collapsed)   every transition in ladder order
       -> public/roadmap.json                      status chips        task board colours
                                             adminStore.fetchRoadmap() -> GET /roadmap.json (static)
                                             SpendReadinessPanel      (unchanged)
                                             JourneyView              (unchanged)
```

### 2.1 `docs/plans/roadmap-stage-map.json` (committed, hand-edited, validated)

Keys are T14900's frozen transition keys (`JOURNEY_TARGETS` minus the end-to-end key) and
T14910's gate keys (`GATES[].key`). Values are task ids in the order the roadmap ranks them.
No titles, no statuses: those come from PLAN.md at export time.

```json
{
  "transitions": {
    "add_footage->footage_landed": ["T15130", "T15080", "T15090", "T15140", "T14800", "T14810", "T9000", "T10350", "T14530", "T14540", "T447", "T448"],
    "footage_landed->clipped":     ["T13200", "T13210", "T13220", "T13230", "T13240", "T7060", "...", "T14295", "...", "T7230", "...", "T3290"],
    "clipped->frame_opened":       ["T14770", "T14780", "T14600", "T14610", "T14620", "T14560"],
    "framed->exported":            ["T14710", "T14830", "T14860"],
    "started->add_footage":        ["T14520", "T14810", "T7410", "T7230"],
    "signed_up->started":          ["T14510", "T7410"],
    "finished->took_away":         ["T14840", "T11510", "T11530"],
    "frame_opened->framed":        ["T14760", "T14850"],
    "exported->finished":          []
  },
  "gates": {
    "visit_to_signup": ["T7410", "T14960"],
    "signup_to_export_14d": ["T14710"],
    "upload_failure": ["T15130", "T15080", "T15090", "T15140", "T9000"],
    "finished_to_took_away": ["T14840", "T11510", "T11530"],
    "money_ladder_n": [],
    "payers_per_100": [],
    "revenue_per_payer": [],
    "repeat_purchase": [],
    "k_factor": ["T15070", "T15210", "T15160", "T15170", "T15180", "T15190"],
    "attribution_coverage": ["T15200"],
    "kickback_payers_per_100": ["T15200"]
  }
}
```

The initial contents are the 2026-11-03 ranking table ("Journey map follow-ups") row for row,
plus the 2026-11-04 upload incident tasks on the upload transition, with epic ranges written out
(the `"..."` above is shorthand for this doc only). An empty list is legal and renders "nothing
planned for this stage" loudly; a missing key is not legal (the tooling test fails).

### 2.2 `public/roadmap.json` (generated, gitignored)

```json
{
  "generated_at": "2026-11-05T22:10:00Z",
  "commit": "51f1f0db9",
  "branch": "feature/T14900-...",
  "transitions": { "<transition key>": ["T...", ...] },
  "gates": { "<gate key>": ["T...", ...] },
  "tasks": {
    "T14840": { "id": "T14840", "title": "Finished: Download is dead under the last Guidance card",
                "status": "TODO", "kind": "todo", "section": "Journey map follow-ups",
                "file": "docs/plans/tasks/T14840-finished-download-blocked-by-guidance-shade.md" },
    "T13200": { "...": "...", "status": "DONE", "kind": "done", "section": "Veo Highlights Import" }
  }
}
```

- `status` is the row's cell verbatim (`WAITING ON USER (deferred)` stays as written); `kind`
  is the board's class rule applied once, at export: `todo | wip | waiting | blocked | staging |
  done | other` (SUPERSEDED, OBSOLETE, ICE, DECIDED are `other`, grey). The panel never
  re-derives a status.
- Rows from `PLAN-archive.md` are `DONE` (`kind: done`); PLAN.md wins if an id is in both.
- Epic header rows (empty id) are skipped; `↳` children are ordinary tasks.
- `file` is repo-relative (`docs/plans/` + the row's link). The panel links to
  `https://github.com/imankha/video-editor/blob/master/<file>`.
- The export FAILS (exit 1, message names the ids) when a stage-map id has no row in either
  file. There is no "absent" status: an id the roadmap names must have a row, or the roadmap
  is wrong. This is what makes the finding in section 1 visible.

### 2.3 Panel layout (desktop; phone is the same in one column, chips wrap)

```
NEXT STEP                                      roadmap as of 2026-11-05 22:10 UTC, 51f1f0db9  [Refresh]

Biggest leak   Opened upload to Footage landed  [66.00% of 277, target 78.00%]  100 lost

Do next        > T15130  T15040's 60 s liveness window ...                [WIP]        Next
                 T15080  Every in_progress poll books ...                  [WIP]
                 T14800  Journey: split Add footage into ...               [TODO]
                 T9000   Video Pre-Shrink ...                              [TODO]
                 ...

Spend          Not yet: fix the funnel. Flight blocked by 5 gates (first: visit beacon) ...   (verdict.line, verbatim)
               focus A, Visit to sign-up [grey]  tasks: T7410 [TODO]  T14960 [BLOCKED]

> Roadmap (9 steps, 41 tasks)                                                      collapsed by default
  Signed up to Started          T14510 [STAGING]  T7410 [TODO]
  Started to Opened upload      T14520 [TODO]  T14810 [TODO]  T7410 [TODO]  T7230 [TODO]
  Opened upload to Footage landed  ...
  ...
  Exported to Finished          nothing planned for this stage
```

- **Biggest leak**: among `journeyTransitions(journey.nodes)` with `rag` red or yellow, the
  largest `n - k`; ties keep the earlier transition (the list is already in ladder order, so the
  first maximum wins). The chip is the shared `RagChip` with `transitionChipText(t)`. When no
  transition is red or yellow the row says so ("No transition below target among the N judged";
  grey and partial listed by name), and "Do next" shows the first transition that has tasks, in
  ladder order, labelled as such. Never an empty row.
- **Do next**: `roadmap.transitions[leak.key]` mapped through `roadmap.tasks`. "Next" marks the
  first task whose `kind` is not `staging` or `done` (`other` counts as not actionable either and
  is skipped). All tasks `staging`/`done`/`other`, or an empty list: "nothing planned for this
  stage" in the amber loud style. A transition key the roadmap lacks: a red
  "roadmap has no entry for <key>" row (the tooling test makes this unreachable on a green CI,
  but the panel still refuses to hide it).
- **Spend verdict**: `spend.verdict.line` verbatim, then `focus` as "focus <tier>, <label>" with
  its `RagChip`, then `roadmap.gates[focus.gate]` as chips. When `focus` is null (all green):
  the verdict line alone. When the spend payload is still loading or failed, that row says so;
  the leak rows do not wait for it.
- **Roadmap**: collapsed `Toggle` (moved from `SpendReadinessPanel.jsx` into
  `components/admin/Toggle.jsx`, a mechanical move; both panels import it). Open: every key of
  `JOURNEY_TARGETS` except end-to-end, in that order, label from `journeyTransitions` when the
  payload has both ends, else the key's `from`/`to` through the payload labels. Each task: id
  (link), title truncated by CSS, status chip.
- **Status chips**: `TaskStatusChip` in `NextStepPanel.jsx`, colours = the task board's badges
  (`badge-todo` blue, `badge-wip` blue/stronger, `badge-waiting` purple, `badge-blocked` red,
  `badge-staging` orange, `badge-done` green, other grey) as Tailwind classes on `bg-*/15` +
  `text-*-300`, `data-kind` set so tests and the colour-blind reading do not depend on colour.
- **Header**: "roadmap as of <generated_at> UTC, <commit>" and a Refresh button that re-fetches
  `/roadmap.json` (view gesture; it reads, it never writes).
- **Loud rows** (amber `⚠`, same style as the T14910 caveat): roadmap missing / unparsable
  ("roadmap export missing: run npm run roadmap"), no entry for a key, nothing planned.
- Mobile: `grid-cols-1`, label above value; chips `flex-wrap`; roadmap collapsed. No new
  animation (the Toggle has none). Full screen: the panel sits outside the map's full-screen
  element, unchanged from the Spend panel's position.

### 2.4 Store

```js
roadmap: null, roadmapLoading: false, roadmapError: null,
fetchRoadmap: async () => {
  set({ roadmapLoading: true, roadmapError: null });
  try {
    const res = await fetch('/roadmap.json', { cache: 'no-store' });   // static asset, not the API
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    set({ roadmap: await res.json(), roadmapLoading: false });
  } catch (err) {
    console.error('[Admin] roadmap fetch failed', err);
    set({ roadmapLoading: false, roadmapError: String(err.message || err) });
  }
},
```

`JourneyTab` calls `fetchRoadmap()` once on mount (a read, like `fetchSpendReadiness`) and passes
`{roadmap, roadmapLoading, roadmapError, journey: data, spend: spendReadiness, spendLoading,
spendError, onRefresh: fetchRoadmap}` to `NextStepPanel`, placed between the controls row and
`SpendReadinessPanel`. Raw payload stored, everything derived on read; nothing persists.

## 3. Build hook

`src/frontend/generate-roadmap.js` (Node, so `npm` stays the one entry point on Windows and
Linux): spawns `python` then `python3` (first one found) on
`../../scripts/export_roadmap.py --out public/roadmap.json`, inherits stdio, exits with the
child's code; no interpreter found is also exit 1 with a one-line message. `package.json`:

```
"version":  "node generate-version.js || echo 'Warning: Could not generate version info'",
"roadmap":  "node generate-roadmap.js",
"predev":   "npm run version && npm run roadmap",
"prebuild": "npm run version && npm run roadmap",      (and the :staging / :production pair)
```

The deploy workflows and `scripts/deploy_production.sh` run `npm run build*` from a full
checkout (fetch-depth 0, PLAN.md present), so nothing there changes. `src/frontend/.gitignore`
gains `public/roadmap.json`. Vitest never needs the file: component tests pass fixtures and the
store test mocks `fetch`.

## 4. CI routing (`scripts/ci_policy.py`)

| Path | Rule | Consumer named |
|------|------|----------------|
| `scripts/export_roadmap.py` | `TOOLING_TOOLS` | imported by `scripts/test_export_roadmap.py` (tooling); executed by the frontend build at deploy |
| `scripts/test_export_roadmap.py` | `SCRIPT_TESTS` -> `tooling`; run line added to the tooling job of `branch-ci.yml` and `master-ci.yml` (test_ci_policy pins both) | |
| `docs/plans/roadmap-stage-map.json`, `docs/plans/PLAN.md`, `docs/plans/PLAN-archive.md` | `CROSS_TREE_READS` -> `{'tooling'}` | parsed by the tooling test on every PR (tooling is always required, so this is documentation of the consumer, not a new fan-out) |
| `src/frontend/generate-roadmap.js`, `package.json`, `.gitignore` | existing `src/frontend/` rule | |

No `INTENTIONAL_NARROWING`: no path loses a job. Workflow edits run every job once (expected).

## 5. Tests (written first, red against the unchanged code, mapped to criteria)

| Criterion | Test | Red reason on the unchanged tree |
|-----------|------|----------------------------------|
| T14920:C1 panel shows leak, Do next + Next, spend verdict + focus tasks, collapsed roadmap | `NextStepPanel.test.jsx`: full-ladder fixture (`ladder()` pattern from JourneyTab.test) with the upload step red and the clipped step yellow but smaller loss; asserts `next-step-leak` names `add_footage->footage_landed` with "100 lost", `next-step-next` is the first non-STAGING id, `next-step-spend-line` equals `verdict.line`, `next-step-roadmap` is collapsed and opens with 9 steps | module stub exports nothing -> render throws |
| T14920:C1 phone | same file, `window.matchMedia`-free: asserts chips container has `flex-wrap` and the roadmap grid is one column class; plus a 390x844 Playwright screenshot on the dev stack (human check, `qa/`) | |
| T14920:C2 statuses match PLAN.md at build commit, time + commit printed | `scripts/test_export_roadmap.py`: fixture PLAN.md with TODO / WIP / WAITING ON USER (deferred) / STAGING / BLOCKED rows, an epic header, a `↳` child, an archive row -> `tasks[id].status/kind`, DONE from the archive, PLAN.md wins; `generated_at` is ISO UTC and `commit` is `git rev-parse --short HEAD`; panel test asserts the header prints both | `ModuleNotFoundError: export_roadmap` |
| T14920:C3 every Journey stage and every gate has an entry | `test_export_roadmap.py::test_live_stage_map_is_complete`: keys read from `journeyTargets.js` (regex over `JOURNEY_TARGETS`, the journeyTargets.test precedent) and `spend_readiness_constants.GATES` (plain import, the module has no app imports); every id resolves to a row; `NextStepPanel.test` asserts a payload key missing from the map renders the red row | stage map file missing |
| T14920:C4 missing export renders the loud row | `NextStepPanel.test`: `roadmap=null, roadmapError='HTTP 404'` -> `next-step-missing` row with "roadmap export missing"; `adminStore.roadmap.test.js`: mocked `fetch` 404 -> `roadmapError` set, `roadmap` null | `fetchRoadmap is not a function` |
| T14920:C5 CI routes script and map | `scripts/test_ci_policy.py` (existing suite) after the rule edit: `required_jobs(['scripts/export_roadmap.py'])` includes `tooling` only, `['docs/plans/roadmap-stage-map.json']` -> `{'tooling'}`, `test_export_roadmap.py` listed and pinned in both workflows | new assertions fail before the rule |

Relevant set for the commit: the three new test files, `JourneyTab.test.jsx`,
`SpendReadinessPanel.test.jsx` (Toggle move), `AdminScreen.test.jsx` (mount counts: a fourth
mount read, bump from 3 to 4), `journeyTargets.test.js`, `scripts/test_ci_policy.py`; ruff +
eslint. No e2e spec: the admin tab has none and the panel is read-only.

## 6. Implementation plan (one commit, T14920)

1. `docs/plans/roadmap-stage-map.json` from the ranking table (section 2.1), epic ranges expanded
   to the ids on the board.
2. `scripts/export_roadmap.py`: `load_parser()` (importlib of `task-manager.py`), `rows(path)`,
   `kind_of(status)`, `build(root) -> dict` (raises `RoadmapError` naming every unresolved id or
   unknown key), `main(--out, --root)`; stdlib only.
3. `scripts/test_export_roadmap.py` (unittest, fixtures in a temp dir + the live-files test).
4. `src/frontend/generate-roadmap.js`, `package.json` scripts, `src/frontend/.gitignore`.
5. `components/admin/Toggle.jsx` (moved), `NextStepPanel.jsx`, `adminStore` slice, `JourneyTab`
   placement.
6. `scripts/ci_policy.py` rules + the two workflow run lines; `scripts/test_ci_policy.py` cases.
7. Screenshots desktop 1280x800 and phone 390x844 on the dev stack; `qa/proof.json` entries.
8. Knowledge: none of the seven docs covers the admin analytics screen; the group notes carry
   the panel wiring. If the owner wants one, that is a follow-up, not this task.

~450 LOC across 11 files (Python 130, tests 220, JSX 180, store 20, config 30).

## 7. Risks

| Risk | Mitigation |
|------|------------|
| `npm run dev` fails for a developer when PLAN.md has a malformed table | That is the intended loud failure; the message names the row. The tooling test fails the same PR first. |
| Importing `task-manager.py` executes its module top level (imports `urllib`, defines the server; no side effects at import) | `importlib.util.spec_from_file_location`; the test asserts import has no network/file side effects by running it with `HOME` unset. If the board script ever grows import-time side effects, extract `parse_plan` into a module both import (3rd-use rule). |
| Status freshness = last deploy, not live PLAN.md | Printed as "roadmap as of <time>, <commit>" in the header; same freshness as every other admin fact. Accepted by the task text. |
| Stage map drifts from the ranking table when the owner re-sorts PLAN.md | Only ids live in the map; order is the map's. A re-sort that re-ranks stages is an edit to the map in the same commit, and the tooling test keeps the ids honest. Documented at the top of the JSON. |
| Full vitest suite runs once for the `package.json` edit | One-time cost; later map/PLAN edits route to tooling only. |
| `python` vs `python3` on the deploy runner / Windows | The Node shim tries both and fails loudly with neither. |

## 8. Open questions for the owner

1. **Restore the nine dropped rows?** The validation test fails until T14760, T14770, T14780,
   T14800, T14810, T14830, T14840, T14850, T14860 have board rows again. I propose restoring
   them verbatim from d36ef1ce2^ into a "Journey map follow-ups" board table in this task's
   commit (statuses TODO as they were; the owner can re-rank on the board). Alternative: drop
   them from the stage map and leave the ranking table pointing at taskless ids, which is the
   "two answers" the task forbids.
2. **Gate -> task mapping for Tier C** (`payers_per_100`, `revenue_per_payer`,
   `repeat_purchase`, `money_ladder_n`): the roadmap has no task that moves them (they are
   volume-gated). Empty lists render "nothing planned, waiting on volume". Confirm, or name
   tasks.
3. **Link target**: GitHub `blob/master` of the task file (task text). Confirm, or prefer the
   task board (`localhost:8089`, not reachable from the deployed admin).

Reply "approved" (optionally with answers) to start the failing tests and implementation.
