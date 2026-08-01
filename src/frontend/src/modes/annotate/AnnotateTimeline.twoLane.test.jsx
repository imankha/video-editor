import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnnotateTimeline } from './AnnotateTimeline';

// jsdom lacks ResizeObserver; ClipRegionLayer only uses it for mobile marker sizing.
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// AnnotateTimeline renders through the real useIsMobile hook (jsdom lacks matchMedia).
// `mobile` toggles ONLY the mobile-detection query so it matches the hook's actual
// width-OR-coarse-pointer check, not a query-blind stub.
function stubMatchMedia(mobile) {
  window.matchMedia = (query) => ({
    matches: mobile && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

const regions = [
  { id: 'mine', startTime: 0, endTime: 5, rating: 4, my_athlete: true, index: 0 },
  { id: 'team', startTime: 10, endTime: 15, rating: 3, my_athlete: false, index: 1 },
  { id: 'legacy', startTime: 20, endTime: 25, rating: 5, my_athlete: null, index: 2 },
];

const baseProps = {
  currentTime: 0,
  duration: 100,
  onSeek: () => {},
  regions,
  onSelectRegion: () => {},
};

describe('AnnotateTimeline — two clip lanes (T5700 follow-up)', () => {
  it('desktop: renders two labeled lanes, each showing only its own layer\'s clips', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} />);

    expect(screen.getByTestId('clip-lane-label-mine')).toBeTruthy();
    expect(screen.getByTestId('clip-lane-label-team')).toBeTruthy();

    const mineLane = screen.getByTestId('clip-lane-mine');
    const teamLane = screen.getByTestId('clip-lane-team');

    // Rating notations: mine lane has the rating-4 ('!') and legacy null rating-5 ('!!')
    // clips (legacy null defaults to My Athlete); team lane has only the rating-3 ('!?').
    expect(mineLane.textContent).toContain('!!');
    expect(mineLane.textContent).toContain('!');
    expect(mineLane.textContent).not.toContain('!?');
    expect(teamLane.textContent).toContain('!?');
    expect(teamLane.textContent).not.toContain('!!');

    expect(screen.queryByTestId('clip-track-mobile')).toBeNull();
  });

  it('desktop: an empty Team lane still renders with its label', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} regions={[regions[0]]} />);

    expect(screen.getByTestId('clip-lane-label-team')).toBeTruthy();
    expect(screen.getByText('No Team clips yet')).toBeTruthy();
  });

  it('phone (390px-class): collapses to the single tinted Clips track', () => {
    stubMatchMedia(true);
    render(<AnnotateTimeline {...baseProps} />);

    expect(screen.getByTestId('clip-track-mobile')).toBeTruthy();
    expect(screen.queryByTestId('clip-lane-mine')).toBeNull();
    expect(screen.queryByTestId('clip-lane-team')).toBeNull();

    // Single track shows all three clips together.
    const track = screen.getByTestId('clip-track-mobile');
    expect(track.textContent).toContain('!!');
    expect(track.textContent).toContain('!');
    expect(track.textContent).toContain('!?');
  });
});
