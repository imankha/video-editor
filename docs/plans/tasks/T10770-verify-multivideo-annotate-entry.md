# T10770: Verify Annotate-entry clip selection on a MULTI-VIDEO game

**Status:** WAITING ON USER (verification complete, PASS — no code changed; awaiting Resolve)
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-20
**Updated:** 2026-09-20

**Handoff context:** [HANDOFF-T10760-T10770.md](HANDOFF-T10760-T10770.md) — sequencing, environment facts, and the traps from the originating session.

**Follows:** T10750 (merged, PR #480, `b5239417`) — verifies a claim that task could not test.

## Why this exists

T10750 rewrote how Annotate selects a clip on entry. Its consuming effect
(`AnnotateContainer.jsx`, the `pendingSelectTargetRef` effect) has a precondition:

```js
if (!multiVideo && !(videoDuration > 0)) return;
```

The `multiVideo` exemption is **reasoned from source, never driven live** — the dev environment has
only single-video games, so there was nothing to click through. It is the one claim in T10750 with
no direct evidence, which is exactly why it is worth an hour.

The reasoning being verified (a reviewer caught the first version of that gate, which lacked the
exemption and would have silently broken this path):

- `AnnotateScreen.jsx` renders the proxy's A/B video elements and passes `handlers={{}}` when
  `multiVideo` is truthy.
- `useVideo.handleLoadedMetadata` is the ONLY writer of the store `duration` that this gate reads,
  and it is wired only through `handlers` — so on a multi-video game that duration stays `0` for the
  whole session.
- Meanwhile `effectiveSeek` is the PROXY's seek (`useVideoProxy.js`), which resolves against the
  virtual timeline and never consults that duration, so it has no clamp-to-0 failure mode.
- Therefore gating on it there would discard every navigation breadcrumb on a game with added
  footage — invisibly, since the gate returns before the "matched no region" warn.

**If the exemption is wrong in the other direction** (i.e. the proxy seek DOES need a readiness
gate), the symptom will be: clip selected but playhead parked at 0 / outside the clip, and the
selection immediately wiped by the playhead-driven auto-deselect.

## What to do

1. **Get a multi-video game.** Dev has none. Either:
   - add footage to a game on the dev fixture account (`imankh+devfixture@gmail.com` — 8 real games;
     see the `dev-fixture-account` memory), using the "Add footage" button in Annotate; or
   - run the check on staging against an account that already has one.
   Confirm it really is multi-video: the game has 2+ `game_videos` rows / the Annotate timeline shows
   more than one source.
2. **Drive the reported path** (real clicks, not store manipulation — see Traps):
   - Home -> open a clip of that game in Focus (this is what leaves the breadcrumb).
   - Mode switcher -> Annotate.
3. **Assert:**
   - the reel's source clip IS selected on arrival (`[data-testid="annotate-stage-cta"]` present,
     Clip Details panel shown);
   - the playhead sits INSIDE the clip's range, not at 0;
   - console shows no `matched no region` warn and no `Refusing seek`;
   - no burst: `[SelectClip] Found region` / `[DetectionSeek] SEEK requested` should be single
     digits, not ~40 (that burst was the T10750 bug).
4. Repeat for a clip on the SECOND video sequence, not just the first — the virtual-timeline offset
   math (`fullTimeline.sourceTimeToVirtual`) only matters there.

## If it fails

Do not re-add a retry loop — that is precisely what T10750 removed, and the
`.claude/knowledge/annotate.md` invariant explains why a retry there cannot work (lane starvation).
The right fix is a readiness signal the PROXY actually owns (e.g. the proxy's own loaded state),
used as a precondition in the same one-shot.

## Traps (paid for in the T10740/T10750 sessions)

- **Do not verify via `page.evaluate` store reads.** `await import('/src/stores/...')` from Playwright
  returns a DIFFERENT module instance than the running app once Vite has HMR'd, so seeded/inspected
  state is a phantom. Symptom: `projectsStore.projects.length === 0` while the UI clearly shows
  projects. Drive with real clicks and observe the DOM + network + console.
- **A full page load resets every store** — so any precondition must be established after the last
  navigation, and `openGameInAnnotate` (e2e helper) navigates.
- **Verify the dev server actually serves your code** before trusting a result (`curl` the module
  through Vite and grep for your change).

## Acceptance Criteria

- [x] A genuinely multi-video game exists in the test environment (state which, and where)
- [x] Focus -> Annotate on that game selects the reel's source clip, playhead inside the clip
- [x] Verified for a clip on a non-first video sequence
- [x] No select/seek burst, no `matched no region`, no `Refusing seek`
- [x] Result recorded here (pass = close it; fail = file the proxy-readiness fix, do NOT retry-loop)

## Result (2026-09-20) — PASS

**Environment:** dev, `imankh+devfixture@gmail.com`, game id 11 ("Game uploaded Sep 20"), created via
"Upload game" with 2 files at once (`uploadMultiVideoGame` create-time path — the existing-game
"Add footage" attach path is separately broken, see T10790, filed below; unrelated to this
verification and not on the code path this task exercises). Confirmed via direct DB read:
`game_videos` has 2 rows (sequence 1: 300.84s, offset 0; sequence 2: 89.32s, offset 300.84).

**Repro driven exactly as specified** (real clicks via Playwright MCP against the running dev
stack, fresh full page load before each check — see Traps): Home → click a clip card → Focus opens
→ click the "Annotate" mode-switcher button.

- **Clip on video sequence 1** ("Play 1", local start 18.69s): settled state showed playhead at
  `00:00:18.688`, Clip Details panel open on "Play 1", header badge "0'18" · Brilliant · Play 1".
  Exact match.
- **Clip on video sequence 2** ("Play 2", local start 27.17s, offset 300.84): settled state showed
  playhead at `00:05:28.007` = 300.841867 + 27.165584, Clip Details panel open on "Play 2". Exact
  match — this is the case with no prior direct evidence per the task's "Why this exists" section.
- Console: no `matched no region`, no `Refusing seek`, in either run.
- **One transient, non-blocking observation**: on both runs (including after a hard reload,
  ruling out stale client state), a single `[AutoDeselect] Deselecting clip_<id> playhead: 0.00
  clipVirtual: 18.69 - 26.69 seq: 1 regionAtPlayhead: none` fires once during init — before the
  `useAnnotate` "Auto-Initializing with duration" log reports the FULL multi-video duration — then
  the real one-shot correctly selects the target clip. This looks like an early render picking up
  a default/first-region reference before the multi-video timeline duration resolves, immediately
  self-corrected in the same pass (not a retry, not a loop, no visible flicker, final state
  correct both times). Distinct from the T10750 bug class (that was an infinite retry storm; this
  is a single harmless transitional log). Not filing a task for it — flagging here in case a future
  session sees the same log and wonders.

**Side finding (unrelated to T10750/T10760, filed separately):** the dev backend was found running
a 2-day-old, non-`--reload` process serving stale schemas (a `rating: int` pre-T10700 schema),
which produced a false-negative 422 while marking the first test play. Restarted per the
documented `uvicorn --reload` command; unrelated to this task's verdict, mentioned only so a future
session isn't confused by old `python.exe -m uvicorn ... --port 8000` processes with no
`--reload` flag sitting around in this shared dev environment.

**Verdict:** PASS. T10750's `multiVideo` exemption is correct in both directions the task worried
about. Safe for T10760 to proceed and re-run this same check afterwards as its regression gate.
