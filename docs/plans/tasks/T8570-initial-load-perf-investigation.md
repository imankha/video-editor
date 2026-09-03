# T8570: Initial page load performance investigation (HAR capture + waterfall analysis)

**Status:** TODO
**Impact:** 6
**Complexity:** 5 (tentative — see Tier note below)
**Created:** 2026-09-03

## Blocked By

**Do not start until the [First Reel Funnel epic](first-reel-funnel/EPIC.md) (T8460-T8560) is
fully complete** (every child row STAGING/DONE). That epic is actively reshaping the exact
screens this task will profile (Annotate primary CTA, Reel Drafts/Highlight Reels surfaces,
Focus unlock flow, Overlay skip path) — capturing and optimizing a load waterfall against UI
that is still being rewritten would measure a moving target and risk redoing the work once the
funnel changes land. Not part of the funnel epic itself (it doesn't touch funnel UX/copy/flow),
so it is filed as a standalone task with an explicit ordering dependency rather than nested as
an epic child.

## Problem

Nobody has measured initial page load performance since **T3060** ("Make It Load Fast", DONE —
Playwright perf harness confirmed Home 1629ms / Annotate 364ms / Framing 898ms / My Reels 388ms
on staging) and the **T6190/T6200** HAR-driven project-open latency pass (2026-07-28, DONE — HAR
showed redundant frontend fetches on reel open plus backend request serialization). Both are old
baselines; the app has since gained the Season Highlights/Collections surfaces, JIT migration
overhead at the load seam, analytics rollups, and (once the First Reel Funnel epic lands) a
reworked Annotate/Highlight Reels/Focus entry flow. There is currently **no fresh measurement**
of where time actually goes on a cold initial load — this task exists to produce one and act on
what it finds, not to fix a known bug.

## Scope

1. **Capture.** Use Playwright (`mcp__playwright__browser_navigate` /
   `mcp__playwright__browser_network_requests`, or a scripted Playwright session per the
   `drive-app-as-user` skill's conventions) to drive
   a cold initial load of the app and record a HAR file over the network. Prefer the deployed
   staging environment for a realistic network/CDN picture (wake it first — cold start is ~145s
   per project memory); a local dev capture is an acceptable fallback/supplement if staging
   introduces confounds (e.g. Fly cold-start skewing the very first request), but call out which
   environment produced which numbers. Capture logged-out landing AND a real authenticated
   first-load (dev-login per the `drive-app-as-user` skill) since they hit very different code
   paths (static landing vs bundle + bootstrap + JIT migration + game/profile fetch).
2. **Analyze.** Load the captured HAR into the **har-analysis** skill and produce the waterfall:
   slow individual requests, request count/critical-path length, caching-header gaps (missing
   `Cache-Control`/`ETag`/immutable-asset headers), compression gaps (uncompressed
   JS/CSS/JSON), render-blocking critical-path CSS/JS, and any redundant/duplicate requests (the
   T6190 finding class).
3. **Propose + implement.** From the analysis, propose targeted optimizations — e.g. bundle
   splitting/code-splitting, lazy-loading below-the-fold or route-gated chunks, cache headers on
   static assets, compression (gzip/brotli) where missing, critical-path CSS/JS trimming,
   request de-duplication/parallelization. Implement the ones that are clearly justified by the
   captured data (no speculative optimization not backed by a measured finding — this task is
   investigation-first, per CLAUDE.md's "correct data, not workarounds" principle: measure, then
   fix what's actually slow, don't guess).
4. **Re-measure.** Capture a second HAR after the fixes land and confirm the targeted metrics
   actually improved; include before/after numbers in the task's completion note.

## Context

### Relevant Files
Not yet known — this is an investigation-first task; the actual file list depends on what the
HAR analysis finds (could be Vite bundle config, route-level lazy imports, FastAPI response
headers/middleware for caching/compression, static asset serving config, or frontend
data-fetching hooks if redundant requests turn up again). The Code Expert stage (Stage 1) should
map the current bundle/asset/caching setup before implementation begins, once this task is
actually picked up.

### Related Tasks
- **Blocked by:** [First Reel Funnel epic](first-reel-funnel/EPIC.md) (T8460-T8560) — see
  "Blocked By" above.
- **Precedent / prior art (both DONE, both superseded by this fresh pass):**
  [T3060](for-alpha/T3060-make-it-load-fast.md) (Playwright perf harness + baseline numbers),
  T6190/T6200 (HAR-driven project-open latency fixes, 2026-07-28 — see
  [perf-batch-har-2026-06-17.md](perf-batch-har-2026-06-17.md) for the sibling HAR-driven perf
  batch's task/branch conventions, useful as a template for how this task's findings should be
  split into sub-fixes if the waterfall surfaces multiple independent issues).

### Technical Notes
- **Skill to use:** `har-analysis` (parses HAR files, produces waterfall/slow-request/caching
  analysis — do not hand-roll HAR parsing).
- **Tier is tentative and will be finalized at classification time** once the HAR is actually
  captured and analyzed: if the findings are a handful of caching-header/compression tweaks plus
  minor lazy-loading, this is **M-tier** (few files, no new abstractions). If the findings
  motivate a real bundle-splitting restructure (route-based code splitting, vendor chunk
  reorganization) touching many files/build config, this is **L-tier** and should get an
  Architect design gate before implementation. Classify for real at Stage 0 once scope is known
  — don't assume either tier now.
- Prior HAR-driven work in this codebase (T6190/T6200, the T1536/T1537/T3760/T3770 perf batch)
  found real backend serialization and redundant-fetch bugs, not just frontend bundle issues —
  keep the investigation scoped to BOTH client (bundle/lazy-load/caching) and server (response
  headers, compression, request count/serialization) sides; don't assume it's purely a frontend
  bundling problem going in.
- No schema/migration implications expected (this is a load-performance pass, not a data-model
  change) — confirm at classification, don't assume if scope grows unexpectedly.

## Implementation

### Steps
1. [ ] Confirm the First Reel Funnel epic (T8460-T8560) is fully STAGING/DONE before starting.
2. [ ] Classify tier for real (Stage 0) once ready to start.
3. [ ] Capture HAR(s) via Playwright — cold logged-out landing + authenticated first-load,
   staging preferred, local dev as fallback/supplement.
4. [ ] Run the `har-analysis` skill against the captured HAR(s); produce the waterfall findings.
5. [ ] Propose optimizations backed by the findings; get user sign-off if any proposal is a
   real architectural change (bundle-splitting restructure) rather than a mechanical fix.
6. [ ] Implement the justified fixes.
7. [ ] Re-capture HAR(s) post-fix; confirm measured improvement; record before/after numbers.

### Progress Log

**2026-09-03**: Task filed per user request, sequenced after the First Reel Funnel epic. Not
started.

## Acceptance Criteria

- [ ] A HAR file of the app's initial load (cold, both logged-out and authenticated) has been
      captured via Playwright.
- [ ] The `har-analysis` skill has been run against it and produced a concrete waterfall with
      named slow requests, caching-header gaps, and compression gaps.
- [ ] At least the clearly-justified optimizations from that analysis are implemented (bundle
      splitting / lazy loading / caching headers / compression / critical-path trimming, as
      applicable — not a fixed checklist, driven by what the data actually shows).
- [ ] A second HAR confirms measured improvement on the targeted metrics (before/after numbers
      recorded in this file's Progress Log).
- [ ] No optimization is speculative/unbacked by a measured finding in the captured HAR.
