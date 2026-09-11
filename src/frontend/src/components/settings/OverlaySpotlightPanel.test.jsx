import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import OverlaySpotlightPanel from './OverlaySpotlightPanel';
import { EDITOR_PANELS } from '../../config/displayNames';

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

    // N29: "Spotlight color" (was "Highlight Color"); shape says WHERE vs the player.
    expect(screen.getByText('Spotlight color')).toBeTruthy();
    // "Around player"/"Under player" appear as both the row value and the segmented
    // button, so there are >=1 matches — the point is the noun renders, jargon doesn't.
    expect(screen.getAllByText('Around player').length).toBeGreaterThan(0); // was "Body ellipse"
    expect(screen.getAllByText('Under player').length).toBeGreaterThan(0);  // was "Ground spotlight"
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

  it('names the remaining detection frames when partially assigned', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection={false}
        assignedCount={1}
        totalDetections={3}
      />
    );
    const progress = screen.getByTestId('assignment-progress');
    expect(progress.textContent).toContain('1 of 3 players selected');
  });

  it('shows no progress line once every detection frame is assigned', () => {
    render(
      <OverlaySpotlightPanel
        {...baseProps}
        awaitingPlayerSelection={false}
        assignedCount={3}
        totalDetections={3}
      />
    );
    expect(screen.queryByTestId('assignment-progress')).toBeNull();
  });
});
