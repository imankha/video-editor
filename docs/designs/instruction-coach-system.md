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
