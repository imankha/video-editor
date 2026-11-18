# T17700 Design: making "Line up" understandable

**Status:** DRAFT, waiting on owner approval
**Author:** ui-designer agent, 2026-11-18
**Task:** [T17700-line-up-hard-to-understand.md](T17700-line-up-hard-to-understand.md)

## Owner summary (plain words)

"Line up" is one button that tries to do two different jobs, and only one of them works:

1. **A second camera filmed at the same time** (mom's phone next to the main camera). The two
   videos are placed by each phone's clock, which is often a few seconds off. Lining up by
   sound fixes this, and it works today.
2. **A video we placed at the end because we couldn't tell when it was filmed.** For a second
   half filmed after the first, the end is already the right place. Moving it a few seconds
   changes nothing you can see, because back-to-back videos always play one after the other.
   The only real fix for this video is when it was actually a second camera.

So the recommendation is:

- **Rename the button "Sync"** and show it only where there is a second camera to sync with.
  The parent's goal is "both cameras show the same moment"; "sync" is the word parents
  already use for this (sound out of sync).
- **Never show it for back-to-back videos.** It cannot help them.
- **For a video we placed at the end, ask one plain question instead:** "Was it filmed at the
  same time as another video?" If yes, the parent sets roughly where it starts, then syncs by
  sound.
- **Rebuild the sync panel as three steps a parent can follow:** listen to each camera, move
  the video earlier or later, tap Done. Buttons say "Earlier" and "Later", not "-1s" and "+1s".
- **Nothing is kept until Done, and X undoes everything** (today a drag keeps the move on
  release; this design removes that surprise).
- A later task (T17710) can sync by sound automatically; this design has a spot for
  "Synced by sound. Adjust if needed."

## What exists today (analysis)

| Surface | File | What it does |
|---|---|---|
| Entry button | `src/frontend/src/modes/annotate/SourceBar.jsx:129-142` | Yellow `Clock` + "Line up", shown only when the ACTIVE video is not the game's original (`active.virtualStart > 0`). Watching the main camera inside a camera overlap hides it. |
| 4+ videos list rows | `SourceBar.jsx:319-334` | "Line up {name} with the game" per non-original video. |
| Timeline camera bar | `AngleLanes.jsx:243-255` | Long-press / right-click opens a one-item menu "Line up this video with the game". Undiscoverable on a phone (no visible hint). |
| Desktop video lane | `VideoLane.jsx` | Desktop only (`AnnotateTimeline.jsx:85`, `!isMobile`). The only drag surface for a back-to-back video, so on a phone such a video can only be nudged 1 s at a time. |
| Strip | `FixTimingStrip.jsx` | Yellow mode-swap strip (style guide "Mode-swap editor strip"): header, one sentence, `-1s -0.1s Moved +3.4s +0.1s +1s`, "Play this camera"/"Play main camera" (camera only), Reset, Done, X. |
| Save | `AnnotateContainer.jsx:800-839` | Done writes once. A DROP after a drag also writes (`endFixDrag` -> `commitFixTiming({keepOpen:true})`), so X after a drag does not undo it. |
| Placement model | `useVirtualTimeline.js:139-155` | Back-to-back games play in upload order (`sequence`), ignoring `offset_seconds`. Moving a back-to-back video only matters if it moves INTO another video's span (it then becomes a camera). |

### Issues identified

- **Line up on back-to-back videos is a no-op that still writes.** Moving a second half by
  a few seconds saves a new `offset_seconds` that nothing reads. The parent sees no change and
  concludes the button is broken. *Recommendation: remove it for back-to-back videos (part of
  this task).*
- **"Line up ... with the game" names no partner.** Lined up with what? The parent can't tell
  which video is the reference. *Fix: always name both ("Sync Mom's phone with Main camera").*
- **Direction is backwards from what the parent hears.** If the whistle comes LATE on the
  second camera, the parent must tap "-". "+/-" reads as math, not as a fix. *Fix: "Earlier" /
  "Later" plus a one-line rule.*
- **Same icon, two meanings.** The amber `Clock` marks "placed at the end, time unknown"
  (`SourceBar.jsx:51`) and the yellow `Clock` is the Line up button. *Fix: give Sync its own
  icon (`AudioLines`), keep `Clock` for "time unknown".*
- **Drop-saves contradict X.** The strip says nothing is kept until Done, but a drag is kept on
  release. *Fix: Done is the only save for a camera (preview already works for cameras through
  `previewVideos`); see Q3.*
- **Hidden entry when watching the main camera.** Inside an overlap, the parent is usually on
  the main camera, where the button is not rendered. *Fix: show Sync whenever another camera
  covers the playhead.*
- **Inline strings** in `FixTimingStrip.jsx` ("Play main camera", "Reset", "Done", "Cancel
  (Esc)", both descriptions, `formatMoved`) and `AngleLanes.jsx:214` ("Drag to nudge ...")
  break copy rule 10. *Fix: move to `displayNames.js` as part of this task.*
- **X has a `title` but no `aria-label`** (`FixTimingStrip.jsx:72-80`). *Fix: add one.*

---

## Q1. When should the parent see it at all?

| Option | When shown | Pros | Cons |
|---|---|---|---|
| A. Always, for every non-original video (today) | Any video after the first | Always reachable | For back-to-back videos it does nothing visible; the owner's confusion |
| B. Only when placement was a guess (no timestamp) | Amber "placed at end" videos | Targets the uncertain case | The guess case is mostly CORRECT (a second half belongs at the end); and real cameras placed by clock, the common out-of-sync case, would lose it |
| C. Only for overlapping cameras | Where a second camera covers the moment | Shown exactly where it works; matches what it does | A misplaced camera (no timestamp) never overlaps, so it can't be reached |
| **D. C plus a question for guessed videos (recommended)** | Cameras: Sync button. Guessed videos: "Filmed at the same time as another video?" | Every case gets the control that actually helps it; nothing shown that does nothing | One more small surface (the question row) |
| E. After a mismatch signal | Only when we detect the cameras disagree | Least noise | Needs sound matching we don't have yet; that is T17710 |

**Recommendation: D.**
- Sync appears in the Videos bar whenever a second camera covers the playhead (whichever
  camera is active), and in the 4+ list for every camera. Long-press / right-click on the
  camera bar stays as a shortcut.
- A video we placed at the end shows the question row while the parent watches it (Q2).
- Back-to-back videos with real filmed times, and the game's original video, never show it.
- E becomes the T17710 upgrade: once sound matching exists, a confident match needs no prompt
  and a failed match can prompt "We couldn't sync by sound. Tap Sync to do it by ear."

## Q2. The entry control, and learning what it does before tapping

| Option | Label | Before-tap learning |
|---|---|---|
| A. Keep "Line up", add tooltip | "Line up" | Tooltip only; phones have no hover. Fails C2. |
| B. "Sync" + icon, with a one-time tip (recommended) | "Sync" with `AudioLines` | A Guidance tip the first time a game with two cameras is opened; full sentence as `aria-label`/`title` |
| C. Longer label | "Sync cameras" | Self-explaining, but crowds the Videos bar at 390px next to two camera segments |
| D. Persistent hint line under the bar | any | Always explains, but permanent clutter for a rare action |

**Recommendation: B.** "Sync" is short enough for the Videos bar on a phone, and a parent who
has seen "out of sync" video knows what it fixes. The button sits where it sits today (right
end of the Videos bar) so the camera names are next to it: "Main camera | Mom's phone | Sync"
reads as "sync these". The first-time explanation is a **Guidance tip** (the existing coach
system, `.claude/knowledge/guidance.md`, so it respects the Guidance toggle and its own
seen-state; no new storage): "This game has a second camera. If the two don't show the same
moment, tap Sync." It pulses the Sync button once.

On desktop the label can read "Sync cameras" from `lg` up (there is room); phones show "Sync".

Placed-at-end videos get no Sync button. Instead, while that video plays, a slim amber row
sits under the Videos bar:

> We put **video (6)** after the other videos because we couldn't tell when it was filmed.
> Filmed at the same time as another video?  **[It comes after]**  **[Same time]**

- "It comes after" hides the row for that video (Q-open 2 on how that is remembered).
- "Same time" opens the place step (Q3).

### Entry mockups

Phone 390x844, watching the main camera inside an overlap:

```
+--------------------------------------+
|                                      |
|              [ video ]               |
|                                      |
+--------------------------------------+
| >  12:04 / 48:10              [ ][ ] |
+--------------------------------------+
| [Main camera] [Mom's phone <>] [~Sync]|   <- ~ = AudioLines, yellow text
+--------------------------------------+
| (i) This game has a second camera.   |
|     If the two don't show the same   |
|     moment, tap Sync.            [x] |   <- Guidance tip, first time only
+--------------------------------------+
|  timeline .......|...........        |
|  cameras    [====Mom's phone====]    |
+--------------------------------------+
|            [ + Mark play ]           |
+--------------------------------------+
```

Phone, watching a video we placed at the end:

```
+--------------------------------------+
|              [ video ]               |
+--------------------------------------+
| >  1:28:40 / 1:28:51          [ ][ ] |
+--------------------------------------+
| [(clock) Video 2 of 2          v ]   |
+--------------------------------------+
| We put video (6) after the other     |
| videos because we couldn't tell when |
| it was filmed. Filmed at the same    |
| time as another video?               |
| [It comes after]        [Same time]  |
+--------------------------------------+
|            [ + Mark play ]           |
+--------------------------------------+
```

Desktop 1440x900, overlap:

```
+--------------------------------------------------------------+------------------+
|                                                              |  Plays list      |
|                        [ video ]                             |                  |
|                                                              |                  |
+--------------------------------------------------------------+                  |
| >  12:04 / 48:10                              zoom  [ ][ ]   |                  |
| Videos  Video 2 of 2  [Main camera] [Mom's phone <>] [~ Sync cameras]           |
+--------------------------------------------------------------+                  |
| timeline ...........|.........................               |                  |
| cameras         [=======Mom's phone=======]                  |                  |
+--------------------------------------------------------------+                  |
|                       [ + Mark play ]                        |                  |
+--------------------------------------------------------------+------------------+
```

Classes for the Sync button: today's `fixButton` classes unchanged (`text-yellow-300
hover:bg-gray-700`, `h-8`, `coarse-pointer:h-11 coarse-pointer:min-w-11`), icon `AudioLines`
16px, label `<span>Sync</span><span className="hidden lg:inline"> cameras</span>`.

## Q3. The sync screen

Keep the yellow mode-swap strip in place of Mark play (style guide pattern; the timeline stays
visible above so the camera bar can still be dragged). Reorder it into the order a parent
works: **listen, move, done**.

| Part | Today | Proposed |
|---|---|---|
| Header | "Line up Mom's phone with the game" | "Sync Mom's phone with Main camera" + X |
| Instruction | one sentence | Step 1 line: "Find a sound both cameras hear, like a whistle or a cheer." |
| Compare | under the nudges | FIRST: "Play Mom's phone" (violet) and "Play main camera" (gray), caption "Each plays the same 3 seconds." |
| Rule | none | "Heard it later on Mom's phone? Tap Earlier." |
| Move | `-1s -0.1s +3.4 +0.1s +1s` | Two labeled rows: **Earlier** `10s 1s 0.1s`, **Later** `0.1s 1s 10s` (10 s is new, so a phone parent can reach a camera that is far off without a drag) |
| Readout | "Moved +3.4s" | "Not moved" / "Moved 3.4s earlier" / "Moved 3.4s later" |
| Bar | drag the orange bar | unchanged, title "Drag to move Mom's phone earlier or later" |
| How do I know it's right | nothing | "When the sound comes at the same moment in both, tap Done." (shown above Done) |
| Bottom | Reset, Done | "Undo moves" (left, quiet), "Done" (right, green) |
| Cancel | X / Esc, but a drag already kept | X / Esc undo everything; Done is the only save |
| No overlap at playhead | A/B buttons silently play nothing useful | A/B buttons disabled, line: "Move the playhead to a moment both cameras filmed." |

Compare buttons stay single-player A/B (there is one video element). They play from the same
game moment, so with a whistle in view the parent hears whether it comes sooner or later.

**Save behavior (changes today's drop-save):** for a camera, the drag previews live through
`previewVideos` and is kept only by Done, exactly like the nudges. The drop-save was added for
back-to-back videos (which can't preview), and those no longer enter this screen. This makes
AC C3 ("saves only on Done, X cancels") true again. The place step below is the only other
write, and it is its own named tap.

**Place step (placed-at-end video, after "Same time"):** a short first step in the same strip.

> **Where does video (6) start?**
> Play the main camera to about where video (6) begins, then tap **Starts here**.
> [Starts here]   [X]

"Starts here" writes the offset once (it is the gesture; the video now overlaps and becomes a
camera, which needs a reload of the timeline to preview), then the strip switches to the sync
step above. X in the sync step returns to that rough spot, and the copy says so: "X keeps it
where you started it." (See open question 3.)

**T17710 slot:** a status line between the header and Step 1:
- "Synced by sound. Listen to check, adjust if needed." (green `AudioLines`), or
- "We couldn't sync by sound. Do it by ear below." (gray)
and the Sync button shows a small green check when an automatic match was kept.

### Sync mockups

Phone 390x844 (strip height about 400px; the timeline above stays visible, the strip scrolls
with the page like Mark play does today):

```
+--------------------------------------+
|        [ video: Mom's phone ]        |
+--------------------------------------+
| >  12:04 / 48:10              [ ][ ] |
| [Main camera] [Mom's phone*]         |
| timeline .......|...........         |
| cameras   [####Mom's phone####]      |   <- orange, draggable
+--------------------------------------+
| ~ Sync Mom's phone with Main ca... [X]|
| (T17710: Synced by sound. Adjust...)  |
| 1. Find a sound both cameras hear,   |
|    like a whistle or a cheer.        |
| [> Play Mom's phone][> Play main cam]|
|    Each plays the same 3 seconds.    |
| 2. Heard it later on Mom's phone?    |
|    Tap Earlier.                      |
|  Earlier   [ 10s ] [ 1s ] [ 0.1s ]   |
|  Later     [ 0.1s] [ 1s ] [ 10s  ]   |
|          Moved 3.4s earlier          |
| 3. When the sound matches, tap Done. |
| [Undo moves]               [v Done]  |
+--------------------------------------+
```

Width check at 390: strip inner width 366px; label column 64px + three 52px buttons + 2 gaps
= 236px per row. Compare row: two buttons `flex-1` wrap to two lines below 340px
(`flex-wrap` is load-bearing, style guide).

Desktop 1440x900 (strip spans the canvas column; two columns side by side):

```
+--------------------------------------------------------------------------+
| ~ Sync Mom's phone with Main camera                                  [X] |
|--------------------------------------------------------------------------|
| 1. Find a sound both cameras hear,     | 2. Heard it later on Mom's      |
|    like a whistle or a cheer.          |    phone? Tap Earlier.          |
|                                        |  Earlier [10s] [1s] [0.1s]      |
| [> Play Mom's phone] [> Play main cam] |  Later   [0.1s] [1s] [10s]      |
|  Each plays the same 3 seconds.        |     Moved 3.4s earlier          |
|                                        |  Or drag the orange bar above.  |
|--------------------------------------------------------------------------|
| [Undo moves]          3. When the sound matches, tap Done.      [v Done] |
+--------------------------------------------------------------------------+
```

Keyboard (desktop): Esc cancels (today), plus Left/Right = 0.1s earlier/later, Shift+Left/Right
= 1s, Enter = Done, while the strip has focus. Focus moves to "Play Mom's phone" on open.

Visual tokens (unchanged pattern): container `rounded-xl border bg-yellow-950/20
border-yellow-800/40 p-3 sm:p-4`; step text `text-sm text-yellow-100/80`; step numbers
`text-yellow-300 font-semibold`; move buttons today's `nudgeBtn` with `coarse-pointer:min-h-11`;
row labels `w-16 text-xs font-semibold text-yellow-200 uppercase tracking-wide`; readout
`text-sm font-semibold text-yellow-100 tabular-nums`; Done `bg-green-500` as today.

## Q4. Wording

All strings move to `ANNOTATE` in `src/frontend/src/config/displayNames.js`. Keys may be renamed
at build time (for example `LINE_UP` to `SYNC`); "today" is the current value.

| Key | Today | Proposed |
|---|---|---|
| `LINE_UP` | Line up | Sync |
| new `SYNC_WIDE_SUFFIX` | (none) | cameras (desktop: "Sync cameras") |
| `LINE_UP_VIDEO` (button title, camera bar menu) | Line up this video with the game | Sync this camera with the main camera |
| `fixTimingFor(name)` (aria, strip header, 4+ list) | Line up {name} with the game | Sync {name} with Main camera (`syncWith(name, mainName)`) |
| new `SYNC_TIP` (Guidance) | (none) | This game has a second camera. If the two don't show the same moment, tap Sync. |
| strip camera text (inline) | Line it up: find a sound you can hear in both, like a whistle or a big cheer, then nudge until they match. | 1. Find a sound both cameras hear, like a whistle or a cheer. |
| new `SYNC_COMPARE_CAPTION` | (none) | Each plays the same 3 seconds. |
| `PLAY_THIS_CAMERA` | Play this camera | Play {name} (`playCamera(name)`) |
| "Play main camera" (inline) | Play main camera | Play main camera (`PLAY_MAIN_CAMERA`) |
| new `syncDirectionRule(name)` | (none) | 2. Heard it later on {name}? Tap Earlier. |
| new `SYNC_EARLIER` / `SYNC_LATER` | -1s / +1s buttons | Earlier / Later (row labels); buttons "10s", "1s", "0.1s" |
| new `syncNudgeAria(name, s, dir)` | (none) | Move {name} {s} seconds {earlier/later} |
| `formatMoved` (inline) | Moved 0s / Moved +3.4s | Not moved / Moved 3.4s earlier / Moved 3.4s later |
| new `SYNC_DONE_HINT` | (none) | 3. When the sound matches, tap Done. |
| new `SYNC_NO_SOUND_HINT` | (none) | No sound? Use something you can see in both, like the kickoff. |
| new `SYNC_NEED_OVERLAP` | (none) | Move the playhead to a moment both cameras filmed. |
| "Reset" (inline) | Reset | Undo moves |
| "Done" (inline) | Done | Done |
| "Cancel (Esc)" (inline title, add as aria-label) | Cancel (Esc) | Cancel and undo moves (Esc) |
| `dragToRepositionTitle(name)` + AngleLanes inline "Drag to nudge {name}" | Drag to reposition {name} / Drag to nudge {name} | Drag to move {name} earlier or later |
| `CAMERAS_HELP` | Other cameras filmed at the same time. Pick a bar to switch. | Other cameras filmed at the same time. Tap a bar to switch, or press and hold it to sync. |
| `FINISH_FIX_TIMING_FIRST` | Tap Done to keep the move first, or X to undo it | Finish syncing first: tap Done to keep it, or X to undo it. |
| new `syncResult(name, s, dir)` (notice after Done) | (none; "Now watching {name}") | Moved {name} {s}s {earlier/later} |
| `appendedFootageTitle(name)` | {name}. We couldn't tell when it was filmed, so it was added at the end of the game. Tap to jump to the start of this video | {name}. We couldn't tell when this was filmed, so it plays after the other videos. Tap to watch it. |
| `appendedFootageToast(name)` | Added {name} after the previous video; it plays through continuously. We couldn't tell when it was filmed, so it went at the end. | Added {name} after the other videos, because we couldn't tell when it was filmed. |
| new `placedAtEndQuestion(name)` | (none) | We put {name} after the other videos because we couldn't tell when it was filmed. Filmed at the same time as another video? |
| new `PLACED_AT_END_NO` / `_YES` | (none) | It comes after / Same time |
| new `placeStepTitle(name)` | (none) | Where does {name} start? |
| new `placeStepText(name)` | (none) | Play the main camera to about where {name} begins, then tap Starts here. |
| new `PLACE_STEP_CONFIRM` | (none) | Starts here |
| new `PLACE_STEP_CANCEL_NOTE` | (none) | X keeps it where you started it. |
| strip back-to-back text (inline) | Drag it on the timeline to where it happened, or nudge it below and tap Done. | (removed; back-to-back videos no longer open this screen) |
| new `SYNC_AUTO_OK` (T17710) | (none) | Synced by sound. Listen to check, adjust if needed. |
| new `SYNC_AUTO_FAILED` (T17710) | (none) | We couldn't sync by sound. Do it by ear below. |
| `VIDEOS_HELP` | The videos in this game. Tap one to watch it. Where two cameras filmed at the same time, tapping switches cameras without moving. | Unchanged here (T17690 owns switching copy). |

Checked against the copy glossary: no em dashes or "->", no "clip" or "angle", Tap not Click,
sentence case, no "Saved", ASCII ellipsis only in truncation. "Camera" is the existing word for
a simultaneous video (`MAIN_CAMERA`, `CAMERAS_HELP`).

## Q5. Edge cases

| Case | Behavior |
|---|---|
| **A video has no sound** (muted phone, re-encoded file) | The compare buttons still play the picture. `SYNC_NO_SOUND_HINT` sits under Step 1 always (we don't know a file's audio today). T17710 will learn which files have sound; then show the hint only for silent ones and skip the automatic attempt for them. |
| **Two halves filmed one after another** | No Sync. They play in upload order and moving one changes nothing. If we placed the second half at the end, the question row offers "It comes after"; that answer is the common one and costs one tap. Wrong upload ORDER is not fixed by this screen (moving does not reorder); flagged as a separate task if the owner wants it. |
| **Two cameras at once** | Sync button wherever they overlap; the full three-step strip. |
| **A video that overlaps nothing** (back-to-back, real filmed time) | No Sync, no question. It is already where its clock says. |
| **Camera only partly overlaps** | Sync opens at the playhead if inside the overlap, else seeks to the middle of the overlap first, so the compare buttons always have a shared moment. If the playhead leaves the overlap during the session, the compare buttons disable with `SYNC_NEED_OVERLAP`. |
| **Parent moves a camera so far it no longer overlaps** | Readout adds "No longer overlaps Main camera", Done still allowed (it becomes a back-to-back video, today's commit logic handles the lane change). |
| **Plays already marked on that camera** | They move with it (they are stored against the file, so they stay on the same picture). No message needed; the timeline shows them shift live. |
| **After Done** | Strip closes, Mark play returns, the camera bar pulses (existing), the Videos bar notice shows "Moved Mom's phone 3.4s earlier" for 1.5s. Done with no change just closes, no notice. Network failure uses the standard "We couldn't [thing]. Try again." toast (existing `patchPlacement` path). |
| **Tapping a video in the Videos bar mid-session** | Unchanged guard, new wording (`FINISH_FIX_TIMING_FIRST`). |
| **4+ videos** | The list's yellow rows become "Sync {name} with Main camera", cameras only; placed-at-end videos show the question row when watched. |

## Consistency notes

- Same mode-swap strip, tint and Done/X structure as the Mark play editor (style guide
  "Mode-swap editor strip"), so it reads as "you are editing something" like elsewhere.
- Violet stays "camera", blue stays "main video", amber `Clock` stays "time unknown"; Sync gets
  its own `AudioLines` icon so no icon means two things.
- The Guidance tip follows the guidance system rather than a new localStorage flag
  (leverage existing systems).
- Sync stays a visible button at rest (style guide "Discoverable affordances"); long-press is a
  shortcut, never the only way.

## Build impact (for classification later)

Presentation and copy, plus three small behavior changes the owner should approve explicitly:
(1) Sync hidden for back-to-back videos and shown for the covering camera when watching the main
camera; (2) drag no longer saves on release for cameras; (3) the placed-at-end question and
"Starts here" place step (one write on that tap), plus 10s nudges. Tests to update:
`SourceBar.lineUp`, `FixTimingStrip`, `AngleLanes.fixTiming`, `VideoLane` (drag-end save).

## Open questions for the owner

1. **Button word: "Sync" or keep "Line up"?** Recommended: **Sync** ("Sync cameras" on desktop).
   Parents know "out of sync"; "Line up" didn't say with what.
2. **How is "It comes after" remembered?** Recommended: **a per-device dismissed flag**
   (the frontend's allowed localStorage exception for dismissed hints). A server field would
   be more correct across devices but is a schema change for a one-tap answer; ask again on
   another device is acceptable.
3. **After "Starts here", should X undo the rough placement too?** Recommended: **no, X keeps
   the rough spot** (one write, stated in the strip). Undoing would need a second write; the
   parent can always move it again.
4. **Drop no longer saves on release for cameras (only Done saves).** Recommended: **yes**;
   it makes X honest and matches AC C3.
5. **Offer reordering for back-to-back videos uploaded in the wrong order?** Recommended:
   **separate task, only if a parent reports it**; not part of T17700.
6. **Add 10 second nudges?** Recommended: **yes**; without them a phone parent cannot reach a
   camera that is far off (no drag lane for big moves on small screens).
