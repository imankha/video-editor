import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import OverlaySpotlightPanel from './OverlaySpotlightPanel';
import { EDITOR_PANELS } from '../../config/displayNames';
import HighlightColor from '../../constants/highlightColors';

/**
 * T9550 (Shared Vocabulary epic, N29/N30): the Spotlight styling panel must read in
 * plain, parent-facing words — one noun per primitive — while keeping the live
 * px/% readouts. Locks the rename so the old video-editing jargon can't creep back.
 */

const baseProps = {
  highlightColor: 'white',
  onHighlightColorChange: vi.fn(),
  highlightShape: 'body',
  onHighlightShapeChange: vi.fn(),
  strokeWidth: 3,
  onStrokeWidthChange: vi.fn(),
  fillOpacity: 0.1,
  onFillEnabledChange: vi.fn(),
  onFillOpacityChange: vi.fn(),
  dimStrength: 0.2,
  onDimStrengthChange: vi.fn(),
  onHighlightEffectTypeChange: vi.fn(),
  isHighlightEnabled: true,
};

describe('OverlaySpotlightPanel — parent-facing vocabulary (T9550)', () => {
  it('uses the renamed labels (N29/N30) and drops the old jargon', () => {
    render(<OverlaySpotlightPanel {...baseProps} />);

    // N29: "Spotlight color" (was "Highlight Color"); shape says WHERE vs the athlete.
    expect(screen.getByText('Spotlight color')).toBeTruthy();
    // "Around athlete"/"Under athlete" (T9860 D3, was "Around player"/"Under player")
    // appear as both the row value and the segmented button, so there are >=1
    // matches — the point is the noun renders, jargon doesn't.
    expect(screen.getAllByText('Around athlete').length).toBeGreaterThan(0); // was "Body ellipse"
    expect(screen.getAllByText('Under athlete').length).toBeGreaterThan(0);  // was "Ground spotlight"
    // N30: styling sliders in plain words.
    expect(screen.getByText('Outline thickness')).toBeTruthy(); // was "Stroke Width"
    expect(screen.getByText('Spotlight fill')).toBeTruthy();    // was "Fill"
    expect(screen.getByText('Dim background')).toBeTruthy();     // was "Outside Dim"

    // The old terms are gone from parent-facing copy.
    expect(screen.queryByText('Highlight Color')).toBeNull();
    expect(screen.queryByText('Stroke Width')).toBeNull();
    expect(screen.queryByText('Outside Dim')).toBeNull();
    expect(screen.queryByText('Body ellipse')).toBeNull();
    expect(screen.queryByText('Ground spotlight')).toBeNull();
  });

  it('keeps the live px / % readouts alongside the renamed labels', () => {
    render(<OverlaySpotlightPanel {...baseProps} strokeWidth={2} fillOpacity={0.15} dimStrength={0.25} />);
    expect(screen.getByText('2px')).toBeTruthy();
    expect(screen.getByText('15%')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
  });
});

/**
 * T9620 (UX-10): the Spotlight panel sequences styling AFTER player selection.
 * While a player is unpicked it shows the "pick your player" guidance and NO
 * styling controls; once assignment begins the styling controls appear, with a
 * progress line for any detection frames still unassigned.
 */
describe('OverlaySpotlightPanel player-selection sequencing (T9620)', () => {
  it('shows the pick-your-player guidance and hides styling before selection', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection
        assignedCount={0}
        totalDetections={3}
      />
    );
    expect(screen.getByText(EDITOR_PANELS.SELECT_PLAYER_TITLE)).toBeTruthy();
    expect(screen.getByText(EDITOR_PANELS.SELECT_PLAYER_CLICK)).toBeTruthy();
    // Styling controls are NOT present yet.
    expect(screen.queryByText(EDITOR_PANELS.OUTLINE_THICKNESS)).toBeNull();
    expect(screen.queryByText(EDITOR_PANELS.SPOTLIGHT_COLOR)).toBeNull();
    expect(screen.queryByText(EDITOR_PANELS.DIM_BACKGROUND)).toBeNull();
  });

  it('reveals styling controls once a player is assigned', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection={false}
        assignedCount={1}
        totalDetections={1}
      />
    );
    expect(screen.queryByText(EDITOR_PANELS.SELECT_PLAYER_TITLE)).toBeNull();
    expect(screen.getByText(EDITOR_PANELS.SPOTLIGHT_COLOR)).toBeTruthy();
    expect(screen.getByText(EDITOR_PANELS.OUTLINE_THICKNESS)).toBeTruthy();
  });

  it('reveals styling immediately after one pick, even with detections remaining', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection={false}
        assignedCount={1}
        totalDetections={3}
      />
    );
    // AC: one player satisfies the step — styling is available right away.
    expect(screen.getByText(EDITOR_PANELS.OUTLINE_THICKNESS)).toBeTruthy();
  });
});

/**
 * T9960 (EP05): one selected athlete SATISFIES the step; picking more is optional,
 * never implied as required. The effect interval is surfaced as a named readout
 * above the (secondary) advanced styling controls.
 */
describe('OverlaySpotlightPanel single-athlete completion (T9960)', () => {
  it('affirms completion after one pick and never implies all players are required', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection={false}
        assignedCount={1}
        totalDetections={4}
      />
    );
    const status = screen.getByTestId('player-selected-status');
    expect(status.textContent).toContain(EDITOR_PANELS.SELECT_PLAYER_DONE);
    // More detections remain -> adding is OPTIONAL, not an instruction.
    expect(status.textContent).toContain(EDITOR_PANELS.SELECT_PLAYER_ADD_MORE);
    // No all-player implication survives.
    expect(status.textContent).not.toMatch(/of 4/);
    expect(status.textContent).not.toMatch(/remaining/i);
    expect(status.textContent).not.toMatch(/each too/i);
  });

  it('affirms completion without the add-more clause when no other players exist', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection={false}
        assignedCount={1}
        totalDetections={1}
      />
    );
    const status = screen.getByTestId('player-selected-status');
    expect(status.textContent).toContain(EDITOR_PANELS.SELECT_PLAYER_DONE);
    expect(status.textContent).not.toContain(EDITOR_PANELS.SELECT_PLAYER_ADD_MORE);
  });

  it('shows no completion status before any player is picked', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection={false}
        assignedCount={0}
        totalDetections={0}
      />
    );
    expect(screen.queryByTestId('player-selected-status')).toBeNull();
  });

  it('states Spotlight is optional in the pre-selection guidance', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection
        assignedCount={0}
        totalDetections={3}
      />
    );
    expect(screen.getByText(EDITOR_PANELS.SELECT_PLAYER_OPTIONAL)).toBeTruthy();
  });

  it('surfaces the effect interval as a named, previewable readout', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection={false}
        assignedCount={1}
        totalDetections={1}
        spotlightDurationSeconds={2}
      />
    );
    expect(screen.getByText(EDITOR_PANELS.SPOTLIGHT_DURATION)).toBeTruthy();
    expect(screen.getByText('2.0s')).toBeTruthy();
    expect(screen.getByTestId('spotlight-duration-hint')).toBeTruthy();
  });

  it('hides the duration readout when the interval is unknown', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection={false}
        assignedCount={1}
        totalDetections={1}
        spotlightDurationSeconds={null}
      />
    );
    expect(screen.queryByText(EDITOR_PANELS.SPOTLIGHT_DURATION)).toBeNull();
  });
});

/**
 * T11020: full color spectrum (native color input) + eyedropper, so a parent can
 * match the spotlight to their kid's uniform exactly instead of picking the
 * nearest of 5 presets.
 */
describe('OverlaySpotlightPanel custom color + eyedropper (T11020)', () => {
  const originalEyeDropper = window.EyeDropper;

  afterEach(() => {
    if (originalEyeDropper === undefined) {
      delete window.EyeDropper;
    } else {
      window.EyeDropper = originalEyeDropper;
    }
  });

  it('offers a full-spectrum custom color input alongside the presets', () => {
    render(<OverlaySpotlightPanel {...baseProps} highlightColor={HighlightColor.WHITE} />);
    const customInput = screen.getByLabelText(EDITOR_PANELS.SPOTLIGHT_CUSTOM_COLOR);
    expect(customInput).toBeTruthy();
    expect(customInput.getAttribute('type')).toBe('color');
  });

  it('writes an arbitrary hex through the same onHighlightColorChange handler', () => {
    const onHighlightColorChange = vi.fn();
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        highlightColor={HighlightColor.WHITE}
        onHighlightColorChange={onHighlightColorChange}
      />
    );
    const customInput = screen.getByLabelText(EDITOR_PANELS.SPOTLIGHT_CUSTOM_COLOR);
    fireEvent.change(customInput, { target: { value: '#1a9c4b' } });
    expect(onHighlightColorChange).toHaveBeenCalledWith('#1A9C4B');
  });

  it('reads a custom hex as "Custom" instead of misreporting it as a preset', () => {
    render(<OverlaySpotlightPanel {...baseProps} highlightColor="#1A9C4B" />);
    expect(screen.getByText('Custom')).toBeTruthy();
  });

  it('does not render the eyedropper when the browser has no EyeDropper API', () => {
    delete window.EyeDropper;
    render(<OverlaySpotlightPanel {...baseProps} highlightColor={HighlightColor.WHITE} />);
    expect(screen.queryByLabelText(EDITOR_PANELS.SPOTLIGHT_MATCH_UNIFORM)).toBeNull();
  });

  it('samples a color from the screen via the native EyeDropper API when supported', async () => {
    const onHighlightColorChange = vi.fn();
    const open = vi.fn().mockResolvedValue({ sRGBHex: '#2b7fe0' });
    // EyeDropper is invoked as `new window.EyeDropper()` — a real constructor, so
    // the mock must be one too (an arrow function/plain vi.fn() can't be `new`ed).
    window.EyeDropper = function MockEyeDropper() {
      this.open = open;
    };

    render(
      <OverlaySpotlightPanel
        {...baseProps}
        highlightColor={HighlightColor.WHITE}
        onHighlightColorChange={onHighlightColorChange}
      />
    );
    const button = screen.getByLabelText(EDITOR_PANELS.SPOTLIGHT_MATCH_UNIFORM);
    fireEvent.click(button);
    await vi.waitFor(() => expect(onHighlightColorChange).toHaveBeenCalledWith('#2B7FE0'));
  });

  it('disables the custom color input and eyedropper while an export is in flight', () => {
    window.EyeDropper = function MockEyeDropper() {
      this.open = vi.fn();
    };
    render(<OverlaySpotlightPanel {...baseProps} highlightColor={HighlightColor.WHITE} disabled />);
    expect(screen.getByLabelText(EDITOR_PANELS.SPOTLIGHT_CUSTOM_COLOR).disabled).toBe(true);
    expect(screen.getByLabelText(EDITOR_PANELS.SPOTLIGHT_MATCH_UNIFORM).disabled).toBe(true);
  });
});
