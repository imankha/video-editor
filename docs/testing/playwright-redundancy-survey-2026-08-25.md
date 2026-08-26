# Playwright E2E Redundancy / Coverage-Overlap Survey — 2026-08-25

**Task:** [T7760](../plans/tasks/T7760-playwright-redundancy-survey.md). Prerequisite for
[T7770](../plans/tasks/T7770-playwright-suite-trim.md)'s suite trim (goal: 4.6h → ≤10min,
driven by removing REDUNDANT coverage, not arbitrary slow-test deletion or more parallelism).

**Companion doc:** [playwright-triage-2026-08-25.md](playwright-triage-2026-08-25.md) triaged
the 144 failures + listed slow tests. It did NOT do this redundancy survey. Where the triage
already surfaced a duplicated helper or stale spec, this doc confirms/refutes it against the
downstream assertions (a shared helper alone is NOT redundancy — what each spec asserts AFTER
the helper is what matters).

---

## Methodology

**Full read, no sampling.** All **140** `src/frontend/e2e/*.spec.js` files were read
(`ls src/frontend/e2e/*.spec.js | wc -l` = 140, matching the task's "140+" estimate). The 140
were partitioned into 9 disjoint slices (every file assigned to exactly one slice — verified by
name against the full `ls` output), and each slice was surveyed by a dedicated agent that read,
for every file: the header docstring, every `describe()`/`test()` title, every locally-defined
helper body, and enough of each test body to identify the user-facing flow + the assertions.
This is a complete census, not a sample. The 9 slices:

| Slice | Cluster | Files |
|---|---|---|
| A | Annotate / clips / segments / timeline | 17 |
| B | Framing / Focus (crop, keyframes, region levers, export estimate) | 13 |
| C | Overlay / text-region / highlights / spotlight editing | 16 |
| D | Intro cards / reference cards / card editor | 15 |
| E | Gallery / My Reels / drafts-drawer / tiles (pt 1) + admin | 15 |
| F | Gallery / tiles (pt 2) + Home + preview-image | 14 |
| G | Collections / share / download / egress / recap / monetization | 15 |
| H | Sync / persistence / update-gate / conflict-alarm | 17 |
| I | Infra / smoke / new-user / tutorial / broad-workflow | 18 |

**What "redundant" means here.** A candidate is only listed when there is a concrete,
mechanically-executable action: delete a whole spec, delete a named test case, merge two specs,
or consolidate a copy-pasted helper. Every file that is genuinely unique is recorded as a
KEEPER so T7770 does not have to re-derive that a spec was already examined.

**Two flavors of finding, kept separate:**
1. **Coverage redundancy** (same application code path asserted twice) — the primary target.
2. **Helper duplication** (same setup copy-pasted) — a DRY/drift concern, called out because
   the triage kept re-diagnosing failures rooted in divergent copies of the same helper. Helper
   consolidation does NOT by itself remove a test; it is listed as secondary hygiene.

**Interaction with the triage's stale/dead findings.** Several specs the triage flagged as
stale (dead API, removed UI) are ALSO the redundant copy of a newer spec. Where that holds, the
recommendation is delete (not "rewrite the stale one"), because a current spec already covers
the path. Those are marked ⟂ below.

---

## Master recommendation table (ranked for T7770 execution)

Ordered roughly by confidence × runtime saved. "Type" = DELETE spec / DELETE test(s) / MERGE /
EXCLUDE from glob / CONSOLIDATE helper. Slow-test cross-refs are to the triage's Slow Tests
section.

| # | Type | Target | Covered-by / rationale | Confidence |
|---|---|---|---|---|
| 1 | EXCLUDE (glob) | `tutorial-capture-{annotate,framing,overlay,publish}.spec.js` (4 files) | Confirmed **zero `expect()`** in all four; dev screen-recording scripts w/ hardcoded Windows capture paths + real render side effects. Not tests. `testIgnore` in playwright.config. Saves ~3.1m+1.6m+… | **Very high** |
| 2 | DELETE spec | `stream-no-401.spec.js` | Entire describe is `test.skip(true)` — 0 executing assertions; cited fixture gap (logged-in + clips) now solved by `loginAsRealUser`. Dead weight. | **Very high** |
| 3 | DELETE spec ⟂ | `T5930-update-gate-single-through-login.qa.spec.js` | 100% dead API (`setUpdateSW`/`setWaitingProbe`/string `requireUpdate`). Scenario superseded by `T6230` real-SW cases 2/4; wiring is Vitest-covered (`updateGateStore.test.js`). Slow: 1.0–1.1m band. | **Very high** |
| 4 | DELETE spec ⟂ | `bug39-update-gate-aggressive.qa.spec.js` | 100% dead API (`checkAppVersion`/`acknowledgeAppVersion` + removed `rb_ack_app_version`). symptom2 duplicates T5930; anti-aggression facets covered by `T6230` case 3 + Vitest. Triage line 79 says "safe to delete." | **Very high** |
| 5 | DELETE spec | `T5180-qa-evidence.spec.js` | 6 tests, **zero assertions** (pure `saveEvidence` + two `setContent` static-HTML screenshots). `T5180-text-parity.spec.js` is the real numeric gate and covers every criterion. | **Very high** |
| 6 | DELETE spec (after fold) | `T5220-egress.qa.spec.js` | Strict subset of `T-egress-livedrive-2026-08-11.qa.spec.js` (same owner-download / share-download / content-disposition). Port its 2 unique checks (`intro`-field-present on `GET /api/shared/{token}`, bogus-token-404) into T-egress, then delete. Slow: none, but removes a real-account run. | **High** |
| 7 | MERGE | `reedit-reel.spec.js` + `rerank-reel.spec.js` → one parametrized `shared-viewer-affordance-gating.spec.js` | Structural twins: identical mock/token/2-assert shape, only the `getByTitle` string differs (`Re-edit`/`Re-rank`). ~110 dup lines → ~40, no coverage lost. | **High** |
| 8 | MERGE | `T5780-framing-effective-duration` + `T5790-export-credit-cost-estimate` | Byte-identical `openFirstFramingDraft`/`trackVisualTotal`/`splitTrack`; both drive the SAME open→split→0.5x→trim. Chip-seconds and `ceil()` credits move in lockstep — assert both in one drive. Keep T5790's modal-match + amber + zero-balance path. Removes 1 of ~4 five-minute-timeout tests. | **High** |
| 9 | MERGE | `T6510-preview-image-frame-choice` + `T6560-preview-image-never-cleared` | Same draft via duplicated `openOverlayDraft`/`waitCanvasReady`/`dragMarkerTo`. Drop T6560's "deliberate drag + reload persists" (T6510 covers it); keep T6560's unique null/422 backend enforcement + no-op-doesn't-write. Removes ~2 of the 5.1m T6510/T6560 timeouts once real bug fixed. | **High** |
| 10 | DELETE test | `game-loading.spec.js` → test 2 ("editorMode state changes on game load") | Re-runs test 1's exact flow, only adds a console listener + screenshot for an internal log test 1 already proves via URL/marker. Strict subset. | **High** |
| 11 | DELETE test | `T5215-e` (collection-share carousel embed) in `T5215-intro-attachment.qa.spec.js` | Strict subset of `T7150-collection-share-intro-sequencing`'s first two tests (same share modal, same embedded-carousel assertion + far more). Removes 1 real-account test. | **High** |
| 12 | DELETE test(s) | `T5215-intro-attachment.qa.spec.js` → fold `b` + `ROUND2-thumbnail-badge` into `ROUND3-ok` | `ROUND3-ok` already proves select→no-write, OK→one-write, immediate badge; `b`/`ROUND2-badge` are weaker subsets. Removes 2 of the file's ~5.2–5.4m timeout tests (triage lines 225/233/240). | **High** |
| 13 | DELETE test(s) ⟂ | `T4550-overlay-transform.qa.spec.js` → test 2 (Overlay highlight/detection finite geometry) | Strict subset of `T5676-aspect-stage-alignment` Criterion-3 (same `openLoadableOverlayDraft` + `svg defs mask ellipse`, plus more). Keep T4550 test 1 (crop round-trip, unique). | **High** |
| 14 | DELETE test | `T5643-move-spotlight-hint.qa.spec.js` → test 3 ("no regression to T5610 gating") | Tracking-off/override-used hint gating already pinned by `T5610-manual-override`'s hint test. Keep T5643 tests 1/2/4 (badge placement + hide-on-frame-select unique). | **High** |
| 15 | DELETE test | `T5644-region-lever-touch.qa.spec.js` → "evidence artifacts" test | Re-drives the same start-right/end-left touch drags already asserted in the two coarse tests; adds only screenshots. Fold `saveEvidence` into those tests. | **Medium-high** |
| 16 | DELETE test | `T6730-seek-back-to-intro.qa.spec.js` → test 2 (synthetic `.click()` probe) | Investigation scaffolding asserting only `probe.f5 toBeTruthy`, documents a resolved measurement artifact via console.log. Test 1 further collapses into test 3 (real-mouse repeated). | **Medium-high** |
| 17 | CONSOLIDATE (3-file) ⟂ | `T6630-round4-evidence` / `T6630-round7-evidence` / `T6630-text-add-remove-drag` | Three chronological rounds of ONE task that partly invalidate each other (round7 corrects round4 preset/region; round6 removed the global "Add Text" button that `text-add-remove-drag` C1/C3/beforeAll still wait on — triage line 205). Keep round7 as base + fold text-add-remove's still-valid C4/C5/C6/C7 (minus dead Add-Text paths); delete round4 G1/G2/G2b; keep round4's unique SW-hygiene/error-banner/no-reflow separately. | **Medium** |
| 18 | DELETE spec (or MERGE) | `T6610-text-body-drag.qa.spec.js` | Core body-move/duration/one-persist/snap/clamp is a `/textdiag.html`-harness duplicate of `T6630-text-add-remove-drag` C5/C6 on the REAL screen (stronger). Delete after confirming T6630 keeps touch + keyboard-nudge + 44px-delete micro-facets; else keep only those three. All 10 tests currently fail on one dead harness (triage #7). | **Medium** |
| 19 | DELETE test(s) | `T5225-text-lever-drag.qa.spec.js` → add/toggle/delete describe | Superseded by `T6630-text-add-remove-drag` C1–C4 (real screen); its "toggle flips enabled" is a weaker harness echo of `T6620-defects`' real-screen eye-toggle-persists. Keep only the lever snap/free-park tests (unique facet). | **Medium** |
| 20 | TRIM tests | `T-egress-livedrive-2026-08-11.qa.spec.js` → items 5a/5b (share routing) | Superseded by `T7350-mobile-share-routing` (keys on the corrected `(pointer:coarse)` mechanism + verifies the matchMedia flip). | **Medium-high** |
| 21 | DELETE test(s) | `regression-tests.spec.js` → 4 @full overlaps | Overlay-load / highlight-init / video-auto-loads / open-created-project @full tests are redundant with `T4550`/`T5450`/`T5642`/`T6190` (deeper). Keep the `Full Pipeline` capstone + the unique `export creates working video` / `export progress advances` / `crop stable` / `spacebar` tests + the 6 @smoke gates. | **Medium** |
| 22 | DELETE / quarantine | `faststart-probe.spec.js` | One-off T1380 prod probe that self-`test.skip()`s now that prod rejects bare `X-User-ID`; guards nothing in CI. | **Medium** |
| 23 | RETIRE (after fold) | `full-workflow.spec.js` upload harness | Third copy of the Add-Game+TSV flow (also in regression @smoke + new-user-flow). Fold its 2 unique clip-edit UI tests + API-CRUD block into regression, retire the triplicated harness. | **Medium** |
| 24 | RETIRE (candidate) | `T4110-reedit-reel-persistence.spec.js` | Investigation spec, all `.soft()` (only 2 guards fire); its own header says `T4120-self-verify-durability` is the HARD-assert successor. Retire once T4120 trusted, or keep purely as a debugging harness. | **Low-medium** |
| 25 | DELETE test | `t5672-carousel-chevrons-auto-badge.spec.js` → "verify all 13 drafts belong to one game" | Data audit with hardcoded `expect(drafts.length).toBe(13)` bound to one live account; no product invariant. | **Medium** |

Helper-consolidation items (secondary, no test removed) are in the per-cluster sections and
summarized under "Helper duplication" below.

---

## Cluster A — Annotate / clips / timeline (17 specs)

**Duplicated-helper lead CONFIRMED.** `gotoGame`, `ensureAddClipVisible`, `createClipViaUI`,
`deleteClip` are copy-pasted **byte-identical** across `T5700-team-layer-interactive`,
`T5700-two-lanes`, `T5725-teammates-team-only`, and (split/near-identical) `T6400-inherit-last-clip-layer`
+ `T7540-annotate-save-tag-trap`. The triage's `ensureAddClipVisible`-in-3+-files lead is real.
→ Extract to `e2e/helpers/annotateClips.js`, adopting T7540's hardened gap-scanning
`openAddClipForm` as the canonical `ensureAddClipVisible` (the triage recommends this hardening
— the hardcoded seek offset is the root cause of the stray-clip-178/179 failures).

**Coverage redundancy (test-level):**
- **`T5700-team` responsive-sweep test** ⊂ `T5700-two-lanes` responsive-sweep (superset: same
  `gotoGame`+`responsiveSweep` plus lane assertions). → delete the T5700-team plain sweep.
- **`T5700-two-lanes` QA2 (390px single track)** ⊂ QA3 (landscape single track, which also adds
  the T4933 delete-button-reachable case). Portrait single-track is also covered incidentally by
  every mobile-390 create test. → delete QA2, keep QA3.
- **`T6400` tests 2/3 (assign layer → new clip inherits)** overlap `T5700-team`'s two
  "new clip gets chosen layer" tests — both exercise the add-clip-form Layer radio + landing
  lane; only delta is inherit-from-previous vs explicit-set. → merge into one add-clip-form-Layer
  spec. T6400 test 1 ("toggle is gone") is a unique cheap absence assertion — keep.
- **`bug38-harness` vs `bug38-autoselect-and-frame-step`** assert the identical two glitches
  (auto-spotlight on main box; paused frame-step changes pixels). Intentional twins (deterministic
  harness vs real-account). If runtime forces a cut, the harness is the keeper (never skips on
  missing detections); the real-account spec's only unique value is real-data confidence.

**KEEPERS (genuinely unique, no action):** `annotate-game-clock` (T4070 playback banner),
`annotate-soccer-times` (T4080 row ordering), `annotate-annotations-render` (T4060 mount-effect —
thinnest smoke, marginal), `clip-selection-state-machine` (T690 fullscreen state machine, only
from-scratch game build), `T5710-per-layer-recap` (recap modal), `T5130-sport-ball-playhead`
(share scrub handle), `T5100-timeline-seek` (collection player seek), `T5647-timeline-autoscroll`
(autoscroll harness), `T5695-softball-sport`, `T4760-pick-hit-area` (ranking pick), `T7540`
(save-auto-commits-tag, unique assertion). Note `T5725` mobile test and `T5700-team` surgical-PUT
+ imported-clip-lock assertions are unique — keep those.

---

## Cluster B — Framing / Focus (13 specs)

**Duplicated-helper lead REFINED — the triage conflated TWO distinct helper families:**
- **Family A — title-regex chip** `getByTitle(/\[.+\]: .*\(click to open\)/)`: `openFramingDraft`
  is **character-identical** in `T4550` and `T4880`; `T6190`'s `openFramingChip` uses the same
  regex (different post-click wait); `T5370`'s `tryReachOverlay` inlines the same regex. →
  consolidate into `helpers/framingDraft.js`, parameterizing the wait selector. This is also the
  single site to fix the `[.+]`-bracket regex bug currently failing these specs.
- **Family B — project-card "Not started"** `openFirstFramingDraft`: **byte-identical** in
  `T5780` and `T5790` (which also share `trackVisualTotal` + `splitTrack` verbatim).

The two families select DIFFERENT drafts and are not interchangeable — so "T5780/T5790/T6190/
T4550/T4880 share a helper" (triage) is imprecise. Only T5780+T5790 share assertions worth
merging (item 8). The others share Family-A setup but assert disjoint things (crop drag accuracy /
mobile clickability / project-open request graph) → keep tests, consolidate helper only.

**Coverage redundancy (test-level):** item 8 (merge T5780+T5790), item 13 (delete T4550 test 2 ⊂
T5676), item 14 (delete T5643 test 3 ⊂ T5610), item 15 (delete T5644 evidence test).

**KEEPERS:** `keyframe-integrity` (pure data-model invariants), `T5380b-cropoverlay-first-drag`
(only deterministic buffering-overlay-eats-first-drag repro), `T6580-order-independent-geometry`
(intro-card geometry), `T5610-manual-override` core (deep spotlight-edit interaction), `T5644`
core, `T6190-project-open-fetches` (only spec asserting the project-open request graph +
render-loop guard), `T4880-mobile-editor-reachable` (only mobile reachability of below-timeline
controls), `T5676` (broadest overlay-alignment/pillarbox), `T5370-spotlight-loop-playback`.

---

## Cluster C — Overlay / text-region (16 specs)

**The text-drag family is the densest overlap in the suite.** Six specs touch text regions;
they split into genuinely-distinct facets vs. real duplicates:

- **DISTINCT (keep, do not merge):** `T6720-text-spatial-drag` (x/y canvas anchor via
  `/textpreviewdiag.html`), `T6880-text-region-render-range` (out-of-range ghost), `T6980-overlay-double-click-text-inline-edit`
  (inline edit sync), `T6990-text-fade-out` (time-ramped opacity envelope). These share a harness
  and click-to-select scaffolding but assert non-overlapping behaviors on different fields.
- **REDUNDANT (items 17-19):** the three `T6630-*` files (consolidate — chronological rounds that
  partly invalidate each other), `T6610-text-body-drag` (harness duplicate of T6630 C5/C6 on the
  real screen), and `T5225-text-lever-drag`'s add/toggle/delete block (superseded by T6630 C1–C4;
  toggle echoes T6620's real eye-toggle). `T5225` + `T6610` also both sit on the same broken
  `textdiag/main.jsx` harness (triage #7) — all 20 tests fail until that one file is fixed.

**Helper duplication:** `readStatus`/`waitForBlock`/`touchDrag` duplicated between T5225 and
T6610; the T6630 boilerplate (`reloadSameOverlayDraft`, `ensureVideoReady`, `tab`, `visiblePanel`,
`clickTextTrackAt`, `waitForRegionListSettled`, `cleanupAllTimelineRegions`) triplicated across
round4/round7/round6 → extract to `helpers/overlayDraft.js`.

**KEEPERS:** `T4900-overlay-action-failure-visibility` (only overlayActionStore failure/retry/toast),
`T5450-overlay-circle-and-loop` (only loop-playback; already self-pruned 8 stale tests),
`T5642-overlay-working-video-presigned` (presigned-URL/CORS video load), `T6480-text-editor-contrast`
(only WCAG contrast — one stale footer sub-case to delete per triage), `T6600-modal-z-order`
(modal stacking), `T5674-overlap-overflow` (cross-screen layout/overflow), `T6620-defects`
(shadow/eye/Full-Name/label defects — its real-screen eye-toggle is the stronger version that
makes T5225's toggle test the redundant one).

---

## Cluster D — Intro cards / reference cards (15 specs)

**Helper duplication (backbone):** nine specs copy the same real-account harness helpers
(`openDrawer`, `expandFirstGroup`, `openManageProfileEdit`, `ensureConsent`, `ensureAtLeastOneCard`,
attach routine) verbatim — `T5215-attachment`, `T5215-round7`, `T6650`, `T6670`, `T6680`, `T6700`,
`T6710`, `T6730`, `T7030` (T5190 near-identical). Stale-string variant (`"Player intro card"`) in
T5215-attachment + T5190; post-T6660 variant (`"Athlete Intro Card"`) in the rest. → one
`e2e/helpers/introFixtures.js`.

**Coverage redundancy:** item 11 (delete T5215-e ⊂ T7150), item 12 (collapse T5215 `b`+ROUND2-badge
into ROUND3-ok), item 16 (delete T6730 test 2).

**The intro-playback quartet is NOT redundant** — four distinct downstream assertions on shared
setup: `T6700` = pre-roll SWAP model + endpoint routing + one-preroll-per-collection; `T6710` =
composite SCRUBBER model (z-index bug, segment divider, backward seek); `T6730` = seek-back-into-
intro reliability after auto-continue; `T7030` = photo actually PAINTS through that seek-back.
Overlap is entirely in setup, not assertions → keep all four; apply the `[role=dialog] video`
scope (already used by T6730/T7030) to fix T6700/T6710's unscoped `page.locator('video')`.

**⚠ Reconcile, don't dedupe (surface to T7770 as a stale-assertion fix, not a cut):** `T5215-a`
still asserts a card can be marked "Your default" while `T6680-criterion-3` asserts "your default"
never appears (default/inherit removed by T6680). Contradictory assertions on the same picker —
T5215-a likely needs its default-badge block removed.

**KEEPERS:** `T5190-intro-upload-consent` (only facts/consent API contract — note consent-endpoint
divergence: T5190 hits `/intro/consent`, T5215-family hits `/intro-consent`; flag, not redundancy),
`T5205-card-editor` (editor composition/drag/zoom/typography), `T5215-round7` (poster-removal —
despite the shared id it does NOT re-run the attach flow), `T6650-intro-photo-ownership` (R2 shared-
object lifecycle), `T6670-inline-create-flow` (inline create+return), `T6680` (negative-space:
default/inherit UI gone), `T7150` (share-freeze/sequencing), `T5820-reference-link-cards`
(cross-profile game links — a different feature, only in this cluster by the word "cards"),
`T5180-text-parity` (the real numeric parity gate that T5180-qa-evidence defers to).

---

## Cluster E — Gallery / My Reels / drafts-drawer / tiles pt1 + admin (15 specs)

**The T5672/t5672 family (5 files) is the drawer/carousel overlap epicenter:**
- `T5672-drafts-tiles-carousel` — the KEEPER (real assertions: portrait tiles, no broken img,
  chevron paging, tile-opens-editor).
- `t5672-arrows-screenshot` — **DELETE (item, screenshot-only):** arrow-style assertions are a
  strict subset of `t5672-carousel-chevrons-auto-badge`'s Desktop test; two tests differ only by
  viewport.
- `t5672-screenshot-verify` — **DELETE/reduce:** clip-count-chip title check already in
  `t5672-carousel-chevrons-auto-badge` Desktop; migrate only the unique "no Auto-created chip"
  assertion, then delete (also has a triage-flagged broken unscoped `text=` locator).
- `t5672-carousel-chevrons-auto-badge` — MIXED: arrow tests are the superset of arrows-screenshot;
  the T6810 stage-row/aspect-split test is unique and high-value; the "13 drafts" audit test is
  account-coupled (item 25, drop).
- `t5672-drawer-aspect-split` — UNIQUE (drawer aspect split, distinct from the DRAFTS-screen split);
  it's also the file exposing the real "My Reels button accessible-name" bug (triage #1).

**T6890 pencil-rename de-dup (item 3 in table):** `T5673-my-reels-tiles` still asserts `Rename`
inside the kebab, but T6890 moved rename to a standalone pencil. `T6890-rename-icon-placement` is
the CANONICAL current owner (asserts pencil placement + rename-start on Game/Draft/Reel). Not a
valid second copy — T5673-tiles is STALE; fix it to drop/replace the kebab-Rename assertion and
defer reel-rename to T6890.

**Move-flow subset:** `T5673-my-reels-tiles` `c2` reaches the Move-to-profile picker→confirm but
never commits; `T4850-move-reels` drives the same picker AND commits + verifies media follow. →
keep the tile-action-presence assertions, drop the duplicated Move-picker walk.

**Helper duplication:** `openDrawer`+`expandFirstGroup` copy-pasted between `T5673-drawer-desktop-width`
and `T5673-my-reels-tiles` → shared drawer helper.

**KEEPERS:** `T4190-my-reels-group-visibility` (game-name + new-chip invariant), `T4850-move-reels`
(full move + R2 media follow + round-trip), `T5673-drawer-desktop-width` (only width-axis spec),
`T5673-drawer-polish` (kebab flip / bottom sheet / rank badges), `T5880-grouping` (axis toggle +
tournament/month), `T4860-admin-bulk-actions`, `T5770-admin-weekly-usage`, `t4800-orphan-drafts`
(auto-reel cascade-delete).

---

## Cluster F — Gallery / tiles pt2 + Home + preview-image (14 specs)

**Do NOT collapse the four "tile action" specs — different components, opposite contracts:**

| Spec | Component | Coarse-pointer contract | Scope |
|---|---|---|---|
| `T5910-tile-hover-actions-pointer` | DraftTile | long-press reveals (still present) | pointer-gated reveal, 3 tests |
| `T6180-ready-tile-primary-action` | DraftTile (ready) | fine only | ready-state primary/kebab-items/delete-arm/body-tap |
| `T6300-reel-tile-persistent-actions` | **ReelTile (My Reels)** | persistent kebab, NO long-press | **SUPERSET** — fine+coarse-Win+iPhone, menu-flip, all-actions-fire, NEW-dot |
| `T6420-tile-preview-desktop-hover` | ReelTile preview child | coarse = no preview | orthogonal hover-preview feature |

T6300 is the ReelTile superset, but T5910/T6180 are a DIFFERENT tile component with *opposite*
coarse expectations, and T6420 is an orthogonal feature. No safe cross-file merge here.

**Coverage redundancy:** item 9 (merge T6510+T6560), item 10 (delete game-loading test 2). Trim:
`T5675-home-hero-legibility`'s tile-render+clip-count block duplicates `T5681`'s overlay coverage,
and its trailing `responsiveSweep` re-sweeps the Games grid T5681 already sweeps → keep the unique
wordmark/above-fold/continue-strip/chess-notation assertions, drop the duplicated tile+sweep tail.

**Helper duplication:** `openMyReelsAndExpand`/`openDrawer`+`expandFirstGroup`/`openMyReels` (3
copies across T6300/T6320/T6420) and `gotoGamesHome`/`openGamesTab`/`gotoGames` (4 copies across
T5675/T5681/T6310/game-loading) → two shared helpers.

**KEEPERS:** `T5677-home-deeplinks-route-fallback` (routing/URL-as-state), `T5681-games-poster-grid`
(GameTile superset), `T5860-collectionplayer-modal-backdrop` (modal-contract harness), `T5900-reel-preview-overflow`
(preview containment geometry), `T6310-games-skeleton` (skeleton geometry), `T6320-my-reels-playhead`
(playhead glyph), `T6420` (hover-preview stream-request accounting).

---

## Cluster G — Collections / share / download / egress / recap / monetization (15 specs)

**`@staging-gate` (excluded from local runs — unique coverage, do NOT trim):** `derisk-staging-endcard-copylink`
(end-card CTA/UTM + copy-link dedup), `derisk-staging-export` (export/publish pipeline — the only
producer spec; triage's likely-real-regression at line 140), `T5290-recap-mobile-redesign` (recap
geometry). A local suite-health pass will not exercise these.

**Coverage redundancy:** item 6 (delete T5220 ⊂ T-egress-livedrive after folding 2 checks), item 20
(trim T-egress-livedrive items 5a/5b ⊂ T7350).

**Keep the T5330 / T5330b pair intact** — despite a shared "recipient sees Get Started QuestPanel"
assertion, they guard orthogonal mechanisms: T5330 = backend quest-count materialization; T5330b =
frontend `shared_annotation_flow` sessionStorage lifecycle. Not redundant.

**T7040 vs T7100 are different paths:** T7040 = the `/api/collections/download` whole-collection
stitch (API bytes); T7100 = per-reel download FEEDBACK UI (spinner/toast/scrim). No assertion
overlap → keep both.

**Helper duplication:** `openMyReelsAndExpand`/`openMyReelsAndFirstReel` copy-pasted across T7100,
T7350, T-egress-livedrive (echoed in collections + derisk-endcard) → shared `helpers/myReels.js`.

**KEEPERS:** `collection-share` (public viewer 410/403/empty state machine, mocked), `collections`
(negative structural: no switcher/pills, no overflow), `T7650-top-plays-locked-ui-confusion`
(locked-state copy clarity), `t4940-monetization-qa` (only credits/repricing spec).

---

## Cluster H — Sync / persistence / update-gate / conflict-alarm (17 specs)

**UPDATE-GATE FAMILY (4 files) — confirmed against source** (`updateGateStore.js` exposes only
`setSwReloader`/`requireUpdate({needsMigration})`; `appVersion.js` no longer exports
`checkAppVersion`/`acknowledgeAppVersion`):
- `T6230-update-gate-real-sw` = **canonical current spec** (real SW, probe-based T6210 mechanism,
  no dead API). Keep.
- `T5930` + `bug39` = 100% dead API AND duplicate each other's core scenario (raced version-
  mismatch + waiting SW → single skipWaiting). → **DELETE both** (items 3 & 4).
- `T5070` = partially salvageable: tests A (blocking/no-dismiss affordance) + C (flush-verify 503
  barrier + no-reload) cover facets T6230 lacks → rewrite those 2 against current API or fold into
  T6230; delete B (dead `reason` field) + D (reload = T6230 case 4).

**CONFLICT-ALARM CLUSTER (3 files)** — all defeated by the same root cause (unmarked `returned_home`
`recordAchievement`) but testing DISTINCT facets:
- `T5960` = `conflict` gating (original).
- `T6010-T6020` = `failed` gating (symmetric) + **T6020 marker-classification (UNIQUE — the only
  tests exercising `rbLifecycleWrite`/`rbNonDataWrite` + export-start/auth-write arming; T6020 is
  the guard for the exact marker the triage says `recordAchievement` is missing)**. BUT T6010's 4
  conflict-pin tests (passive→no-alarm / edit→alarm / retry-clears / conflict-regression) duplicate
  T5960 wholesale → merge those into T5960 or delete from T6010; keep T6010's `failed`-specific +
  all of T6020.
- `T6040` = the reader-NOTICE facet (quiet notice + Reload) + full status matrix (newest, most
  complete); c2/c3 are explicit regression pins of T5960/T6010 — keep as pins.
- The only cross-file duplicate assertion is "passive load → no alarm" (one line, different
  `X-Sync-Status` each). Helper duplication is heavy: `installStatusShim`/`authAndLoad`/`pagePing`/
  `pageWrite` copy-pasted across all three → `helpers/syncStatusShim.js`.

**T5870 vs T6010 overlap noted but KEEP both:** T5870 drives the REAL backend sync fault (only
end-to-end real-backend failed-retry proof); T6010 injects the header via `page.route` (frontend
gating logic). Different layers.

**KEEPERS (unrelated domains, no overlap):** `T4100-dedup-honest-message`, `T4120-self-verify-durability`
(canonical durability; T4110 is its soft investigation predecessor — retirement candidate, item 24),
`T4260-no-duration-patch` (negative-network guard for a deleted reactive write), `T5350-clip-sync-failed-frontend-ux`
(clip-toast variant, distinct surface from the banner), `blob-url-recovery`, `request-storm-regression`,
`profile-switch-isolation`, `bug27p-expired-annotations`. (Several of these — blob-url, cache-warming,
keyframe-integrity — are effectively in-page unit tests that could move to Vitest; noted, not a redundancy cut.)

---

## Cluster I — Infra / smoke / new-user / tutorial (18 specs)

### REQUIRED: regression-tests.spec.js @smoke/@full vs individual T-specs

`regression-tests.spec.js` uploads a local test video through the Add-Game modal as an isolated
empty user, then runs 6 `@smoke` (parallel, first-frame) + 10 `@full` (serial, full-pipeline)
tests. Mapping to deeper individual coverage:

| regression-tests test | Tag | Deeper individual coverage | Verdict |
|---|---|---|---|
| Annotate: video first frame loads | @smoke | annotate-annotations-render / -game-clock / -soccer-times / full-workflow | keep-as-smoke (fast cross-cutting gate; narrow specs assume video loaded) |
| Annotate: TSV import shows clips | @smoke | full-workflow (deeper — asserts export content); new-user-flow | redundant-with-full-workflow for depth; keep as smoke gate |
| Annotate: timeline click moves playhead | @smoke | clip-selection-state-machine (deeper selection state machine) | keep-as-smoke (unique fast seek check) |
| Framing: video first frame loads | @smoke | T4550 / T4880 / T6190 | keep-as-smoke (broad Framing-loads gate) |
| Framing: crop window stable (no infinite loop) | @smoke | T4550 / T5380b (deeper crop-drag) | **unique** (only React infinite-loop guard) |
| Framing: spacebar toggles play/pause | @smoke | none | **unique** |
| Create project from library clips | @full | full-workflow (shallower) | keep (unique end-to-end create-from-library; failing on stale helper) |
| Framing: export creates working video | @full | T5780 / T5790 (adjacent metadata, not the export) | **unique** (only real framing-export + `has_working_video`) |
| Overlay: video loads after framing export | @full | T4550 / T5450 / T5642 (deeper) | **redundant** — keep only as pipeline continuity |
| Overlay: highlight region initializes | @full | T5450 / T4550 (deeper highlight) | **redundant-with-T5450/T4550** |
| Framing: video auto-loads opening existing project | @full | T6190 (deeper project-open) | **redundant-with-T6190** |
| Framing: keyframe data persists after reload | @full | keyframe/persistence specs (stronger) | **redundant** (weak assertion here) |
| Framing: export progress advances properly | @full | none | **unique** (progress-SLA) |
| Framing: per-clip edits persist after switch+reload | @full | framing persistence (partial) | keep (soft, only multi-clip switch-persist e2e) |
| Full Pipeline: Annotate→Framing→Overlay→Final Export | @full | none | **unique** (capstone) |
| Framing: open automatically created project | @full | T6190 + duplicates "auto-loads" above | **redundant** |

**Net (item 21):** keep all 6 @smoke gates + the unique @full tests (`export creates working
video`, `export progress advances`, `Full Pipeline`, `crop stable`, `spacebar`, `create from
library`, `per-clip persist`); delete/trim the 4 redundant @full tests (`Overlay video loads`,
`highlight init`, `video auto-loads`, `open auto-created project`). Also fix the stale shared
`navigateToProjectFromHome` helper (dead `"Your Reels"` + `16:9` selectors — triage lines 88-90).

### Other slice findings
- **tutorial-capture-* (4 files):** confirmed **zero `expect()`** in every file — screen-recording
  scripts, not tests (item 1, EXCLUDE from glob).
- **reedit-reel + rerank-reel:** structural twins → merge (item 7).
- **faststart-probe:** self-skipping dead prod probe (item 22).
- **full-workflow upload harness:** third copy of Add-Game+TSV → retire after folding unique bits
  (item 23).
- **new-user-flow vs T4770 vs full-workflow:** NOT interchangeable — `new-user-flow` = asserting
  quest journey; `T4770-new-user-flow-perf-walkthrough` = perf instrument (asserts measurement
  validity, read-only over existing account); `full-workflow` = Annotate+API smoke. Keep all three.
- **screen-usability + screen-usability.selfcheck:** complementary (matrix + meta-test guarding the
  matrix from rotting to green). Keep both.

**KEEPERS:** `staging-smoke` (cheapest gate probe), `screen-usability` (+selfcheck), `cache-warming-console`,
`new-user-flow`, `T4770`, `T4780-tutorial-quest-steps` (tutorial-player UI, distinct from journey),
`T3980-dev-login-real-data` (the real-data contract that T4770/screen-usability/staging-smoke depend on),
`T7590-mobile-add-game-modal-reachable` (short-viewport modal geometry).

---

## Helper duplication (secondary hygiene — consolidations, not test removals)

Each is copy-pasted across ≥2 files and has caused divergence-rooted failures the triage kept
re-diagnosing. Extract per suggested module; no coverage changes.

| Helper(s) | Copies in | Suggested home |
|---|---|---|
| `gotoGame`, `ensureAddClipVisible`, `createClipViaUI`, `deleteClip` (+ T7540's hardened `openAddClipForm`) | T5700-team, T5700-two-lanes, T5725, T6400, T7540 | `helpers/annotateClips.js` |
| Family-A `openFramingDraft`/`openFramingChip` (title-regex) | T4550, T4880, T6190, T5370 | `helpers/framingDraft.js` (also fixes the bracket-regex bug) |
| Family-B `openFirstFramingDraft` + `trackVisualTotal` + `splitTrack` | T5780, T5790 | folded into item 8 merge |
| `readStatus`/`waitForBlock`/`touchDrag` + T6630 boilerplate | T5225, T6610, T6630-round4/round7 | `helpers/overlayDraft.js` |
| intro harness (`openDrawer`, `expandFirstGroup`, `openManageProfileEdit`, `ensureConsent`, `ensureAtLeastOneCard`, attach) | 9 intro specs | `helpers/introFixtures.js` |
| `openMyReelsAndExpand`/`openDrawer`+`expandFirstGroup`/`openMyReels` | T6300, T6320, T6420, T5673-tiles, T5673-width, T7100, T7350, T-egress-livedrive | `helpers/myReels.js` |
| `gotoGamesHome`/`openGamesTab`/`gotoGames` | T5675, T5681, T6310, game-loading | `helpers/gamesTab.js` |
| `installStatusShim`/`authAndLoad`/`pagePing`/`pageWrite` | T5960, T6010, T6040 | `helpers/syncStatusShim.js` |

---

## Estimated impact for T7770

- **Whole-spec removals/exclusions:** 4 tutorial-capture (glob-exclude) + stream-no-401 + T5930 +
  bug39 + T5180-qa-evidence + T5220 + faststart-probe, plus 2→1 merges (reedit/rerank,
  T5780/T5790, T6510/T6560) — on the order of **10-12 spec files** off the local suite.
- **Test-case removals within kept specs:** ~15-20 individual cases (T5215 collapse, T4550 test 2,
  T5643 test 3, T5644 evidence, T6730 test 2, game-loading test 2, regression @full overlaps,
  T5700 sweep/QA2, T6010 conflict-pins, T-egress 5a/5b, the "13 drafts" audit, etc.).
- **Several of the removed/merged tests are in the triage's 5-minute-timeout cluster** (T5215
  attach tests, T6510/T6560, T5780/T5790) — so the trim targets the exact runtime hot spots, per
  the "no code path checked twice" directive rather than blind slow-test deletion.
- **Not a runtime lever but correctness:** the T5215-a vs T6680 default-badge contradiction should
  be reconciled (stale-assertion fix), and the T6700/T6710 unscoped-`video` scope fix applied.

**Caveats stated honestly:** the 3 `@staging-gate` specs carry unique coverage but won't run in a
local sweep. Some "delete because stale + redundant" items (T5930, bug39, T5070 B/D) assume the
cited Vitest coverage (`updateGateStore.test.js`) is confirmed present before removal — verify that
first. The impact counts above are estimates from the survey, not a measured runtime delta; T7770
should measure after each batch.
