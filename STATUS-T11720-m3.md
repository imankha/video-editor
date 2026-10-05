# T11720 — Gate review fixes (MAJOR/MAJOR/MINOR), PR 565

**New head SHA:** `749cdf76f5f9dda341e64535d007507fc29b49a1`
(`T11720: portrait-reachability AC1 assertion + live evidence refresh`, on `feature/T11700-frame-unlock`)

## 1. MAJOR (reviewer) — T11720 AC1 reachability assertion

**File:** `src/frontend/e2e/T11700-frame-unlock.qa.spec.js` (new `assertReachableAboveLockedBand()` helper, lines ~75-106; called at lines 168-170)

Added a real assertion that, with the LOCKED compact band on screen at 390x844, the
timeline (`[data-testid="focus-timeline-block"]`) and the "Trim and slo-mo" control
(`[data-testid="advanced-editing-disclosure"]`) are:
1. scrolled into the viewport (`toBeInViewport()`),
2. **not covered** by the compact band — proven via a real DOM hit-test
   (`document.elementFromPoint` at a point inside the element's bounding box,
   checked against the band element and against the target itself), and
3. actually clickable — a Playwright `click({ trial: true })`, which runs every
   actionability check including "receives pointer events" (fails if another
   element intercepts the point).

**Minimal production change:** `src/frontend/src/modes/focus/FocusMode.jsx` — added
`data-testid="focus-timeline-block"` to the existing timeline wrapper `<div>` (no new
DOM node, no layout/class change). This was the one markup hook needed: the timeline
had no stable selector.

### Sanity check (mutation proof) — exactly as requested

Mutated `src/frontend/src/modes/FocusModeView.jsx` line 1072, the sticky band
wrapper's className, changing:
```
sticky bottom-0 z-30 mt-4 sm:mt-6 -mx-3 sm:-mx-4 relative overflow-x-clip
```
to:
```
sticky bottom-0 z-30 -mt-48 sm:mt-6 -mx-3 sm:-mx-4 relative overflow-x-clip
```
i.e. replaced the top margin with `-mt-48` (a large negative top margin), pulling the
sticky band up to visually overlap the content rendered above it — the literal
"the band floats over the content above it" bug from the original T11720 problem
statement. (First tried `sticky` → `fixed`; that did NOT reproduce a failure, because
the compact band is only ≤56px tall and `App.jsx`'s `pb-48` (192px) bottom padding
keeps it clear of the content regardless of position scheme. The negative-margin
mutation is the one that actually reproduces visual overlap.)

Ran `e2e/T11700-frame-unlock.qa.spec.js` against the mutated code (Vite picked it up
in ~2s under `CHOKIDAR_USEPOLLING=true`). Result — **the new assertion failed, exactly
as required**:
```
Error: Trim and slo-mo (locked @390): compact band must NOT cover it at (78,638) [hit=action-band-compact]
expect(received).toBe(expected) // Object.is equality
Expected: false
Received: true
  105 |   expect(probe.bandCovers, ...).toBe(false);
1 failed
```
Reverted the mutation (`git checkout -- src/frontend/src/modes/FocusModeView.jsx`),
confirmed the Vite dev server served the clean code again (`-mt-48` string count went
to 0 in the served module), and the spec passed again (see evidence below).

## 2. MAJOR (proof-verifier) — fresh logs against the confirmed-current stack

### (a) Staleness fix
The container's Vite dev server and backend were both killed and restarted from
scratch via `.devcontainer/container-stack.sh` with `CHOKIDAR_USEPOLLING=true
MODAL_ENABLED=false STACK_RELOAD=0` exported first (so the child `npm run dev`
inherits polling — confirmed to work: the mutation above was picked up in ~2s).
Verified via the served module itself, not just a banner: fetched
`http://localhost:5173/src/modes/focus/FocusMode.jsx` and grepped for the new
`focus-timeline-block` testid (want ≥1) before every run below.

### (b) SHA + spec hash recorded at the top of every log
Each of the three log files below starts with a header block:
```
git_head_sha=749cdf76f5f9dda341e64535d007507fc29b49a1
git_head_subject=T11720: portrait-reachability AC1 assertion + live evidence refresh
spec_file=<path>
spec_sha256=<sha256 of the exact spec file on disk at run time>
run_started_utc=<timestamp>
frontend_served_testid_check=1   <- confirms fresh code served, not stale
```
All three specs were run via `bash scripts/dev-verify.sh e2e/<spec>.spec.js --reporter=line`
AFTER the `749cdf76f` commit landed (the spec files on disk at run time are byte-identical
to what's in that commit — the sha256 in each header is the proof).

### (c) Fresh raw logs

| Log | Result | Spec sha256 |
|---|---|---|
| `/tmp/e2e-m3-fu.log` | **1 passed (1.9m)**, exit 0 | `31fbc6d3a7509b7b0343ccb63c385b860b633cdea56c5b30bbc66e8c88dcf214` |
| `/tmp/e2e-m3-t8510.log` | **4 passed (6.7m)**, exit 0 | `e7c20dd5a468e9b1388947904188dd5731b1c7d9d70b7f9f687991539ed46d2c` |
| `/tmp/e2e-m3-t4880.log` | **1 passed (2.7m), 1 skipped** (Overlay needs an exported reel — unrelated, documented pre-existing skip), exit 0 | `5234d1a6e72524a0cee7f2535475b0bf2da9f67beac216ff100b99da3205563e` |

(`T8510`'s run took 6.7m, much slower than its usual ~1.5m — the shared dev stack was
under load from the mutation-sanity-check runs immediately prior; the earlier attempt
at this same run looked "stuck" at the 6-minute mark and I killed/retried it, which
is why there is a stray-clip note below. All times are real Playwright-reported
durations, not estimates.)

Evidence screenshots (20 total, `qa/*.png`), including the new one proving the fix:
`qa/T11700-live-390-locked-timeline-reachable.png` plus the existing locked/unlocked/
settings-open/768/1440 set, T8510's compact-band/caption/unlock shots, and T4880's
portrait/landscape/desktop (699/768/1024/1440) set.

### (d) Dev-account cleanup
These specs write to `imankh+devfixture@gmail.com` (the `reference_dev_fixture_account`
house-standard fixture account — NOT `imankh@gmail.com`, whose dev profile has no
seeded games; this has been true since the fixture-gap fix two reviews ago). Every
spec creates its own unframed draft via `createUnframedDraft()` (the clip-save write
path) and deletes it in `afterEach`/`finally`. One stray clip (`id=348`,
`"QA unframed draft 1791208280341-0"`) was left by a duplicate T8510 run I started by
mistake while debugging a slow/apparently-hung first attempt (see note above) — that
duplicate process died mid-test without reaching its own `afterEach`. Found it via a
scan (`GET /api/clips/raw?game_id=11`, filtered on the `"QA unframed"` name prefix)
and deleted it (`DELETE /api/clips/raw/348` → `200`). Final scan across games
11/6/1/2/3 confirms **zero stray clips** remain.

## 3. MINOR — knowledge doc staleness

**File:** `.claude/knowledge/keyframes-framing.md` (Epic A entry, the e2e paragraph)

Replaced the "HONEST-SKIP/can't-go-green in the /dotask container... fixture-limited"
language with an accurate description: the fixture gap was closed by
`createUnframedDraft()` (clip-save write path, `_create_auto_project_for_clip`), all
three specs now create their own draft and run **green** against the dev stack, the
account is `imankh+devfixture@gmail.com` (house standard, not the default
`imankh@gmail.com`), and AC1's real promise (reachable-above-the-band, not just
band-height) is now asserted via the hit-test described above, proven to fail when
the band is mutated to overlap.

## Commands run (for reproduction)

```bash
# Stack restart with polling (fixes stale-dev-server landmine)
export CHOKIDAR_USEPOLLING=true MODAL_ENABLED=false STACK_RELOAD=0
bash .devcontainer/container-stack.sh

# Confirm fresh code served
curl -s http://localhost:5173/src/modes/focus/FocusMode.jsx | grep -c focus-timeline-block   # => 1

# The three fresh runs
bash scripts/dev-verify.sh e2e/T11700-frame-unlock.qa.spec.js --reporter=line
bash scripts/dev-verify.sh e2e/T8510-export-guard.qa.spec.js --reporter=line
bash scripts/dev-verify.sh e2e/T4880-mobile-editor-reachable.spec.js --reporter=line

# Curated unit set + lint (pre-commit)
cd src/frontend
npx eslint src/modes/focus/FocusMode.jsx e2e/T11700-frame-unlock.qa.spec.js
npx vitest run src/modes/focus/overlays/CropOverlay.test.jsx src/modes/FocusModeView.cropOverlayProps.test.jsx \
  src/modes/FocusModeView.setFocusPoint.test.jsx src/modes/FocusModeView.framingActionRow.test.jsx \
  src/modes/FocusModeView.advancedEditing.test.jsx src/modes/focus/cockpit/__tests__/FocusCockpit.test.jsx \
  src/components/ActionBand.test.jsx src/components/ExportButtonView.test.jsx \
  src/modes/focus/FramingActionRow.test.jsx src/modes/focus/FramingInstructions.test.jsx
# -> 10 files, 102 tests passed
```

## Scope confirmation

No production logic changed except the one-line `data-testid="focus-timeline-block"`
addition to `src/frontend/src/modes/focus/FocusMode.jsx`'s existing timeline wrapper
`<div>` — purely a test hook, zero layout/behavior change (confirmed: it's the same
element, same className expression, same children; only the attribute was added).
Everything else is test/spec/doc.
