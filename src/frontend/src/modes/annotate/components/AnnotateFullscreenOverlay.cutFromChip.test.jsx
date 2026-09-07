import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T8892: while cutting from a non-backbone angle, the Add/Edit Play editor shows a
// violet "from {angle}" chip + the microcopy "This play will be cut from {angle}."
// It renders ONLY when activeSourceName is set (an angle is active); for the
// backbone / an angle-free game it renders zero pixels (byte-identical editor).

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => mockViewport(false)); // desktop

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onCreateClip: () => {},
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  surface: 'inline_desktop',
};

describe('AnnotateFullscreenOverlay — "cut from {angle}" chip (T8892)', () => {
  it('strip: renders the chip + microcopy when an angle is active', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" activeSourceName="sideline" />);
    const chip = screen.getByTestId('cut-from-angle');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('from sideline');
    expect(chip.textContent).toContain('This play will be cut from sideline.');
  });

  it('strip: renders NOTHING when the backbone is active (activeSourceName null)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" activeSourceName={null} />);
    expect(screen.queryByTestId('cut-from-angle')).toBeNull();
  });

  it('strip: renders NOTHING by default (angle-free game, prop omitted)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    expect(screen.queryByTestId('cut-from-angle')).toBeNull();
  });

  it('overlay (formBody): renders the chip in edit mode too', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="overlay"
        surface="dock_fullscreen"
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], notes: '', my_athlete: true, videoSequence: 2 }}
        activeSourceName="sideline"
      />
    );
    const chip = screen.getByTestId('cut-from-angle');
    expect(chip.textContent).toContain('from sideline');
  });

  it('landscape-inline (mobile landscape editor): renders the chip when an angle is active', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="landscape-inline"
        surface="fullscreen_mobile"
        activeSourceName="sideline"
      />
    );
    expect(screen.getByTestId('cut-from-angle').textContent).toContain('from sideline');
  });

  it('landscape-inline: renders NOTHING for the backbone', () => {
    render(
      <AnnotateFullscreenOverlay {...baseProps} layout="landscape-inline" surface="fullscreen_mobile" activeSourceName={null} />
    );
    expect(screen.queryByTestId('cut-from-angle')).toBeNull();
  });

  it('chip name never leaks a content hash (it is the filename stem)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" activeSourceName="sideline" />);
    expect(screen.getByTestId('cut-from-angle').textContent).not.toMatch(/[0-9a-f]{8}/i);
  });
});
