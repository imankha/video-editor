import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// T10390: Add-footage trigger moved off the (deleted) right-side settings rail
// into the timeline's own Video-timeline label cell — see AnnotateModeView.jsx
// and AnnotateTimeline.jsx for the full rationale (existing row, visual metaphor:
// this is the cell that represents the raw source video, which is exactly what
// adding footage changes). AddFootageButton itself has heavy dependencies
// (credit store, upload manager, lazy BuyCreditsModal) unrelated to placement,
// so it's mocked here — this file only covers WHERE it renders and that it
// doesn't interfere with the pre-existing playhead-select click target.
vi.mock('./AddFootageButton', () => ({
  default: ({ gameId, disabled, compact }) => (
    <button
      type="button"
      data-testid="add-footage-button"
      data-compact={compact ? 'true' : 'false'}
      disabled={disabled}
    >
      Add footage {gameId}
    </button>
  ),
}));

import { AnnotateTimeline } from './AnnotateTimeline';

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

const baseProps = {
  currentTime: 0,
  duration: 100,
  onSeek: () => {},
  regions: [],
  onSelectRegion: () => {},
};

describe('AnnotateTimeline — Add-footage trigger placement (T10390)', () => {
  it('renders nothing when no addFootage context is given (byte-identical to before)', () => {
    render(<AnnotateTimeline {...baseProps} />);
    expect(screen.queryByTestId('add-footage-button')).toBeNull();
  });

  it('renders the compact trigger inside the Video-timeline label cell when addFootage is given', () => {
    render(
      <AnnotateTimeline
        {...baseProps}
        addFootage={{ gameId: 'g1', disabled: false, onFootageAttached: () => {} }}
      />,
    );
    const trigger = screen.getByTestId('add-footage-button');
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('data-compact')).toBe('true');
    expect(trigger.textContent).toContain('g1');
  });

  it('passes disabled through', () => {
    render(
      <AnnotateTimeline
        {...baseProps}
        addFootage={{ gameId: 'g1', disabled: true, onFootageAttached: () => {} }}
      />,
    );
    expect(screen.getByTestId('add-footage-button').disabled).toBe(true);
  });

  it('clicking the trigger does not select the playhead layer (siblings, not nested)', () => {
    let selected = null;
    render(
      <AnnotateTimeline
        {...baseProps}
        onLayerSelect={(layer) => { selected = layer; }}
        addFootage={{ gameId: 'g1', disabled: false, onFootageAttached: () => {} }}
      />,
    );
    fireEvent.click(screen.getByTestId('add-footage-button'));
    expect(selected).toBeNull();
  });

  it('the playhead-select click target still works alongside the trigger', () => {
    let selected = null;
    render(
      <AnnotateTimeline
        {...baseProps}
        onLayerSelect={(layer) => { selected = layer; }}
        addFootage={{ gameId: 'g1', disabled: false, onFootageAttached: () => {} }}
      />,
    );
    fireEvent.click(screen.getByTitle('Click to select playhead layer (arrow keys step frames)'));
    expect(selected).toBe('playhead');
  });
});
