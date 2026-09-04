# T8520: Overlay is an offer, not a stage

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source; user amendments: card must SHOW what
overlay does, and the skip rate must be measured)

## Problem

When a Focus export completes, the app auto-navigates into Overlay mode with no
explanation and no visible way out except "Add Overlay". The landing page's promised
journey (upload, mark plays, share) never mentions overlays; a first-time user reads
the screen as a mandatory stage and either does unasked work or stalls one screen
before the payoff (walkthrough 2026-09-02, cliff 4).

## Mechanism (verified in source)

Two cooperating pieces fire on framing-export completion:

1. `src/frontend/src/containers/ExportButtonContainer.jsx` - completion arrives via
   WebSocket AND HTTP-poll paths (guarded against double-fire by
   `overlayTransitionFiredRef`, line 185). Four sites call
   `onProceedToOverlay(...)` when `editorMode === EDITOR_MODES.FRAMING`
   (lines ~284, ~358, ~675, ~804). Failure path at line 818 sets
   'Export complete, but overlay transition failed'.
2. `src/frontend/src/screens/FocusScreen.jsx` - `handleProceedToOverlayInternal`
   (passed as the prop at line 1250) stages the working video (blob path or
   MVC/server path with `refreshProject()` around lines 997-1006), calls
   `setOverlayClipMetadata`, `setFramingChangedSinceExport(false)`, then at line
   1023-1025: `if (workingVideoSet) setEditorMode('overlay')` - THE auto-nav.

So the working-video STAGING is valuable and stays; only the final `setEditorMode`
line becomes conditional on user intent.

## What to build

### Step 1 - replace the silent switch with a completion choice

In `FocusScreen.jsx`, replace `setEditorMode('overlay')` (line 1025) with local state
`setShowExportCompleteChoice(true)` and render a small centered (non-fullscreen) card
over the Focus content:

- Title: "Your reel is exported"
- **Illustration (user amendment 2026-09-03): the card must SHOW what the overlay step
  does, not only describe it.** A single visual demonstrating both capabilities at once:
  a spotlight ring tracking the athlete AND an on-video text label. Words alone cannot
  sell a step the user has never seen, and this card is the only place the choice is
  made. Requirements: one asset, static image preferred over video (this is a completion
  screen, no network stall, no autoplay policy fight), fixed aspect box so the card never
  reflows while it loads, meaningful alt text, and it must read at 390px width. Asset
  source is a ui-designer call between (a) a frame grab from the existing overlay
  tutorial `${ASSETS_BASE}/tutorials/overlay.mp4` (quest_3, see
  `src/frontend/src/config/tutorialVideos.js`) exported as a compressed still and served
  from the same assets base, and (b) a purpose-made composite. Prefer (a): it is already
  the shipped visual language for this step. If the pass concludes a still cannot convey
  the tracking motion, a muted looping <2s clip is acceptable, but only with a poster so
  the card is never blank.
- Body: "Add a spotlight overlay? Optional - it draws a glowing highlight around your
  athlete and can add text on the video. Your reel is ready either way."
**Three choices, no "skip" (user directive 2026-09-03).** "Skip" frames the step as
something the user is failing to do. The replacement offers a deferral and a finish, so
every outcome is a positive action:

**Mechanism correction (from the ui-designer pass, `docs/plans/tasks/T8520-T8530-ui-spec.md`,
section 0, source-grounded):** a Focus export produces a WORKING video only. The final
video, the only publishable or shareable artifact, is created exclusively by the OVERLAY
export (`export/framing.py:259-269` vs `export/overlay.py:236`). So at this card there is
no reel yet, and the app currently has no button that means "finish my reel": the only
control that renders the final video is labeled "Add Spotlight"
(`OverlayModeView.jsx:40`). The three choices below are written against that reality, and
they resolve that spec's blocking decision D1 by taking BOTH of its live options as
separate buttons.

| Button | What it does | Result |
|--------|--------------|--------|
| "Add Spotlight" (primary) | `setEditorMode('overlay')`, identical to today's behavior, everything is already staged | user adds a spotlight, then renders the final video as today |
| "Add Spotlight Later" | Navigation only: leave the draft at `DRAFT_STAGE.IN_OVERLAY` and land on the drafts surface, where the Overlay tab stays enabled (`ModeSwitcher.jsx:44,68`) | NO final video yet, and the copy must not pretend otherwise |
| "Finish Now" | Fire the final render immediately with no spotlight, reusing the existing `exportButtonRef` mechanism (`App.jsx:567-568`) so progress, completion and routing stay byte-identical | a real finished reel, landing on T8530's preview surface |

- "Finish Now" is a RENDER, not a publish. Publish stays its own gesture on the preview
  surface (T8530). The overlay export skips the per-second credit check
  (`ExportButtonContainer.jsx:1015-1019`), so this costs the user nothing extra.
- Both non-spotlight buttons use the ui-style-guide secondary variant; "Add Spotlight" is
  the only primary. Do not make finishing look like a punishment for declining.
- **"Add Spotlight Later" persists NOTHING.** No "pending overlay" flag, no reminder state
  (project rules: no persisted view state, no reactive persistence). Its meaning is where
  it lands the user: the drafts surface, reel visibly a draft, Overlay one tap away. A
  durable "spotlight pending" marker would be a schema decision and belongs in its own
  task, not here.
- Copy honesty: only the "Finish Now" branch may say the reel is ready. The deferral
  branch says "later", never "ready".
- Destinations are OWNED BY T8530/T8400. Use one shared navigation helper per destination,
  not three ad hoc navigations.
- NOT dismissible by backdrop click (project rule: no backdrop close); an X maps to
  "Add Spotlight Later", the only choice that starts no work.

Persist NOTHING. If the user navigates away mid-choice, the staged working video
remains in memory exactly as today (Overlay tab is enabled - ModeSwitcher's
`hasWorkingVideo` - so nothing is lost).

### Step 2 - keep every other path byte-identical

- The four ExportButtonContainer call sites and the double-fire guard: untouched.
- `handleProceedToOverlayInternal`'s staging (working video, clip metadata,
  refreshProject, setFramingChangedSinceExport): untouched.
- The Overlay screen itself, its "Add Overlay" export button, and its finish-button
  copy: untouched (T7700 reversed T7580's copy there per user request - do not
  relitigate).
- Re-entry: a user who Skipped can still open Overlay later via the tab (already
  enabled); confirm no regression in that path.

### Step 2.5 - measure the skip (user amendment 2026-09-03)

We must be able to answer "how many users skip the overlay step". Today nothing can
answer it: `overlay_opened` (T3700, `analytics.py:184`) fires on entry, but with today's
silent auto-nav it fires for everyone, and there is no event at all for declining.

Add two events to `FLOW_EVENTS` (`src/backend/app/analytics.py`, ~line 184, next to the
other T3700 per-step events), both `daily_col: None` (engagement dimensions, no new
Postgres column, no new table - reuse the existing `user_actions` action log):

| Event | Label | Fires when |
|-------|-------|-----------|
| `overlay_offered` | "Overlay Offered" | The completion choice card renders (the DENOMINATOR) |
| `overlay_deferred` | "Overlay Deferred" | The user takes "Add Spotlight Later" (or the X): no render started, no reel yet |
| `overlay_declined` | "Overlay Declined" | The user takes "Finish Now": final render starts without a spotlight |

The "Add Spotlight" branch needs no new event: `overlay_opened` already records it, and
after this task that event finally means a real choice instead of an auto-navigation.

The three outcomes sum to `overlay_offered`, which is the property that makes the numbers
auditable: if they stop summing, an exit path is unrecorded. Keep deferred and declined as
SEPARATE events rather than one "skipped" bucket - "I want this but not now" and "I am done"
are different product signals and collapsing them destroys the distinction the user asked
for.

Emit from the same gesture handlers that own the buttons, never from a `useEffect`
watching state (project persistence rule). `overlay_offered` fires in the same handler
that sets `showExportCompleteChoice(true)`, which is a gesture-driven completion callback,
not a reactive watcher.

Admin surfacing: show the PAIR, never a collapsed single rate (project rule: tries and
successes must both be visible, see T8220). The journey/engagement dimensions already
render registered FLOW_EVENTS, so confirm both labels appear there and add the skip rate
only as a derived read alongside both raw counts.

Note the reading caveat for whoever analyzes this later: `overlay_opened` also fires on
later re-entry through the Overlay tab, so
`(overlay_deferred + overlay_declined) / overlay_offered` is the honest skip rate, and
`overlay_opened` alone is not its complement. A user who defers and comes back later shows
up in BOTH `overlay_deferred` and `overlay_opened`, which is correct and is exactly the
number that tells us whether "later" ever happens.

### Step 3 - copy + design pass

The card is new UI: one quick ui-designer pass on layout/copy before implementation
(spacing, button hierarchy, mobile width). Keep the strings above as the starting
proposal; final copy from the pass. No em dashes in shipped copy.

### Step 4 - tests

- Unit (FocusScreen or extracted hook): completion sets showExportCompleteChoice and
  does NOT change editorMode; "Add Spotlight" -> editorMode 'overlay'; "Add Spotlight
  Later" and "Finish Now" -> their respective shared navigate helpers called with
  projectId; each of the three records its event exactly once.
- The overlayTransitionFiredRef double-fire guard still holds (existing tests if any;
  otherwise add one around the choice appearing once).
- e2e: path A (choice -> Add Spotlight -> overlay screen), path B (choice -> Add Spotlight
  Later -> drafts surface, draft still at "in Overlay", Overlay still reachable), path C
  (choice -> Finish Now -> assert the final render STARTED, progress visible; the landing
  itself is T8530's e2e, do not wait out a real render here). All at 1280px and 390x844;
  assert all three buttons in-viewport (T8550).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FocusScreen.jsx` (997-1029, 1250)
- `src/frontend/src/containers/ExportButtonContainer.jsx` (185, 284, 358, 675, 804, 818) - read-only
- `src/frontend/src/components/shared/` - card/button primitives, ui-style-guide skill
- Shared `navigateToFinishedReel` helper - new, co-owned with T8530
- `src/backend/app/analytics.py` (FLOW_EVENTS ~184) - two new engagement events
- `src/frontend/src/config/tutorialVideos.js` - read-only, asset base for the illustration

### Related Tasks
- **`docs/plans/tasks/T8520-T8530-ui-spec.md`** (ui-designer pass, 2026-09-03) is the
  source-grounded spec for this card and T8530's preview player. Its blocking decision D1
  ("what does the second choice do") is ANSWERED by the user's 2026-09-03 three-button
  directive: both of its live options ship, as separate buttons. Read it before
  implementing; where it still says "Skip", the labels above win.
- T8530 (preview + publish) + T8400 (land on the reel) own the destinations -
  build the shared helpers together; whichever lands second rebases
- T7700: Overlay finish-button copy decision stands
- ui-designer pass required before implementation (small)

## Acceptance Criteria

- [ ] No silent editorMode switch on export completion; the choice card appears instead
- [ ] The card shows a spotlight-plus-text illustration, sized so it reads at 390px, with
      no layout shift while it loads
- [ ] The word "skip" appears nowhere in the card; the three actions are "Add Spotlight",
      "Add Spotlight Later", "Finish Now"
- [ ] `overlay_offered`, `overlay_deferred` and `overlay_declined` are recorded from the
      gesture handlers, appear in the admin engagement dimensions, and the three outcomes
      sum to the offers
- [ ] "Add Spotlight" reproduces today's overlay entry exactly (staged video, no refetch)
- [ ] "Finish Now" starts the final render with no spotlight and charges no extra credits
- [ ] "Add Spotlight Later" starts no render, leaves the draft at "in Overlay", and its
      copy never claims the reel is ready
- [ ] No backdrop-close; X = "Add Spotlight Later"
- [ ] Overlay remains reachable later via the tab after skipping
- [ ] Unit + both e2e paths green at 1280px and 390x844
