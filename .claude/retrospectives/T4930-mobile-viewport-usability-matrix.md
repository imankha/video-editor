# Retrospective: T4930 - Playwright mobile/viewport usability matrix

**Date**: 2026-07-15
**Complexity**: Complex (L-tier: test infrastructure across every screen, new Playwright projects)
**Duration**: 1 session

## Summary

Built a data-driven, cross-viewport usability audit (`e2e/screen-usability.spec.js` +
`helpers/usabilityAudit.js` + `manifests/screenManifests.js`) that runs three behavioral
invariants — every primary action reachable+clickable, no horizontal overflow, no dead
scroll trap — against every user-facing screen across iPhone / iPhone SE / Pixel 7 / iPad
/ desktop (phones portrait + landscape). Added a synthetic self-check proving the audit
FAILS on the pre-T4880 layout, a `h-screen`/`100vh` lint gate wired into the lint hook +
CI, and updated the testing matrix. The first matrix run surfaced a genuine, previously
unknown mobile bug (T4933) plus two viewport-unit debt sites (T4931/T4932).

## Why the mobile blocker (T4880) survived to production — the core question

Three independent gaps, all structural, each necessary:

1. **No mobile project.** `playwright.config.js` had a single `Desktop Chrome` project.
   Nothing anywhere ran at a phone viewport, so an entire class of layout breakage
   (clipped controls, unscrollable panes, horizontal overflow) could not be observed by
   any test, ever.
2. **No usability-level assertions.** Every E2E test asserted *functionality* ("clicking
   X toggles Y") on a desktop layout where everything is already on-screen. None asserted
   *usability* ("a person can actually reach and press X") — which is the property that
   broke on mobile.
3. **No real-device step in the release flow.** The one failure mode that even a mobile
   emulator can't see — iOS Safari's dynamic toolbar making `100vh` taller than the
   visible viewport — had no gate at all: not a test, not a lint rule, not a checklist
   line. It could only be caught by a human on a real iPhone, and nothing asked for one.

The fix mirrors the three gaps: (1) device projects, (2) reachability/overflow/trap
assertions, (3) a source-level `h-screen`/`100vh` ban + an explicit "real-device required"
line in the testing matrix.

## What Worked Well

- **Manifest-driven, not N copy-pasted tests.** One declarative list of primary actions
  per screen × the project matrix × orientation — coverage scales by data, not by test count.
- **A synthetic self-check (`screen-usability.selfcheck.spec.js`) that needs no backend.**
  It pins the audit both ways (good layout passes; pre-T4880 trap / covered action /
  horizontal overflow all fail) and runs anywhere with just chromium. This *proved*
  acceptance criterion #2 deterministically, independent of whether the live real-user
  matrix could run in a given environment. It also stops the audit from silently rotting
  into a green rubber-stamp.
- **The audit immediately earned its keep.** Its very first run found a real, unknown bug
  (T4933: Annotate clip-editor sidebar controls clipped below the fold on phone landscape)
  that T4880 had not covered — exactly the class of failure it exists to catch.
- **Iterating the trap detector against real DOM instead of guessing.** A quick diagnostic
  spec that dumped the flagged element's ancestor chain turned "is this real?" into a
  five-minute empirical answer.

## What Didn't Work

- **The trap detector was wrong twice before it was right.** v1 keyed on document
  `scrollHeight` — blind, because `overflow:hidden` caps scrollHeight (the overflow is
  simply gone). v2 flagged any clipped interactive element — false-positived on the legit
  `h-dvh overflow-hidden` shell whenever an inner *scrollable* pane held a below-fold
  control. v3 (correct) requires a shell-sized clipper, content clipped *below* the fold,
  AND *no scrollable ancestor* between the control and the shell. Lesson: "reachable by
  scrolling" is the real invariant, and it has to walk the ancestor chain.
- **Device descriptors default to WebKit.** The first matrix run showed 18 "failures" that
  were just `webkit not installed` (iPhone/iPad descriptors default to WebKit; only Pixel 7
  is chromium). Pinning the mobile projects to `browserName: 'chromium'` fixed it and kept
  the matrix CI-portable — but it cost a confusing run to diagnose.
- **A naive self-heal check false-fired.** "Known issue no longer reproduces → fail so it's
  removed" fired on iPhone SE, whose narrow landscape (568px < 640) legitimately doesn't
  render the offending sidebar. Device-scoping the known issue (`appliesWhen: vp.width >= 640`)
  fixed it. Lesson: a known issue is often viewport-conditional, not global.
- **The "app tree is already clean" assumption in the kickoff was false.** 27 `h-screen`/
  `100vh` occurrences remained (T4880 converted exactly one line — the shell). Code is
  truth: the gate had to exempt native-fullscreen CSS (where vh==dvh) and catalogue two
  genuine debt sites loudly rather than pretend the tree was clean.

## Lessons Learned

### For Code Expert
- Selector inventories mined from *passing* specs are far more reliable than selectors
  read out of source — several source-derived selectors were desktop-only chrome
  (`Reel Drafts` breadcrumb is a `<span>` + Back arrow on mobile, not a button).

### For Architect
- "Usability" as an executable contract = reachable + clickable + no-overflow + no-trap.
  Keep it behavioral; pixel snapshots across a device matrix are flaky and off-target.
- Track real-but-pre-existing failures as *self-healing known issues* (throw when they
  stop reproducing) rather than blanket skips — the suite stays green without going blind.

### For Implementor
- When a heuristic detector fires, prove it against the real DOM before filing a bug or
  weakening the check. The ancestor-chain dump was decisive.

### For Tester
- Emulation honesty must be explicit: the iOS `100vh` toolbar bug is *invisible* to
  Playwright. Mitigate with a source-level lint gate + a real-device release line, and
  say so in the code and the docs — don't imply the matrix covers it.

## CI / cost notes

- The Playwright e2e suite is NOT part of GitHub branch CI (that job runs vitest + lint +
  the new viewport gate only). So the 4 device projects add **~0s to GitHub CI**; the only
  CI addition is the viewport gate step (<1s over 383 files).
- In the container/local e2e run (`dev-verify.sh` / `task.sh test`) the audit matrix is
  ~200s wall for all 5 projects (workers:1, sequential): the 4 added device projects
  contribute ~146s (iphone 38s + iphone-se 35s + android 36s + tablet 36s). It is isolated
  to one spec file, so it can be run alone or gated behind a tag if that grows heavy.

## Recommendations

- [ ] Fix T4933 (Annotate landscape sidebar) and remove its self-healing knownIssues entry.
- [ ] Fix T4931/T4932 (convert the two viewport-unit debt sites) and prune KNOWN_DEBT.
- [ ] When adding any new screen or layout, add its manifest entry — make it part of the
      UI change checklist (now reflected in testing-matrix.md).
- [ ] Consider `fullyParallel` for the audit spec if the matrix wall time grows.

## Related

- Task file: `docs/plans/tasks/T4930-mobile-viewport-usability-matrix.md`
- Filed follow-ups: T4931, T4932 (viewport-unit debt), T4933 (Annotate landscape sidebar)
- Origin: T4880 (mobile Framing/Overlay reachability fix)
