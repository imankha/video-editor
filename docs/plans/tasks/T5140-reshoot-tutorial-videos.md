# T5140: Reshoot Tutorial Videos (carousel/poster UI + Team layer; slow narration baked in, 1x playback)

**Status:** TODO
**Priority:** P1 (last task of the "UI Runway -> Tutorial Reshoot" milestone)
**Impact:** 7 | **Complexity:** 4

## Summary

Reshoot all four in-app quest tutorials (annotate / framing / overlay / publish). Two drivers:

1. **The UI has drifted hard since the 2026-07-18 shoot.** The home screen is now a
   poster-tile world (games grid + draft carousels + My Reels tiles), Annotate gained the
   Team / My Athlete layer model, Framing's Export button shows cost, and Overlay's play
   button loops the spotlight. The current videos show screens that no longer exist.
2. **Bake the slow pace into the audio; play at 1x.** Users needed the player slowed
   (DEFAULT_RATE is `0.8` today) to follow the narration. Instead of a runtime slowdown,
   render the voiceover slower at production time and ship videos that are correct at 1x.

**Where the work happens:** `C:\Users\imank\Videos\Captures\ReelBallersTutroials` (NOT this
repo). Read that project's `CLAUDE.md` first — it is the complete map (pipeline, per-quest
capture guide, selector gotchas, no-footprint teardown). This task file adds only what
CHANGED since the last shoot. Prereq: local dev stack on :5173/:8000 against master.

## Do this LAST in the milestone

Every UI-visible near/mid-term task must land first (see the "UI Runway -> Tutorial Reshoot"
milestone in PLAN.md): the Player Intro epic (T5190–T5230) and T4945 (collection download).
Explicitly NOT gating the reshoot: T5750 (evidence-gated), Multi-File Prep epic
(deprioritized), Movement Tracking / Dual-Camera milestones (when those land later, the
affected quest gets a touch-up reshoot, not a full redo), and all refactor/perf/durability
work (no visible UI). If Player Intro slips badly, the reshoot may jump it — tutorials
don't have to demo intros (optional add-on flow).

## Part 1 — Speed: slow the recording, default playback to 1x

- Today: `tts.txt` renders at `rate = +12%` and the app compensates with
  `DEFAULT_RATE = 0.8` ([TutorialVideoModal.jsx:17](../../src/frontend/src/components/TutorialVideoModal.jsx))
  plus the landing twin (`TutorialModal.tsx`). Net perceived pace ≈ 1.12 × 0.8 ≈ **0.90x**.
- Change per quest `tts.txt`: `rate = -10%` (≈ the same perceived pace at 1x). Render one
  quest, listen, adjust ±3% before rendering the rest — this is the single knob.
- Side benefit: slower narration = longer warp windows, so on-screen actions get MORE time
  and fewer jump-cuts. No spec timing changes needed for pace alone.
- **After the new assets are uploaded:** set `DEFAULT_RATE = 1` in BOTH modals (app +
  landing) in this repo, same commit as flipping any speed-menu default. The speed menu
  itself stays (users can still slow down further).

## Part 2 — What changed since the 2026-07-18 shoot (per quest)

### annotate (biggest drift — full rework)

| Change | Task | Impact on video |
|---|---|---|
| Games tab = landscape poster-tile GRID with month captions (was text rows) | T5681/T6310 | Line 2 footage + spec selector (`getByText('at Legends Mar 28')` now lands on a `GameTile`) |
| Home header/hero redesign | T5675 | Opening shot |
| Reel Drafts = portrait poster tiles in per-game carousels (`DraftTile` + `CardCarousel`) | T5672 | "Open a Draft" chapter footage; the framing-chip regex `/\[.+\]: .*\(click to open\)/` is DEAD |
| **Team / My Athlete layer**: per-clip `LayerSegmentedControl` replaces the My Athlete toggle; new clips inherit the last layer (no "New clips go to" toggle) | T5700/T6400 | "The My Athlete toggle marks that this is your player" is now WRONG |
| **Teammate tagging exists ONLY on Team clips** | T5725 | The current track tags a teammate on the My Athlete demo clip — no longer possible |
| Share modal = Google-Docs style: per-recipient clip scope + General-access **public game link** | T5720/T5740 | Share beat footage; public link is a headline feature worth a line |
| Sport list gained Softball (11 sports) | T5695 | The fake in-page sport dropdown (`SPORTS` in the spec) must mirror `tagRegistry.js` again |

### framing (WORKFLOW.md said "don't reshoot" — that no longer holds)

| Change | Task | Impact |
|---|---|---|
| Draft entry = poster tile in carousel (chip selector dead) | T5672 | Opening beat + selectors |
| Export button shows live **output length + credit cost** (1 credit/output-second, slow-mo counted) | T5780/T5790 | New talk line at the Export beat |
| Straighten/rotation tool (hidden-by-default dial) | T5640 | Optional — recommend SKIP to keep the video tight |

### overlay

| Change | Task | Impact |
|---|---|---|
| Primary play = **"Play spotlight" (loops the region)**; de-emphasized "Play full" | T5370/T5570 | "Play it back a couple of times" beat: click the loop button instead of the `currentTime=0` ×3 replay hack |
| Spotlight reveal animation always-on (fade-out at region end) | T5250 | Cosmetic; contact sheets will show fades |
| Tap the circle to edit even with tracking ON | T5610 | Current wording ("turn the player tracker off") still TRUE — keep it; it's the deterministic path |
| Game name + game clock in the clip-info card | T5670 | Cosmetic |
| Aspect-aware video stage (9:16 no longer letterboxed in a 16:9 stage) | T5676 | Scroll choreography in the spec needs re-tuning |

### publish

| Change | Task | Impact |
|---|---|---|
| My Reels = visual tiles; batch Select REMOVED; persistent Play + kebab on tiles | T5673/T5678/T6300 | All My Reels footage + panel selectors |
| Top Play rank badge on ranked tiles | T5679 | Visible during "compilations" beat — optional half-line |
| Smart grouping by tournament / month / opponent | T5880 | Optional half-line at the compilations beat |
| Ready draft has explicit paired CTAs (full-width "Move to My Reels" + preview; corner kebab) | T6180 | "Move to My Reels" wording still right; selectors changed |
| Editable cover image ("View/edit preview image" on completed drafts) + real Remove | T5410/T6380 | Worth one new line |
| Sport-ball playhead handle; segmented progress on ProgressTrack | T5130/T6320 | Cosmetic |
| Animated branded outro + tagline on every export | T5240/T3950 | Optional half-line |

## Part 3 — Recommended talk-track edits (edit `<quest>/talk_track.txt`, then renumber `mark(N)`s)

Keep the chapter (`##`) structure; it survives re-wording. Suggested concrete edits — final
wording is the user's call at shoot time:

**annotate**
- Line 5 (clips listed on left / match in center): unchanged.
- REPLACE "The My Athlete toggle marks that this is your player." with two lines:
  - "Every clip lives on one of two layers — My Athlete for your player's moments, and Team for everyone else's."
  - "Leave this one on My Athlete — it's your player's play."
- REWORK the teammate line (now Team-only): "For a teammate's play, put the clip on the Team layer — there you can tag them by name and share the play to their email later." (Demo option: flip the demo clip to Team, show the tag field appear, flip back — or annotate a second quick Team clip. Prefer the flip: cheaper, no extra data.)
- Share chapter: keep "Share w/ Tagged Teammates", ADD one line for the new headline:
  "You can also copy one public game link for the team chat — anyone can watch the team recap instantly, no signup needed." (ring the General-access section of the share modal)
- Opening lines: re-word "click on the game under the games tab" to reference the game's poster tile ("tap your game's poster under the Games tab").

**framing**
- "Open the Reel Drafts list — each card shows that draft's framing and overlay progress." →
  "Your drafts appear as poster cards under each game — the progress strip shows how far along each one is."
- ADD before "click Export": "The Export button shows the finished length and the credit cost — one credit per second of finished video."
- Keep Dim + watch-through beat unchanged. Skip Straighten (niche, hidden by default).

**overlay**
- "Play it back a couple of times to make sure the spotlight stays locked on." →
  "Press Play — it loops the spotlight section, so you can easily check the spotlight stays locked on." (spec: click the primary play button once; the loop does the replaying)
- Everything else holds; re-verify the scroll beats against the new aspect-fit stage.

**publish**
- "Your reel is now available on its own under the game name." → "...appears as its own card under the game."
- ADD after the play/download/share line: "Want a different cover image? Edit the preview to pick any frame or upload your own."
- Compilations line: optionally extend — "...grouped into compilations like Top Plays and Game Highlights, and by tournament and month."
- Ranking chapter unchanged (flow + "Rank reels" CTA intact; staging/reopen APIs unchanged).

## Part 4 — Capture-spec triage (workflow/capture_specs/)

Expect these to break; re-derive selectors from current markup before shooting (rule 1 in
the tutorial project's "Adapting" section):

1. `tutorial-capture-annotate.spec.js` — game row selector (GameTile), clips-panel staging
   (T3960 auto-select still applies?), My Athlete toggle -> `LayerSegmentedControl`
   (`role=radiogroup`), teammate beat needs the clip on Team, share modal structure
   (per-recipient rows + General access), `SPORTS` list + softball.
2. `tutorial-capture-framing.spec.js` — draft chip regex -> DraftTile poster tile inside
   CardCarousel; Export beat unchanged but button text/area now includes cost.
3. `tutorial-capture-overlay.spec.js` — replace the replay-×3 hack with one click of
   "Play spotlight (loops)" (`button[title="Play spotlight (loops)"]`); re-tune scrolls for
   the aspect-fit stage; color/shape beats re-verify (controls layout may have shifted).
4. `tutorial-capture-publish.spec.js` — drawer tiles not rows; panel-scoping
   (`boundingBox().x > 1490`) re-measure; ready-draft CTAs (T6180); kebab/Play persistent;
   Select-mode staging code (if any) must go; Ranking Progress card CTA re-verify.
5. `preflight.py` — re-verify staged data assumptions (project 53, Legends unlock, ranking
   pool >= 2) still hold on the current dev account.

## Process (per quest, from the tutorial project)

`preflight.py <quest> --fix` -> copy specs into `src/frontend/e2e/` -> shoot via Playwright
-> `from_capture.py` -> `build_video.py --warp` -> `contact_sheet.py` audit ->
`upload_r2.py <quest>` -> revert app-repo e2e files. Renumber `mark(N)` for every
added/removed talk line; keep `mark(N,'word')` words in sync with re-worded sentences.

## Acceptance

- [ ] All 4 roughcuts rebuilt against the current UI; contact-sheet audit passes per sentence
- [ ] Narration pace comfortable at **1x** (tts rate baked in), verified by a human listen
- [ ] `DEFAULT_RATE = 1` in TutorialVideoModal.jsx AND landing TutorialModal.tsx (this repo)
- [ ] `.vtt` + `.chapters.vtt` regenerated + uploaded; `verify_assets.py` green (all 12 URLs)
- [ ] Accounts restored (no-footprint teardown + preflight re-run clean)

## References

- Producer truth: `ReelBallersTutroials/workflow/contract.py`; app copy `tutorialVideos.js`;
  keys `tutorials/{quest}.{mp4,vtt,chapters.vtt}` at assets.reelballers.com.
- Original tutorial task: [T4780](T4780-quest-tutorial-videos.md). Landing tutorial:
  [T3300](T3300-tutorial-video-landing-page.md) — same footage can feed it; consider
  scheduling immediately after this task.
- Quest step boundaries: post-T5150/T5170 (already reflected in the current tracks).
