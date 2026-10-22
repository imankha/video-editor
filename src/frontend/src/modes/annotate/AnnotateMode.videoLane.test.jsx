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

// T13280 regression: AnnotateMode is a pass-through between AnnotateModeView and the
// timeline. An earlier revision dropped the timeline's per-video prop here, so the
// control never rendered in the app while the timeline's own tests stayed green.
describe('AnnotateMode forwards videoLane to the timeline (T13280)', () => {
  it('renders the desktop Videos lane', () => {
    render(
      <AnnotateMode
        currentTime={0}
        duration={200}
        onSeek={() => {}}
        regions={[]}
        onSelectRegion={() => {}}
        videoLane={{
          videos: [
            { sequence: 1, name: 'first-half', kind: 'main', virtualStart: 0, virtualEnd: 100 },
            { sequence: 2, name: 'second-half', kind: 'main', virtualStart: 100, virtualEnd: 200 },
          ],
          activeSequence: 1,
          onPick: () => {},
          pulseSequence: null,
        }}
      />,
    );
    expect(screen.getByTestId('video-block-1').textContent).toContain('first-half');
    expect(screen.getByTestId('video-block-2').textContent).toContain('second-half');
  });
});
