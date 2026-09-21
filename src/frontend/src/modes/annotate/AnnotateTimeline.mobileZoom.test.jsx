import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AnnotateTimeline } from './AnnotateTimeline';

/**
 * T10780 — the Annotate plays track is illegible on phones because the whole game
 * is squeezed into ~280 CSS px. On mobile the timeline renders at a fixed 3x
 * (Option A, no pinch-zoom) with a finger-sized touch scrollbar; on desktop it is
 * byte-identical to before (scale 1, no scrollbar, no zoom badge). Annotate uses a
 * fixed CONSTANT, never `useTimelineZoom` — so no "Zoom: N%" badge appears.
 */

// jsdom lacks ResizeObserver; ClipRegionLayer/AngleLanes only use it for sizing.
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => cleanup());

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
  { id: 'a', startTime: 0, endTime: 5, rating: 4, my_athlete: true, index: 0 },
  { id: 'b', startTime: 100, endTime: 105, rating: 3, my_athlete: false, index: 1 },
];

const baseProps = {
  currentTime: 0,
  duration: 300,
  onSeek: () => {},
  regions,
  selectedRegionId: null,
  onSelectRegion: () => {},
  onDeleteRegion: () => {},
};

// The scaled inner div is the scroll container's only element child.
function scaledInnerDiv() {
  const scroller = document.querySelector('.timeline-scroll-container');
  return scroller?.firstElementChild;
}

describe('AnnotateTimeline mobile 3x zoom + scrollbar (T10780)', () => {
  it('mobile: renders the scaled track at 300% with the touch scrollbar and no zoom badge', () => {
    stubMatchMedia(true);
    render(<AnnotateTimeline {...baseProps} />);

    expect(scaledInnerDiv().style.width).toBe('300%');
    expect(screen.getByTestId('mobile-scrollbar-track')).toBeTruthy();
    expect(screen.queryByText(/Zoom:/)).toBeNull();
  });

  it('desktop: renders the track at 100% with no scrollbar and no zoom badge (byte-identical)', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} />);

    expect(scaledInnerDiv().style.width).toBe('100%');
    expect(screen.queryByTestId('mobile-scrollbar-track')).toBeNull();
    expect(screen.queryByText(/Zoom:/)).toBeNull();
  });
});
