# T12800: The guide coach never covers the UI its sentence tells the user to use

**Status:** WIP (branch feature/T12800-guide-coach-never-covers, commits pending)

Filed 2026-10-14. **Epic:** [F. One pulse path](EPIC.md). **Knowledge:** `.claude/knowledge/guidance.md`

## What shipped
All three layers, plus two real bugs the sweep caught and a third class of bug (a sibling overlay shadowing Home's guide) that wasn't in the original gap list:
- **Layer 1** (`data-guide-overlap` oracle): shipped as designed.
- **Layer 2** (`e2e/guide-no-overlap.spec.js`): drives the reachable states at 390/768/1280/1579 wide plus the 844x390 landscape cockpit. See its header comment for exactly what's covered, what's not reachable (and why), and two known account-load flakes unrelated to the invariant.
- **Layer 3** (`guideRules.namedControls.test.js`): shipped as designed.
- **Fix A**: `clearOfPulses` (placement.js) gave up after 4 fixed candidates; it now scans the viewport for the nearest clear slot before falling back. Caught the Clips tab at 1280/1579 wide and the Annotate editor's Mark-play strip at 1579 wide.
- **Fix B**: the scroll-hint "offscreen" check (FloatingCoach.jsx) was wrong at both viewport edges -- a target mostly visible at the bottom (Done in the play editor, 1280x800) or flush with the top (Home's Finished tab, 768x1024) wrongly got the hint docked on top of it.
- **Fix C**: the Finished viewer (`DraftReelPreview`) is a fullscreen overlay mounted as a SIBLING of Home in App.jsx, not nested in its `GuideScope` -- "innermost wins" is plain React context and never reached it, so Home's own pulse stayed CSS-active behind the opaque viewer. `ProjectManager`'s `homeGuide` now goes null while the viewer is open, same as the upload modal.

Two more fixes from live manual testing after the sweep (reported against this branch, not caught by the sweep since it checks `.coach-target-pulse`/overlap, not the shade or the docked width):
- **Fix D**: the docked card (bottom strip / dockTop) spanned edge-to-edge (`inset-x-3 w-auto`), so a one-line message read as a near-full-width bar on desktop. Capped to the floating card's own width, centred.
- **Fix E**: a focusable guide (Got it present) could show with NO modal shade at all. `annotate-highlight-slots` renders `display:contents` two levels deep when `inline` (`HighlightOrientationSlots`); `anchorRect`'s children-union fallback only looked at direct children, so the empty inner wrapper was filtered out, the union came back empty, and the shade's rect guard silently skipped it. Fixed two ways: `anchorRect` now recurses through nested `display:contents`, and the shade is now a structural guarantee -- focusable + unblocked but genuinely unmeasurable shades the whole viewport rather than nothing, so this class of bug can't recur silently.

Full red/green proof, the final sweep log, and file hashes: `qa/proof.json` + `qa/*.log`.

## Classification
**Tier:** M | **Stack Layers:** Frontend | **Files Affected:** ~6 | **LOC Estimate:** ~350 (most of it the e2e sweep)
**Test Scope:** Frontend Unit + Frontend E2E (local; Branch CI does not run Playwright)

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | guidance.md plus the three background commits cover the area |
| Architect | No | No design gate: a self-check, a test spec, a unit test |
| Tester | No | M tier: implementor writes the failing jsdom test first |
| Reviewer | Yes | One captured reviewer (`land --capture`) |
| Migration | No | No schema |

## Background (on master; read these commits first)
- f6414ee1c, f5a166534, c994c363f: the coach card (FloatingCoach) landed on the pulsing Done button and on the play rater in the Annotate play editor. Fix: `clearOfPulses()` in `src/frontend/src/components/instructions/placement.js` treats every pulsing control (`.${GUIDE_PULSE_CLASS}`) and every keepClear rect of the step as hard obstacles. `FloatingCoach.jsx` passes `touchRects` into placeCoach's avoid list and into clearOfPulses. Pulsing controls are cut out of the shade.
- A rule's `pulse` can be an array (Annotate watch = Play + Mark play); GuideScope flattens it.
- Regression tests: `src/frontend/src/components/instructions/FloatingCoach.pulseClear.test.jsx` (jsdom, mocked rects; use `el.getBoundingClientRect = () => rect` per instance, because `vi.spyOn` on an instance re-mocks the shared prototype spy).

## Remaining gaps
1. When no slot is clear, `clearOfPulses` silently returns the original spot, which may cover a target.
2. A sentence can name a control ("tap Done", "Pick how good it was") that is in neither the rule's `pulse` nor its `keepClear`. Placement can't know about it and no test catches it.
3. No test covers real layouts at several viewports. jsdom has no layout; only a real browser proves this.

## Layer 1: runtime self-check (FloatingCoach.jsx)
After the final position is chosen, compute the card's box (`coachBox` in placement.js) and intersect it with every pulsing and keepClear rect. On overlap:
- set `data-guide-overlap="<comma list of what it covers>"` on `floating-coach-host`
- `console.warn('[guide-overlap]', ruleId, covered)` once per rule+placement, not every frame (measure runs on rAF, scroll and resize)

This is the oracle for layer 2 and makes production occurrences show up in user logs. jsdom tests: the attribute is absent in the existing pulseClear cases, and present when every slot is blocked.

## Layer 2: Playwright sweep (new spec, e.g. `e2e/guide-no-overlap.spec.js`)
Drive every reachable guide state at viewports 390x844, 768x1024, 1280x800 and 1579x1103. For each state assert:
- `[data-guide-overlap]` count is 0
- every `.coach-target-pulse` element is topmost at its centre (`document.elementFromPoint` returns it or a descendant), unless a modal is open

Check before and after "Got it" where relevant. States (see `GUIDE_RULES` / `GUIDE_STATES` in resolveGuide.js): Annotate (watch, watch.playing, editor, choice, has-plays, selected), Home tabs, Upload modal, Focus steps plus the cockpit, Overlay pick, Finished/share, and the dialogs (`screen: 'modal'`).

Recipes:
- Auth and data: `.claude/skills/drive-app-as-user/SKILL.md`. Use imankh+devfixture@gmail.com via `loginAsRealUser` (`e2e/helpers/realAuth.js`) against the running app: `E2E_BASE_URL=http://localhost:<port> npx playwright test <spec>`
- Zero-plays game without writing data: `page.route('**/api/games/1/load')` and set every array in `body.game` whose key matches `/clip|annot|region|play/i` to `[]` before `route.fulfill`. Read-only.
- Opening the play editor: click `annotate-mark-play-button`. That WRITES a play; delete it afterwards (`e2e/helpers/annotateClips.js` `deleteClip`) or keep it on the routed game.
- Branch CI does not run Playwright: run the sweep locally and record its output as evidence.

## Layer 3: rule-table check (unit test next to `guideRules.pulse.test.js`)
For every rule in `GUIDE_RULES`, find control phrases in its sentence (`GUIDE.*` in `src/frontend/src/config/displayNames.js`), e.g. "tap X", "pick", "drag". Assert each named control maps to the rule's pulse, its keepClear, or an explicit documented `namesOffscreen` / noPulse reason. Keep a small, explicit phrase-to-selector table (greppable, no dynamic registry). Fix any rule it flags (e.g. the editor rule keeps the rater clear today via PLAY_RATING).

## Acceptance
- [x] Layer 1 jsdom tests are red before the change and green after, proven via isolated `git stash` on each production file (CLAUDE.md Landing Policy). `qa/proof.json` C1, C3a, C3b.
- [x] The sweep passes at all four viewports (plus the cockpit). Every state covered and every state not reachable, with the reason, is listed in `e2e/guide-no-overlap.spec.js`'s header comment. Final run: 27 passed, 4 skipped (documented, non-bugs), 2 failed on account-load/infra flake unrelated to the invariant (also documented in the header) -- **zero** overlap or buried findings across the whole run.
- [x] Every real overlap the sweep found was fixed in placement or rule data (Fixes A/B/C above), not by skipping the case.
- [x] Layer 3 test passes; every rule it flagged is fixed (none needed a change beyond the table itself -- the editor rule already keeps the rater clear via PLAY_RATING, as the task predicted).
- [x] `.claude/knowledge/guidance.md` updated: the oracle attribute, the viewport scan, the sweep spec's coverage, the sibling-overlay landmine, the profile-persisted-Guidance landmine, the rule-table test.
- [x] Commit subjects start with `T12800:`.
