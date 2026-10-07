# Instruction Coach System

## Purpose

Create one coaching system for short, contextual instructions across Focus (Frame Highlight), Overlay (Spotlight), Annotate, and the Home/project surfaces.

The system should put the instruction beside the control or content the user is acting on, while keeping the copy short, readable, and consistent. A coach is temporary UI state, not persisted project data and not a replacement for accessible labels or button titles.

## Design direction

Use a dark indigo coach card with a violet accent edge and a small target pointer. It should feel like one component whether it is floating over a video, attached to a timeline control, or placed in a page shell.

Visual rules:

- Surface: `#111827`/gray-900 with 96% opacity and a subtle backdrop blur.
- Border: 1px white/20 plus a 2px violet/70 accent on the side nearest the target.
- Text: primary instruction in 15px (`text-sm`), line-height 1.35, white; supporting text in 13px, gray-300.
- Progress: a compact amber or violet badge (`Frame 2 of 4`, `Step 3 of 5`) with semibold text. Do not put progress in the sentence.
- Padding: 12px 16px on desktop, 12px 14px on compact phone layouts. The card must have at least 12px of internal space on every side.
- Width: 280px max for floating coaches, 360px for a page coach. Copy wraps to at most three lines; longer explanations become an optional “Why?” disclosure.
- Radius: 12px. Shadow: `0 10px 30px rgb(0 0 0 / 28%)`.
- Target pointer: 8px rotated square, same surface and border, positioned on the target-facing edge. It is decorative and `pointer-events-none`.
- Motion: 180ms fade/translate on phase changes; pulse only the target control. Respect `motion-reduce` by removing both transitions and pulse animation.

The card has two emphasis levels. `coach` is the normal contextual card. `coach-strong` is reserved for a required next action such as Generate Highlight. Strong emphasis uses a brighter violet border and a visible target ring; it does not enlarge the text or create a competing second banner.

## User flow

Every coach follows the same lifecycle:

1. `intro` — explain the current action and identify the target.
2. `active` — show the short action copy while the user works.
3. `confirmed` — acknowledge the completed action briefly, then advance after a short delay or the next render-state update.
4. `complete` — remove the coach when the task is complete.

The coach should never cover the target. A placement resolver measures the target and the safe viewport rectangle, tries the preferred side, then flips to the side with the most room. If neither side fits, it clamps to the safe rectangle and switches to compact copy. It should not use a render loop or repeatedly set placement state; recompute only when the target rect, viewport, phase, or compact breakpoint changes.

The target may be a DOM element, a video-pixel rectangle, or a semantic anchor such as `timeline`, `primaryCta`, or `annotateMarkPlay`. The resolver converts all three to a viewport rectangle before choosing placement.

## Shared architecture

### `InstructionCoach`

One presentational component in `src/frontend/src/components/instructions/InstructionCoach.jsx`.

```jsx
<InstructionCoach
  model={coachModel}
  targetRef={targetRef}
  targetRect={videoTargetRect}
  placement="auto"
  onDismiss={dismiss}
/>
```

It renders the card, badge, primary/supporting copy, progress, pointer, and optional action. It owns no workflow state and never imports Focus, Overlay, or Annotate stores.

### `useInstructionCoach`

One hook in `src/frontend/src/hooks/useInstructionCoach.js` handles presentation state:

```js
{
  visible,
  phase,
  compact,
  placement,
  cardRect,
  targetRect,
  announceText,
  dismiss,
}
```

It uses `ResizeObserver` for the card and target, `visualViewport`/window resize for the safe area, and a single `requestAnimationFrame`-coalesced measurement pass. It does not subscribe to application stores. It exposes `data-testid="instruction-coach"`, `data-placement`, `data-phase`, and `data-compact`.

### `InstructionCoachHost`

An optional host in the screen shell provides a portal and stacking context. The host is responsible for safe-area insets, fullscreen/mobile surfaces, and z-index. A screen can render one host and multiple named slots, but only one coach is visible at a time per surface.

### Content registry

Keep user-facing copy in `src/frontend/src/config/instructionCatalog.js`, separate from general display names. Entries are typed by purpose:

```js
{
  id: 'focus.preview.generate',
  title: 'Generate Highlight',
  body: 'When you’re satisfied with the preview, click Generate Highlight.',
  tone: 'strong',
  target: 'focus.primaryCta',
}
```

Dynamic progress is data, not string concatenation in views: `{ kind: 'frame', current: 2, total: 4 }` renders through the shared badge formatter. This keeps “Frame 2 of 4” consistent across Overlay and future flows.

## Migration by surface

### Focus / Frame Highlight

Replace `FramingGuide` with `InstructionCoach` rendered through the Focus host over the video stage. Keep the existing guide derivation in `FocusModeView` temporarily, but return a coach model instead of `{ step, text }`. Move the existing drag, play, keep, preview, watch-preview, trim, and generate copy into the catalog.

The target resolver should point at the crop box, play control, trim timeline, Preview button, or primary Generate CTA. The final Generate state uses `coach-strong` and pulses only the CTA. Remove the separate sticky banner after the new host has parity coverage.

### Overlay / Spotlight

Keep `useGuidedAthletePick` as the workflow state machine. Replace `SpotlightPickGuide`'s card markup and placement effect with `InstructionCoach`. Pass the active detection rectangle as `targetRect`; pass the stage as the safe rectangle. The existing “flip away from obstacle” behavior becomes the shared resolver's preferred placement.

Copy becomes frame-based: “Set the player tracker around your player on 4 different frames,” “Frame 2 of 4,” and “Go to frame 2.” The progress dots remain an optional `progress` slot, styled by the shared component.

### Annotate

Convert the inline `mark-play-helper` into an Annotate coach anchored to the Mark Play control. Its model should be derived from the same first-run state already used to decide whether the helper appears. Use a one-line primary body by default; put the clip-length explanation in supporting text or a dismissible “Why?” disclosure.

The coach should move with the Mark Play control on phone, desktop, and fullscreen layouts. Do not add a second copy source in `AnnotateModeView`; the screen supplies only the model and target ref.

### Home / project manager

Start with contextual, non-blocking coaches for the first meaningful action: upload a game, open a game, or review an existing play. The Home host should anchor to the relevant CTA or empty-state action and use the page width variant. These coaches are dismissible and should be remembered only as a per-user onboarding preference if product later requires persistence; the component itself remains stateless.

## Accessibility and interaction

- The card uses `role="status"` for progress updates and `aria-live="polite"`; do not announce every playback tick.
- The target remains keyboard reachable and retains its visible focus ring. The coach never captures focus unless it contains an explicit action.
- An optional close button is at least 44px and has an accessible name. Dismissal is available by Escape when the coach is interactive.
- Color is supplementary: progress has text, and the target pulse is paired with a label.
- The card is not the only place the instruction exists. Button names, tooltips, and screen-reader labels remain complete without it.

## State and persistence boundaries

Workflow state stays with the owning screen or hook (`FocusModeView`, `useGuidedAthletePick`, Annotate first-run state). Presentation state stays in `useInstructionCoach` and is memory-only. Do not persist active phase, placement, pulse state, or measured rectangles. A future onboarding preference may persist dismissal separately, keyed by feature and user.

## Testing plan

Unit tests for `InstructionCoach` cover typography classes, padding, progress badge, reduced motion, pointer placement, compact copy, aria-live behavior, and target/action test hooks. Resolver tests cover preferred placement, flip, clamp, safe-area insets, and no-overlap when there is room.

Each workflow keeps a small state contract test:

- Focus: drag → play → preview → preview completes → Generate is strong/pulsing.
- Overlay: frame 1 → frame 2 → all frames set, including away/resume and compact layouts.
- Annotate: first-run helper appears at Mark Play, follows its target, and disappears after the first play.
- Home: empty-state coach anchors to the intended CTA and dismisses without affecting navigation.

The existing Spotlight responsive QA remains the browser-level placement proof. Add one shared visual QA harness with a synthetic target rectangle so all placements can be checked at phone, tablet, laptop, and desktop sizes without needing a real uploaded game.

## Delivery sequence

1. Land tokens, catalog, resolver, `InstructionCoach`, and host with unit tests.
2. Migrate Focus and Overlay behind feature-local adapters; run their current suites unchanged.
3. Migrate Annotate's helper and add its anchor/first-run tests.
4. Add the Home empty-state coach.
5. Remove `FramingGuide`, the old Spotlight card styling, and duplicated placement utilities after the adapters have no remaining callers.

This sequencing keeps each workflow's behavior stable while the presentation system becomes shared. It also leaves a clear rollback boundary at each screen until the old components are deleted.

## Annotate copy and the Brilliant path

Annotate's coaching should teach the habit first and the highlight path second. The coach is anchored to the Mark play control while the game is being watched:

| State | Primary copy | Supporting copy | Target/action |
| --- | --- | --- | --- |
| First visit, no plays | `Play the game. When you see a great moment, press Mark play.` | `We save the moment around your tap so you can review it.` | Mark play |
| After the first play | `Keep marking the moments worth saving.` | `Rate a play Brilliant when you want to turn it into a highlight.` | Mark play / rating row |
| A play is rated Brilliant and has no portrait highlight | `Brilliant play. Make a portrait highlight to focus on your player.` | `Portrait is the best place to start for a player-focused clip.` | Portrait highlight action |
| A Brilliant play already has a portrait highlight | `Your portrait highlight is ready to edit.` | `Add Spotlight when you want to make your player stand out.` | Open portrait / Spotlight |

The Brilliant coach appears after the rating is persisted and only for the selected play. It is a strong coach with a direct Portrait action; it does not interrupt playback or automatically navigate. “Keep Marking Plays” remains the explicit dismiss action in the existing choice card. The coach should not repeat after dismissal during that session, and a future preference can suppress the nudge for that play permanently.

The existing `ANNOTATE.MARK_PLAY_HELPER` text is the first candidate to replace. Its capture-window detail (`6 seconds before` and `2 seconds after`) is useful secondary information but should move into the supporting line or a “Why?” disclosure so the primary instruction stays short. The existing `FRAME_LOCKED_HELP_RATE`, `HIGHLIGHT_CHOICE_TITLE`, `MAKE_HIGHLIGHT_NOW`, and `BACK_TO_EDITING` strings remain the fallback for states where the coach is disabled or unavailable.

## Home copy inventory and migration

The current Home guidance that belongs in the coach catalog is:

- Games empty state: `Review game footage` / `Mark plays from game video you want to review with your athlete. Create highlights you want to use.`
- Games footer: `Have a highlight already? Skip ahead on Clips.`
- Games partial state: `Cut your first play` / `Tap Mark play on each moment worth keeping.`
- Clips empty state: `Focus the action on your athlete.` / `Highlights you marked can be framed. Framing focuses the camera on your player and lets you trim and add slo-mo to key moments. A short highlight can also skip straight to Framing, no game needed.`
- Clips context actions: `Open a game and tap Mark play.`, `Already have a video?`, and `No game needed.`
- Clips partial state: `Give each highlight a Framing pass` / `Add an optional Spotlight, then finish it whenever you are ready.`
- Published empty state: `View your completed work.` / `Download or share links with family, coaches, and recruiters. If you install the app on your phone you can even post to social directly.`
- Division of work: `You mark the best plays and frame your player. We smooth the motion, sharpen the picture, and build a highlight you can share.`

The migration should not turn every empty-state paragraph into a floating tooltip. Keep the headline and one-sentence explanation in the empty page when there is no nearby target. Move action-oriented lines into coaches anchored to Upload game, Mark play, Open a game, Add video, Frame, and Publish. The longer published/download explanation stays as page guidance until there is a concrete target.

## Global coach toggle

The system has a user preference, enabled by default:

```js
settings.guidance = {
  coachEnabled: true,
};
```

`useInstructionCoach` reads this preference and returns `visible: false` for every coach when it is off. It must also cancel placement observers, timers, announcements, and pulse state while disabled. Turning it back on should make the current eligible coach available immediately without resetting the workflow state.

Persist the preference through the existing `useSettingsStore` and `/api/settings` pathway, alongside framing and overlay settings. Add `setCoachEnabled(value)` and a selector such as `useGuidanceSettings()`. The backend default must be `true` so new and older accounts receive coaching. The optimistic UI update should use the existing settings save/revert behavior.

Expose the toggle in one discoverable place under Settings as `Show helpful instructions`, with a short description: `Show tips near the action you are working on.` When coaches are off, show a small non-coaching confirmation after the toggle changes: `Helpful instructions are off. You can turn them back on in Settings.` Do not put a second toggle on each screen. A contextual “Turn instructions back on” link may appear in the empty coach slot only when off, but it must route to Settings rather than silently changing the preference.

The preference is account-scoped and syncs across devices. It is separate from per-coach dismissal: turning coaching off is global, while dismissing a Brilliant nudge affects only that nudge/session. Tests should cover the default-on state, backend-loaded false state, optimistic save failure/revert, disabling an active coach, and re-enabling it without losing the workflow phase.
