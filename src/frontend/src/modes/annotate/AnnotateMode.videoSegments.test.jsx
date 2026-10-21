import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AnnotateMode from './AnnotateMode';

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
});

// T13280 regression: AnnotateModeView passed videoSegments to AnnotateMode, which did not
// forward it to the timeline, so the per-video chips never rendered in the real app.
describe('AnnotateMode forwards videoSegments to the timeline (T13280)', () => {
  it('renders a chip per video', () => {
    render(
      <AnnotateMode
        currentTime={0}
        duration={200}
        onSeek={() => {}}
        regions={[]}
        onSelectRegion={() => {}}
        videoSegments={[
          { sequence: 1, name: 'first-half', virtualStart: 0, virtualEnd: 100 },
          { sequence: 2, name: 'second-half', virtualStart: 100, virtualEnd: 200 },
        ]}
      />,
    );
    expect(screen.getByTestId('video-label-1').textContent).toContain('first-half');
    expect(screen.getByTestId('video-label-2').textContent).toContain('second-half');
  });
});
