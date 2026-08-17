# T5140: Reshoot Tutorial Videos (carousel/poster UI + Team layer; slow narration baked in, 1x playback)

**Status:** STAGING
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
**Execution is split across the two projects — see "How to run this task" below, which
includes the kickoff prompt to paste into a session started in the tutorial project.**

**Updated 2026-08-16:** Part 1 talk tracks revised against the Aug 4–16 landings (Athlete
Intro Card at every egress, Overlay's three-tab settings panel with the Text layer and
Thumbnail frame choice, collection download, quest_4 "Watch Your Preview" step). The
2026-08-03 draft's publish line about uploading a cover photo was removed — the preview
image is now always a frame, chosen in Overlay's Thumbnail tab (T6510/T6590).

## Gating — CLEARED as of the 2026-08-16 prod deploy

**Updated 2026-08-16.** Every UI-visible gate listed in earlier revisions of this note
(Player Intro + Rich Text epic children, T6345/T6350/T6410, the overlay text-editor rail)
has landed on master and shipped. Collection Download also landed (T4945/T7050/T4946/T4947),
so its footage-visible pieces are stable too. The reshoot is unblocked; shoot against
current master. When Movement Tracking / Dual-Camera land later, the affected quest gets a
touch-up reshoot, not a full redo.

## How to run this task (split across two projects)

The reshoot itself (talk tracks, tts rate, capture specs, shooting, building, uploading)
is done **from a Claude session started inside `ReelBallersTutroials`** — that project's
`CLAUDE.md` auto-loads there and is the operating manual; duplicating its pipeline
knowledge here would rot. This repo keeps only what is app-repo work:

| Phase | Where | What |
|---|---|---|
| A. Reshoot all 4 quests | `ReelBallersTutroials` session | Parts 1–4 below: tracks → tts rate → spec triage → shoot/build/upload per quest |
| B. Playback-rate flip | This repo | `DEFAULT_RATE = 1` in `TutorialVideoModal.jsx` + landing `TutorialModal.tsx`, one commit prefixed `T5140:`, AFTER all 4 quests verify green on R2 |

Phase A makes **no commits in this repo** — specs are copied into `src/frontend/e2e/` for
each shoot and reverted after (the tutorial project's teardown rule). Phase B is the only
app-repo diff and lands last, so users never see 0.8×-compensated playback of the new
slower-voiced videos (double-slow) or 1x playback of the old fast ones.

### Kickoff prompt for the tutorial-project session (paste verbatim)

```
Work app-repo task T5140: reshoot all four quest tutorials (annotate, framing,
overlay, publish) against the current app UI.

Read first, in order:
1. This project's CLAUDE.md (and WORKFLOW.md if you need pipeline internals).
2. The task file in the app repo — it is the delta since the 2026-07-18 shoot:
   C:/Users/imank/projects/video-editor/docs/plans/tasks/T5140-reshoot-tutorial-videos.md
   Part 1 = full replacement talk tracks (shoot with THESE, after confirming any
   wording tweaks with me). Part 2 = per-quest UI-drift tables. Part 3 = the tts
   pace change. Part 4 = capture-spec triage list. The structural notes after
   Part 1 flag every mark(N) insertion/removal point.

Scope for this session (Phase A of the task):
- Copy the Part 1 tracks into <quest>/talk_track.txt; renumber mark(N) in the
  specs for every added/removed line (## chapter lines don't count).
- Set rate = -10% in each quest's tts.txt. Render ONE quest's audio first, have
  me listen at 1x, adjust +/-3%, then apply to the rest.
- Re-derive the broken selectors listed in Part 4 from current app markup
  (C:/Users/imank/projects/video-editor/src/frontend/src/) before shooting.
- Re-verify preflight staging assumptions (Part 4 item 5), including at least
  one Athlete Intro Card in the demo profile's library for the publish attach
  beat.
- Per quest: preflight --fix -> copy specs into the app repo's e2e/ -> shoot ->
  from_capture -> build_video --warp -> contact_sheet audit (stop and show me
  sheets that look off) -> upload_r2 -> verify_assets.
- After each shoot, revert the app repo's e2e files and re-run preflight to
  confirm no footprint. Make NO commits in the app repo.

Out of scope here (Phase B, done from an app-repo session after all 4 quests
are live and verified): DEFAULT_RATE = 1 in TutorialVideoModal.jsx and the
landing TutorialModal.tsx.

Prereq: app dev stack on :5173/:8000 against current master (backend with
--reload). Tell me if preflight or dev-login fails rather than working around it.
```

## Part 1 — The scripts: recommended talk tracks (shoot with THESE)

Full replacement tracks below — one sentence per line, ready to paste into
`<quest>/talk_track.txt` after the user's wording pass. Lines are flagged **[NEW]** /
**[REWORDED]** relative to the currently-recorded tracks; unflagged lines are unchanged
(their anchors re-attach automatically). **Any added/removed line shifts every later
`mark(N)` — renumber.**

### Narration principles (why these tracks read the way they do)

1. **Outcome before mechanics** — each chapter opens with what the user GETS ("a spotlight
   that follows your player"), then the click. Matches the advance-organizer approach the
   Framing/Overlay Clarity epic (T3710) validated in-app.
2. **One action per sentence**; the action verb is the `mark(N,'word')` target.
3. **Name UI elements exactly as labeled** (Add Clip, Playback Annotations, Move to My Reels,
   My Athlete / Team, Add Spotlight, Athlete Intro Card) — the ring and the noun must agree.
4. **Every feature gets its payoff in the same breath** (tag a teammate → share to their
   family; rank reels → best highlights lead the compilations). Features narrated without a
   "so that" don't stick.
5. **Don't compensate for the slower voice by cutting words** — the pace is the fix. Cut
   ideas that aren't core instead (Straighten, kebab menus, smart-group mechanics, hover
   previews).

### annotate

```
## Find A Play
To grab your first highlight, start on the home screen.
First pick your sport — here, I'm selecting soccer.
Under the Games tab, every game you've uploaded shows as a poster card, organized by month.   [REWORDED]
Tap your game's card to open it in the Annotate view.                                          [REWORDED]
Your clips are listed on the left, and the full match plays in the center.
## Create A Clip
Scrub through and find a play worth saving.
When you find one, click Add Clip.
This opens the clip editor.
Drag the start and end handles to isolate just the moment you want.
## Describe, Rate & Tag
Describe the clip.
Give it a star rating, add tags like goal or dribble, and provide a short note.
Every clip lives on one of two layers — My Athlete for your player's moments, and Team for everyone else's.   [NEW — replaces the My Athlete toggle line]
This is your player's play, so leave it on My Athlete.                                         [NEW]
Switch a clip to Team and you can tag teammates by name — you'll share their plays with their families later.  [REWORDED — teammate tagging is Team-only now (T5725); demo = flip the layer control, show the tag field appear, flip back]
The Create Reel toggle turns the clip into a reel you'll edit later and publish in high quality.
## Save & Review
When you're done, click Save.
The clip is now saved and rated in your list.
To review your annotated clips, click Playback Annotations.
Your saved clips play back one after another, each with its title on the video.
## Share The Game
The Share button sends every tagged play to your teammates by email.                           [REWORDED]
Or copy one public link for the team chat — anyone can watch the team's plays instantly, no signup needed.   [NEW — ring the General-access section of the share modal]
```

### framing

```
## Open A Draft
Your best clips are now reel drafts.
Before you can publish a draft, you first frame it.
Framing crops the video down to the action, trims it, and adds slow motion.                    [REWORDED]
Each game groups its drafts by stage — pick one that's Not Started to begin.                   [REWORDED — T6810 stage-labeled rows replaced the progress-strip carousel wording]
## Frame Your Player
The white box is your reel's frame — everything inside it is what viewers will see.            [REWORDED — names the box's ROLE, not just its contents]
Drag and resize the box to keep your player, the ball, and nearby players inside.
If your player drifts out, reposition or resize the box.
Each move sets a keyframe, so the frame follows the action across the whole clip.
## Add Slow Motion
To add slow motion, use the Split Segments track below.
Mark the start and end of the key moment, then set that section to half speed.
## Check & Export
Before exporting, switch the background to Dim and watch it through once.
The dimmed edges make it easy to see if your player ever drifts out of frame.
The Export button shows your reel's finished length and its cost — one credit per second of finished video.   [NEW — T5780/T5790]
When it looks right, click Export.
The app upscales it to full HD, and you can frame another reel while you wait.
```

Skip Straighten (T5640) — hidden by default, niche; a tutorial line would send every viewer
hunting for a tool most never need.

### overlay

```
## Open In Overlay
Next, add a spotlight that follows your player — so anyone watching instantly knows who to watch.   [REWORDED — adds the payoff]
Open your reel in Overlay mode.
It loads the working video and automatically detects the players on the field.
## Assign Your Player
Along the timeline, you'll see green markers — one for each moment players were detected.      [REWORDED — says what a marker IS]
Click each marker and tap your player, so the spotlight learns who to follow.                  [REWORDED — adds the why]
Sometimes the tracker misses your player or sits slightly off.
## Place The Circle
When it does, turn the player tracker off and place the circle on your player by hand.
Press Play — it loops the spotlight section, so you can easily check the spotlight stays locked on.   [REWORDED — T5370 loop button; spec clicks Play once, the loop replays]
## Style & Add Spotlight
Next, set how the spotlight looks.
Pick a highlight color that stands out.
Then choose the shape.
Body wraps the spotlight around the player; Ground puts a glow at their feet.
The Text tab lets you burn a title or caption right into the video.                            [NEW — T5225/T6630 text layer; ring the Text tab, don't demo it]
In the Thumbnail tab, drag the marker to choose the frame used as your reel's cover image.     [NEW — T6510/T6590; replaces the old publish-quest cover-image beat]
When you're all set, click Add Spotlight — the app renders it into your reel.                  [REWORDED — says what the button DOES, not just its name]
```

### publish

```
## Preview & Publish
Finally, it's time to publish your reel by adding it to My Reels.
Your spotlight has finished rendering, and the draft is now marked Done.
First, preview it to check that the framing, slow motion, and spotlight all look right.
Then click the Move to My Reels button to publish.
## In My Reels
Your reel now appears as its own card under the game.                                          [REWORDED — tiles, not rows]
From the reel's menu, you can attach an Athlete Intro Card — an animated opening with your player's name, photo, and position.   [NEW — T5215 attachment picker]
It plays everywhere the reel goes — shares, downloads, and playback.                           [NEW — T5220 every-egress]
From My Reels, you can play any reel, download it, and share it.
On mobile, you can even upload directly to your favorite platform.
It's also grouped into compilations, like Top Plays and Game Highlights, and by tournament and month.   [REWORDED — adds T5880 smart groups, half a breath]
You can download a whole compilation as one video, too.                                        [NEW — T4945 collection download]
## Rank Your Reels
To get the most out of compilations, rank your reels from time to time by clicking the first entry in My Reels.
The app shows you two reels side by side and asks which is better.                             [REWORDED — trims "During Reel ranking"]
Each choice sorts your best reels to the top, so your strongest highlights show first within their compilations.
That's the whole loop — from full game footage to a highlight reel you can download and share anywhere.   [NEW — closing payoff; the series' goal is a downloaded reel]
```

**Structural notes for the shoot:**
- publish's "On mobile…" line stays the **beacon-less prep window** (no `mark()`) — the spec
  collapses the published game + scrolls/expands the Game Highlights target there. Keep a
  no-mark line in that slot if the track is re-worded.
- publish's preview line doubles as the quest_4 **"Watch Your Preview"** step (T6840) — the
  capture must actually press play on the Done draft so the step visibly completes.
- annotate's Team-layer beat adds ~2 lines mid-track; overlay adds 2 (Text/Thumbnail);
  publish adds 3 and the old cover-image line is GONE — every `mark(N)` after each insertion
  point shifts; renumber carefully (`##` lines don't count).
- The Athlete Intro Card beat is narrate-over-footage of opening the reel kebab -> picker
  (SELECT -> PREVIEW). Do NOT demo card creation/editing — that's its own future tutorial;
  the attach gesture is the core-loop part.
- Chapter titles are unchanged except annotate's final chapter **"Share The Game"** —
  4–5 chapters per quest is within the 3–6 budget.

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
| Game groups render one labeled draft row per pipeline stage; Not Started tiles at source aspect | T6810/T6800 | Opening beat wording ("by stage") + selectors |
| Export button shows live **output length + credit cost** (1 credit/output-second, slow-mo counted) | T5780/T5790 | New talk line at the Export beat |
| Straighten/rotation tool (hidden-by-default dial) | T5640 | Optional — recommend SKIP to keep the video tight |

### overlay

| Change | Task | Impact |
|---|---|---|
| Primary play = **"Play spotlight" (loops the region)**; de-emphasized "Play full" | T5370/T5570 | "Play it back a couple of times" beat: click the loop button instead of the `currentTime=0` ×3 replay hack |
| **Settings panel is now three tabs: Overlay / Text / Thumbnail** (`OverlaySettingsTabs`) | T6630/T6590 | On-screen the whole quest; selectors + one talk line each for Text and Thumbnail |
| **Text layer**: burned-in rich text — regions/elements on the timeline, drag-to-position on the preview, double-click inline edit, fade-out | T5225/T5180/T6610/T6630/T6720/T6980/T6990 | New [NEW] talk line; do not demo in depth |
| **Thumbnail = frame choice via draggable timeline marker; upload/clear REMOVED** | T6510/T6560/T6590/T5410 | New [NEW] talk line; the old publish-quest "upload your own photo" idea is dead |
| Spotlight reveal animation always-on (fade-out at region end) | T5250 | Cosmetic; contact sheets will show fades |
| Tap the circle to edit even with tracking ON | T5610 | Current wording ("turn the player tracker off") still TRUE — keep it; it's the deterministic path |
| Game name + game clock in the clip-info card | T5670 | Cosmetic |
| Aspect-aware video stage (9:16 no longer letterboxed in a 16:9 stage) | T5676 | Scroll choreography in the spec needs re-tuning |

### publish

| Change | Task | Impact |
|---|---|---|
| My Reels = visual tiles; batch Select REMOVED; persistent Play + kebab on tiles | T5673/T5678/T6300 | All My Reels footage + panel selectors |
| **Athlete Intro Card**: attach from reel kebab / collection picker (SELECT -> PREVIEW -> CONFIRM); plays at every egress (share, download, in-app) | T5215/T5220/T6660/T6700/T6710 | Two [NEW] talk lines; footage of the picker |
| Quest_4 gained a **"Watch Your Preview"** step before Move to My Reels | T6840 | Capture must press play on the Done draft |
| **Collection download**: any compilation downloads as one stitched MP4 with progress | T4945/T7050/T4946 | Half-line [NEW] at the download beat |
| Downloads carry poster cover art + rich metadata | T6360 | Cosmetic (nice in the camera-roll shot if visible) |
| Home defaults to Games; dead-end Reel Drafts tab disabled for new users | T6830 | Opening-shot state; spec staging |
| Top Play rank badge on ranked tiles | T5679 | Visible during "compilations" beat — optional half-line |
| Smart grouping by tournament / month / opponent | T5880 | Optional half-line at the compilations beat |
| Ready draft has explicit paired CTAs (full-width "Move to My Reels" + preview; corner kebab) | T6180 | "Move to My Reels" wording still right; selectors changed |
| Sport-ball playhead handle; segmented progress on ProgressTrack | T5130/T6320 | Cosmetic |
| Animated branded outro + tagline on every export | T5240/T3950 | Optional half-line |

## Part 3 — Speed: slow the recording, default playback to 1x

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

## Part 4 — Capture-spec triage (workflow/capture_specs/)

Expect these to break; re-derive selectors from current markup before shooting (rule 1 in
the tutorial project's "Adapting" section):

1. `tutorial-capture-annotate.spec.js` — game row selector (GameTile), clips-panel staging
   (T3960 auto-select still applies?), My Athlete toggle -> `LayerSegmentedControl`
   (`role=radiogroup`), teammate beat needs the clip on Team, share modal structure
   (per-recipient rows + General access), `SPORTS` list + softball.
2. `tutorial-capture-framing.spec.js` — draft chip regex -> DraftTile poster tile inside
   CardCarousel under stage-labeled rows (T6810); Export beat unchanged but button text/area
   now includes cost.
3. `tutorial-capture-overlay.spec.js` — replace the replay-×3 hack with one click of
   "Play spotlight (loops)" (`button[title="Play spotlight (loops)"]`); re-tune scrolls for
   the aspect-fit stage; color/shape beats re-verify (controls moved into the three-tab
   `OverlaySettingsTabs` panel); new beats ring the Text tab and the Thumbnail tab (drag the
   `Thumbnail marker` on the timeline).
4. `tutorial-capture-publish.spec.js` — drawer tiles not rows; panel-scoping
   (`boundingBox().x > 1490`) re-measure; ready-draft CTAs (T6180); kebab/Play persistent;
   Select-mode staging code (if any) must go; Ranking Progress card CTA re-verify; new
   intro-card beat opens the reel kebab -> Athlete Intro Card picker (SELECT -> PREVIEW,
   cancel without committing, or commit + detach in teardown); preview beat must actually
   play (quest_4 Watch Your Preview); home-tab staging respects T6830 defaults.
5. `preflight.py` — re-verify staged data assumptions (project 53, Legends unlock, ranking
   pool >= 2) still hold on the current dev account; the demo profile needs at least one
   Athlete Intro Card in its library for the attach beat.

## Process (per quest, from the tutorial project — Phase A)

`preflight.py <quest> --fix` -> copy specs into `src/frontend/e2e/` -> shoot via Playwright
-> `from_capture.py` -> `build_video.py --warp` -> `contact_sheet.py` audit ->
`upload_r2.py <quest>` -> revert app-repo e2e files. Renumber `mark(N)` for every
added/removed talk line; keep `mark(N,'word')` words in sync with re-worded sentences.

## Acceptance

Phase A (tutorial project):
- [x] All 4 roughcuts rebuilt against the current UI; contact-sheet audit passes per sentence
- [x] Narration pace comfortable at **1x** (tts rate baked in), verified by a human listen
- [x] `.vtt` + `.chapters.vtt` regenerated + uploaded; `verify_assets.py` green (all 12 URLs) — re-verified 2026-08-17
- [x] Accounts restored (no-footprint teardown + preflight re-run clean); app-repo e2e files reverted, no app-repo commits

Phase B (this repo, after Phase A is fully green):
- [x] `DEFAULT_RATE = 1` in TutorialVideoModal.jsx AND landing TutorialModal.tsx, committed as `T5140:`

## References

- Producer truth: `ReelBallersTutroials/workflow/contract.py`; app copy `tutorialVideos.js`;
  keys `tutorials/{quest}.{mp4,vtt,chapters.vtt}` at assets.reelballers.com.
- Marketing feature inventory (same 2026-08 sweep that produced the Part 1 corrections):
  [docs/marketing/feature-inventory.md](../../marketing/feature-inventory.md).
- Original tutorial task: [T4780](T4780-quest-tutorial-videos.md). Landing tutorial:
  [T3300](T3300-tutorial-video-landing-page.md) — same footage can feed it; consider
  scheduling immediately after this task.
- Quest step boundaries: post-T5150/T5170 (already reflected in the current tracks).
