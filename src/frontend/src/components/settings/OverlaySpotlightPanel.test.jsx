import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import OverlaySpotlightPanel from './OverlaySpotlightPanel';
import { EDITOR_PANELS } from '../../config/displayNames';

/**
 * T9620 (UX-10): the Spotlight panel sequences styling AFTER player selection.
 * While a player is unpicked it shows the "pick your player" guidance and NO
 * styling controls; once assignment begins the styling controls appear, with a
 * progress line for any detection frames still unassigned.
 */
describe('OverlaySpotlightPanel player-selection sequencing (T9620)', () => {
  const baseProps = {
    highlightColor: 'white',
    highlightShape: 'body',
    strokeWidth: 3,
    fillOpacity: 0,
    dimStrength: 0.15,
    isHighlightEnabled: true,
  };

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
