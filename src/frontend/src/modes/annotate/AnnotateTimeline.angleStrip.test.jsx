import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateTimeline } from './AnnotateTimeline';

// jsdom lacks ResizeObserver (ClipRegionLayer + AngleLanes use it).
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

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
  { id: 'a', startTime: 0, endTime: 5, rating: 4, my_athlete: true, index: 0 },
  { id: 'b', startTime: 10, endTime: 15, rating: 3, my_athlete: false, index: 1 },
];

const baseProps = {
  currentTime: 0,
  duration: 100,
  onSeek: () => {},
  regions,
  onSelectRegion: () => {},
};

// A 3-lane deep-overlap angleData (mirrors buildGameTimeline's return shape).
const angleData = {
  angles: [
    { sequence: 2, lane: 1, virtualStart: 40, virtualEnd: 55, name: 'a.mp4' },
    { sequence: 3, lane: 2, virtualStart: 42, virtualEnd: 57, name: 'b.mp4' },
    { sequence: 4, lane: 3, virtualStart: 44, virtualEnd: 59, name: 'c.mp4' },
  ],
  laneCount: 3,
  extensions: [{ type: 'extension', sourceSequence: 2, virtualStart: 90, virtualEnd: 100 }],
  angleSequences: new Set([2, 3, 4]),
  activeSourceSequence: null,
  onSelectAngle: () => {},
};

describe('AnnotateTimeline — angle-free EQUIVALENCE (zero angles = zero pixels)', () => {
  it('desktop: renders NO angle-UI DOM when angleData is absent', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} />);
    expect(screen.queryByTestId('angle-strip')).toBeNull();
    expect(screen.queryByTestId('angle-strip-mobile')).toBeNull();
    expect(screen.queryByTestId('angle-lane-label')).toBeNull();
    expect(screen.queryByTestId('angle-extension-hatch')).toBeNull();
    // The clip lanes are untouched.
    expect(screen.getByTestId('clip-lane-mine')).toBeTruthy();
    expect(screen.getByTestId('clip-lane-team')).toBeTruthy();
  });

  it('absent angleData and explicit null produce IDENTICAL DOM', () => {
    stubMatchMedia(false);
    const a = render(<AnnotateTimeline {...baseProps} />);
    const withoutProp = a.container.innerHTML;
    a.unmount();
    const b = render(<AnnotateTimeline {...baseProps} angleData={null} />);
    expect(b.container.innerHTML).toBe(withoutProp);
  });

  it('an empty angles array also renders zero angle pixels', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} angleData={{ ...angleData, angles: [], laneCount: 0, extensions: [] }} />);
    expect(screen.queryByTestId('angle-strip')).toBeNull();
    expect(screen.queryByTestId('angle-lane-label')).toBeNull();
  });
});

describe('AnnotateTimeline — angle strip (EPIC deep-overlap)', () => {
  it('desktop: renders 3 angle lanes + the Angles label + extension hatch', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} angleData={angleData} />);
    expect(screen.getByTestId('angle-strip')).toBeTruthy();
    expect(screen.getByTestId('angle-lane-label')).toBeTruthy();
    expect(screen.getByTestId('angle-lane-1')).toBeTruthy();
    expect(screen.getByTestId('angle-lane-2')).toBeTruthy();
    expect(screen.getByTestId('angle-lane-3')).toBeTruthy();
    expect(screen.getByTestId('angle-bar-2')).toBeTruthy();
    expect(screen.getByTestId('angle-extension-hatch')).toBeTruthy();
  });

  it('clicking an angle bar fires onSelectAngle with that sequence', () => {
    stubMatchMedia(false);
    let picked = null;
    render(
      <AnnotateTimeline
        {...baseProps}
        angleData={{ ...angleData, onSelectAngle: (seq) => { picked = seq; } }}
      />,
    );
    fireEvent.click(screen.getByTestId('angle-bar-3'));
    expect(picked).toBe(3);
  });

  it('the active angle bar is marked active', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} angleData={{ ...angleData, activeSourceSequence: 2 }} />);
    expect(screen.getByTestId('angle-bar-2').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('angle-bar-3').getAttribute('data-active')).toBe('false');
  });

  it('mobile: collapses to ONE merged angle strip', () => {
    stubMatchMedia(true);
    render(<AnnotateTimeline {...baseProps} angleData={angleData} />);
    expect(screen.getByTestId('angle-strip-mobile')).toBeTruthy();
    expect(screen.queryByTestId('angle-strip')).toBeNull();
    // all angle bars live on the single strip
    expect(screen.getByTestId('angle-bar-2')).toBeTruthy();
    expect(screen.getByTestId('angle-bar-4')).toBeTruthy();
  });
});
