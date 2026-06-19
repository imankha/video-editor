# T3775: Eliminate ProjectContext's Redundant /api/projects/{id} Fetch

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-06-18
**Updated:** 2026-06-18

## Problem

On every project-open, `/api/projects/{id}` is fetched **twice** in production (confirmed by
T3770's StrictMode-off measurement: projects/{id} = ×2 in a prod-equivalent build, after the
StrictMode dev-double was removed). The two fetches come from **two independent holders of the
same project data**:

1. `projectsStore.fetchProject` ([projectsStore.js:86](../../../src/frontend/src/stores/projectsStore.js#L86))
   — issues `GET /api/projects/{id}?_t=<ms>` (cache-buster), called once via `selectProject`,
   stores the result in `projectsStore.selectedProject`.
2. `ProjectContext` ([ProjectContext.jsx:15-50](../../../src/frontend/src/contexts/ProjectContext.jsx#L15))
   — a `useEffect([projectId])` that issues a **second, bare** `GET /api/projects/{id}` and stores
   the same project in its own React state (`ProjectContext.project`).

This is **redundant state** (violates the project's "no redundant state" rule): two sources of
truth for the same project, two fetches. It is NOT a StrictMode artifact — it persists in
production. The endpoint is fast, so user impact is small; this is an architectural-cleanliness +
one-wasted-request fix.

This is the follow-up carved out of **T3770** (StrictMode verify; bootstrap + health were
confirmed StrictMode-only no-ops). See T3770's Progress Log for the full per-resource measurement.

## Solution

Make `ProjectContext` **consume `projectsStore.selectedProject`** instead of issuing its own fetch.
`selectProject` already fetches and populates `selectedProject` before the editor (and thus
`ProjectProvider`) mounts, so the context's local fetch is pure duplication.

Concretely, in [ProjectContext.jsx](../../../src/frontend/src/contexts/ProjectContext.jsx):
- Replace local `project`/`loading`/`error` state + the `useEffect` fetch with reads from
  `useProjectsStore`: `project = selectedProject`, `projectId = selectedProjectId`.
- Replace the local `refresh()` with `projectsStore.refreshSelectedProject`
  ([projectsStore.js:178](../../../src/frontend/src/stores/projectsStore.js#L178)) — it already
  re-fetches the selected project (with `?_t`) and updates `selectedProject`. Keep the same
  `refresh()` return contract (returns the project or null) so consumers are unaffected.
- Keep the convenience getters (`aspectRatio`, `hasWorkingVideo`, `hasFinalVideo`) derived from
  `selectedProject`.

Net effect: `/api/projects/{id}` drops to **×1** on project-open; `ProjectContext` becomes a thin
adapter over `projectsStore` (or could be retired entirely in a later cleanup — out of scope here).

Alternative considered and rejected: a module-level in-flight promise dedup guard (T2500/T2510
pattern). It does NOT fit — the two requests have **different URLs** (`?_t` cache-buster vs bare)
and originate in two different modules, so a URL-keyed promise guard can't collapse them. The
redundant-state removal is the correct fix.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/contexts/ProjectContext.jsx` — the redundant fetcher (primary change).
- `src/frontend/src/stores/projectsStore.js` — canonical owner; reuse `selectedProject`,
  `selectedProjectId`, `refreshSelectedProject` (already exist; no store changes expected).
- `src/frontend/src/screens/FramingScreen.jsx:42` — consumer: `{ projectId, project, aspectRatio: projectAspectRatio, refresh: refreshProject } = useProject()`.
- `src/frontend/src/screens/OverlayScreen.jsx:55` — consumer: `{ projectId, project, refresh: refreshProject } = useProject()`.
- `src/frontend/src/contexts/index.js` — re-exports `ProjectProvider`/`useProject`/`useProjectOptional` (unchanged).

The `useProject()` contract (`{ projectId, project, loading, error, refresh, aspectRatio,
hasWorkingVideo, hasFinalVideo }`) must be preserved — only the two screens above consume it.

### Related Tasks
- Follow-up to: T3770 (StrictMode verify — found this real residual). 
- Prior art: T2500, T2510 (page-load fetch dedup — pattern does NOT apply here; see Solution).

### Technical Notes
- `selectedProject` may be briefly `null` during a profile switch / initial select; the editor
  screens are already gated by `!selectedProject` at `App.jsx:664`, so the data-always-ready
  invariant holds — don't add a fetch fallback in the context.
- Do not introduce a reactive `useEffect` that writes anything back (persistence rule). This change
  is read-only: the context just mirrors store state.

## Implementation

### Steps
1. [ ] Add a failing test asserting exactly **one** `GET /api/projects/{id}` per project-open
   (mock fetch; mount `ProjectProvider` + drive `selectProject`; assert a single matching request).
2. [ ] Rewrite `ProjectContext` to read from `projectsStore` (no own fetch); wire `refresh` to
   `refreshSelectedProject`.
3. [ ] Re-measure the prod-equivalent flow (StrictMode-off or prod build) — projects/{id} = ×1.
4. [ ] Run frontend unit tests + the framing/overlay E2E smoke to confirm both consumers still work.

### Progress Log

**2026-06-18**: Created from T3770's measured verdict. T3770 proved projects/{id} = ×2 in a
prod-equivalent build (1× `?_t` fetchProject + 1× bare ProjectContext), a real redundant-state
duplicate. Fix scoped to ProjectContext (2 consumers only).

## Acceptance Criteria

- [ ] `ProjectContext` no longer issues its own `/api/projects/{id}` fetch; it reads `selectedProject`/`selectedProjectId` from `projectsStore`.
- [ ] `/api/projects/{id}` fires exactly **once** on project-open in a production-equivalent build (StrictMode-off or `npm run build`), verified by measurement.
- [ ] Deterministic unit test asserts one request per project-open.
- [ ] `useProject()` contract preserved; FramingScreen and OverlayScreen behave identically (aspect ratio, refresh).
- [ ] Frontend tests pass.
