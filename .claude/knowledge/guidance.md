# Guidance (coach pulses and guide sentences)

The coach says ONE sentence per screen state and pulses the ONE control that sentence names.
Epic F (T12730-T12770) made that a single path.

## Entry points
- `src/frontend/src/components/instructions/resolveGuide.js`: `GUIDE_RULES` (first match wins per `screen`), `resolveGuide(facts)`, `GUIDE_STATES` fixtures, `resolvePickGuide` (Overlay pick channel), `homeFacts`.
- `components/instructions/guideTargets.js`: `GUIDE_PULSE` names (value = the control's testid where it has one) and `GUIDE_PULSE_CLASS`, the ONLY place the string `coach-target-pulse` lives besides `index.css`.
- `components/instructions/GuideScope.jsx`: `<GuideScope guides={[guide, ...]}>` and `useGuidePulse(target|[targets], {suppress})`.
- Sentences: `GUIDE.*` in `config/displayNames.js`.

## Invariants
1. **Every rule has `pulse` (a GUIDE_PULSE value, or an array when the sentence names two controls, e.g. Annotate watch = Play + Mark play) XOR `noPulse` (reason string).** Enforced by `instructions/guideRules.pulse.test.js`, which also requires each named target to have a consumer outside `instructions/`.
2. **Guidance on/off is decided once**, in `GuideScope` (`useGuidanceSettings().coachEnabled`). Controls never read the setting. Outside a scope nothing pulses; innermost scope wins (a modal does not inherit the screen's pulse).
3. **A control opts in with `useGuidePulse(GUIDE_PULSE.X)`** (or the `guideTarget` prop on Button, ActionCard, PrimaryCta, CtaBar actions, ClipListItem, DraftTile, ReelTile). Pass `suppress` while it is busy, disabled, dragging, or fullscreen.
4. **No hand-wired pulse.** `instructions/guidePulse.guard.test.js` reads raw source: the pulse class only in `guideTargets.js` + `index.css`; the old prop names (`pulsePlay`, `pulsePreview`, `pulseGenerate`, `pulseUpload`, `pulsePortrait`, `guidePulse`, `homePulse`, `pickPulse`) and `data-trim-guide` / `trim-guide-pulse` absent from non-test source. Local variables holding the hook result are named `pulseClass`.
5. **Reduced motion** is ONE rule in `index.css`: `.coach-target-pulse` drops the animation and gets a 2px amber `outline` (not box-shadow: several targets set an inline box-shadow). Never add per-site `ring-*` / `motion-reduce:` classes for a pulse.
6. Pure render output: nothing here is stored or persisted.

## Landmines
- **Trim `phase`.** The two trim rules have `step: null` and name their own `phase` (`'split'`/`'adjust'`) because `data-phase` and the coach re-measure key read it. `SegmentLayer` pulses its track (`TRIM_TRACK`) and speed/trash buttons (`TRIM_ADJUST`) through the hook.
- **Overlay has two channels**: `OverlayModeView` scopes `[overlayJobGuide, pickGuide]` (job state + pick sequence), so two targets can be active at once.
- **Overlay with no detection markers** (T12790): `useGuidedAthletePick` reports phase `'none'` once regions have loaded (`canPark`) and `SpotlightPickGuide` shows `overlay.pick.none` (drag the circle). Before that, `total === 0` meant phase null and Overlay opened with no guide.
- **Annotate holds its guide until a game id exists** (`holdGuide={!isGameDataReady}`). Reopening an uploading game must restore the id from the upload store (T12790: the blob-restore effect used to reset it to null, so no guide for the whole upload).
- **Landscape cockpit** (`FocusCockpit`) resolves `focus.cockpit.*` (see Full-bleed editors) and provides its own `GuideScope`. `CropOverlay` no longer has a "0 focus points" fallback: unscoped means no pulse. `guided` on CropOverlay only means "the sentence is shown elsewhere, so no chip".
- A new `GUIDE_PULSE` key needs a consumer, a rule, and a row in `resolveGuide.pulseTargets.test.js`.
- **Dialogs** (T12790): `screen: 'modal'` rules built by `modalRule(id, name, title, {when, pulse|noPulse})`; facts are `{ screen: 'modal', local: { modal: '<name>', ...state } }`. Each dialog wraps itself in `GuideScope` and renders `<Guide inline testId="modal-guide">` at the top of its body (the floating coach hides behind any open dialog). A new dialog = a rule + `GUIDE.modal` copy + the inline mount.
- **Full-bleed editors** (T12790): the landscape cockpit and Focus fullscreen draw the same resolved guide with `CompactGuide` (slim strip, pointer-events pass through, Turn off guidance only). The cockpit walks drag, Preview (`COCKPIT_PREVIEW`), Generate; fullscreen sends the user out (`focus.fullscreen.leave`, pulses `EXIT_FULLSCREEN`) once the stage steps are done.
- **Focus video load failure** outranks job state (`focus.video-error[.retry]`); Home's Games tab has `home.games.error` (Retry), and only the Games tab waits on the games fetch.
- **The card never covers a pulsing control, and every pulsing control is cut out of the shade** (`clearOfPulses` in `placement.js`; FloatingCoach reads `.GUIDE_PULSE_CLASS` rects). Staging 2026-10-14: the editor's dock-collides-with-avoid fallback (`anchor.top + 8`) put the card on Done.
- Scopes must sit above the control: hooks in a component rendered outside its screen's `GuideScope` silently never pulse (the fail-visible default).
- e2e: `e2e/T12730-guide-pulse.spec.js` asserts `.coach-target-pulse` per screen; tests may assert the class name, source may not.
