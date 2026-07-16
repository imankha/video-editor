# T4930: Playwright mobile/viewport usability matrix (every screen, popular sizes)

**Status:** DONE
**Impact:** 7
**Complexity:** 5
**Created:** 2026-07-11
**Updated:** 2026-07-11

## Problem

T4880 (mobile Framing/Overlay completely unusable — can't reach anything below the timeline) shipped to production and was found by a user, not by us. The reason it was structurally invisible: the E2E suite runs exactly one Playwright project, `Desktop Chrome` ([playwright.config.js:78-83](../../src/frontend/playwright.config.js#L78-L83)). No test anywhere runs at a mobile viewport, so an entire class of layout-breakage (clipped action buttons, unscrollable panes, horizontal overflow) can regress silently on the devices many parents actually use at games.

User direction (2026-07-11): run **each screen** through Playwright at iPhone size and verify it is 100% usable; then run the same criteria at the most popular screen sizes. Extract every lesson this reported issue offers.

## Solution

### 1. Define "usable" as executable criteria (the core deliverable)

A shared screen-usability audit helper that, for a given screen, asserts:
- **Every primary action is reachable**: the screen's key interactive elements (save/exit, Export, Add Spotlight, publish, nav) can be scrolled into view AND are visible + clickable (not covered by fixed/overlapping elements, not clipped outside the scrollable area).
- **No horizontal overflow** (page body never scrolls sideways).
- **No dead scroll traps**: if content exceeds the viewport, some container actually scrolls to expose it (this is exactly the T4880 failure).

Each screen contributes a declarative manifest of its primary actions (selector list) so the audit is data-driven, not N copy-pasted tests.

### 2. Screen coverage

All user-facing screens: Home/games list, Annotate, Framing, Overlay, Gallery/My Reels (incl. collections/ranking), publish/export flows' modals, share page, auth/onboarding (NUF quests + tutorial modal), profile management. Portrait AND landscape for phone sizes.

### 3. Viewport matrix

New Playwright projects (start lean — CI cost is real; the audit spec runs across projects, existing functional specs stay Desktop Chrome only):
- `iphone` — `devices['iPhone 14']` (or current most-popular iPhone descriptor): the reporting user's class
- `iphone-se` — smallest supported iPhone (tightest height; catches clipping first)
- `android` — `devices['Pixel 7']` (most popular Android class)
- `tablet` — iPad descriptor
- Desktop stays as the existing project; optionally add 1366x768 (most common small laptop) to the audit only

### 4. Known blind spot — document it, don't pretend it's covered

Playwright viewport emulation does NOT reproduce iOS Safari's dynamic browser chrome (the 100vh-vs-dvh clipping that caused T4880). Mitigations, in scope for this task:
- Audit asserts reachability-by-scrolling (fails on any layout where content below the fold is unreachable, regardless of why).
- Add a lint/grep gate banning `h-screen`/`100vh` in the app tree in favor of `h-dvh`/`100dvh` (once T4880 lands the conversion), so the emulator-invisible failure mode is blocked at the source.
- Testing-matrix doc gains an explicit "real-device check required for viewport-unit changes" line.

### 5. Learning capture (Stage 7 of this task)

- Update [testing-matrix.md](../../.claude/references/testing-matrix.md): any UI/layout change type now includes mobile-viewport audit in its coverage row.
- Retrospective per [retrospectives/README.md](../../.claude/retrospectives/README.md): why a total mobile blocker survived — no mobile project, no usability-level assertions (all E2E asserts functionality on desktop), no real-device step in release flow.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/playwright.config.js` — add device projects (lines ~78-83)
- `src/frontend/e2e/` — new `screen-usability.spec.js` + per-screen action manifests; `helpers/` for the audit helper
- `src/frontend/e2e/helpers/realAuth.js` / dev-login flow — audits need an authenticated session with representative data (games, clips, a publishable reel)
- `.claude/references/testing-matrix.md` — coverage guidance update
- CI workflow that runs e2e (check runtime budget; audits may need their own job or a tag)

### Related Tasks
- Depends on: T4880 (the fix defines what "usable on mobile" looks like for Framing/Overlay; T4880 also adds the specific regression test this task generalizes)
- Related: T4770 (perf walkthrough spec drives real flows — reuse its navigation scaffolding where possible)

### Technical Notes
- Fixture data: audits need each screen to be in its "fullest" state (timeline populated, keyframes present, settings panel rendered) or the reachability assertions are vacuous. Reuse existing e2e fixtures/global-setup.
- Keep audit assertions behavioral (reachable/clickable), not pixel-snapshot — snapshots across a device matrix are flaky and this task is about usability, not visual regression.
- E2E runs go through the sandbox/container flow (`task.sh test`) — verify device descriptors behave there.

## Implementation

### Steps
1. [ ] Audit helper + usability criteria (reachable/clickable/no-h-overflow/no-scroll-trap)
2. [ ] Per-screen action manifests (all screens listed above)
3. [ ] Playwright device projects + spec wiring (audit spec runs on all projects; functional specs pinned to desktop)
4. [ ] Run matrix; file a task per screen×viewport failure found (expect T4880 to reproduce; others may surface)
5. [ ] vh/h-screen lint gate (after T4880's conversion)
6. [ ] Update testing-matrix.md + write the retrospective

### Progress Log

**2026-07-11**: Task created from user direction after the T4880 report ("we need to learn as much from this reported issue as possible"). Root cause of the detection gap confirmed: single Desktop Chrome project in playwright.config.js.

## Acceptance Criteria

- [ ] Every user-facing screen has a usability audit that runs at iPhone, iPhone SE, Android, tablet, and desktop sizes (phone sizes in portrait + landscape)
- [ ] The audit FAILS on the pre-T4880 layout (proves it would have caught the reported bug)
- [ ] Failures found by the first matrix run are filed as tasks
- [ ] `h-screen`/`100vh` lint gate active in the app tree
- [ ] testing-matrix.md updated; retrospective written
- [ ] CI runtime impact measured and acceptable (or audits split to a separate job)
