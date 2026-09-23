import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AnnotateTimeline } from './AnnotateTimeline';

/**
 * T10780 — the Annotate plays track is illegible on phones because the whole game
 * is squeezed into ~280 CSS px, so it renders at 3x there with a finger-sized
 * touch scrollbar; desktop is 1x with neither.
 *
 * T10930 — that 3x is now the phone's DEFAULT zoom, not a constant: the `zoom`
 * prop (useTimelineZoom, owned by AnnotateModeView) drives the scale 100-500%
 * on every viewport, and the `-  N%  +` chip is the visible control. Without a
 * `zoom` prop (harnesses, these defaults) the T10780 constants still apply and
 * no chip renders.
 *
 * T11030 — the scrollbar itself is no longer phone-only: it renders whenever
 * `timelineScale > 1`, on desktop too (previously `lg:hidden`, falling back to
 * an easy-to-miss OS-native scrollbar there).
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

function zoomProp(timelineZoom) {
  return { timelineZoom, zoomByWheel: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), resetZoom: vi.fn() };
}

// The scaled inner div is the scroll container's only element child.
function scaledInnerDiv() {
  const scroller = document.querySelector('.timeline-scroll-container');
  return scroller?.firstElementChild;
}

describe('AnnotateTimeline defaults without a zoom prop (T10780 constants)', () => {
  it('mobile: renders the scaled track at 300% with the touch scrollbar and no chip', () => {
    stubMatchMedia(true);
    render(<AnnotateTimeline {...baseProps} />);

    expect(scaledInnerDiv().style.width).toBe('300%');
    expect(screen.getByTestId('mobile-scrollbar-track')).toBeTruthy();
    expect(screen.queryByTestId('timeline-zoom-chip')).toBeNull();
    expect(screen.queryByText(/Zoom:/)).toBeNull();
  });

  it('desktop: renders the track at 100% with no scrollbar and no chip', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} />);

    expect(scaledInnerDiv().style.width).toBe('100%');
    expect(screen.queryByTestId('mobile-scrollbar-track')).toBeNull();
    expect(screen.queryByTestId('timeline-zoom-chip')).toBeNull();
  });
});

describe('AnnotateTimeline user zoom (T10930)', () => {
  it('desktop at 100%: chip shows 100%, track fits, no scrollbar; + calls zoomIn', () => {
    stubMatchMedia(false);
    const zoom = zoomProp(100);
    render(<AnnotateTimeline {...baseProps} zoom={zoom} />);

    expect(screen.getByTestId('timeline-zoom-reset').textContent).toBe('100%');
    expect(scaledInnerDiv().style.width).toBe('100%');
    expect(screen.queryByTestId('mobile-scrollbar-track')).toBeNull();
    fireEvent.click(screen.getByTestId('timeline-zoom-in'));
    expect(zoom.zoomIn).toHaveBeenCalledTimes(1);
  });

  it('desktop at 300%: the scaled track is 300% wide, the chip reads 300%, and the scrollbar shows', () => {
    stubMatchMedia(false);
    render(<AnnotateTimeline {...baseProps} zoom={zoomProp(300)} />);

    expect(scaledInnerDiv().style.width).toBe('300%');
    expect(screen.getByTestId('timeline-zoom-reset').textContent).toBe('300%');
    // The old read-only badge never renders alongside the chip.
    expect(screen.queryByText(/Zoom:/)).toBeNull();
    // T11030: desktop gets the same visible scroll affordance as mobile now.
    expect(screen.getByTestId('mobile-scrollbar-track')).toBeTruthy();
  });

  it('mobile zoomed OUT to 100%: whole game fits, scroll pill gone, chip still there', () => {
    stubMatchMedia(true);
    const zoom = zoomProp(100);
    render(<AnnotateTimeline {...baseProps} zoom={zoom} />);

    expect(scaledInnerDiv().style.width).toBe('100%');
    expect(screen.queryByTestId('mobile-scrollbar-track')).toBeNull();
    expect(screen.getByTestId('timeline-zoom-chip')).toBeTruthy();
    fireEvent.click(screen.getByTestId('timeline-zoom-out'));
    // Already at the floor: the chip disables zoom-out rather than calling through.
    expect(zoom.zoomOut).not.toHaveBeenCalled();
  });

  it('mobile at 500%: scaled to 500% with the scroll pill', () => {
    stubMatchMedia(true);
    render(<AnnotateTimeline {...baseProps} zoom={zoomProp(500)} />);

    expect(scaledInnerDiv().style.width).toBe('500%');
    expect(screen.getByTestId('mobile-scrollbar-track')).toBeTruthy();
    expect(screen.getByTestId('timeline-zoom-in').disabled).toBe(true);
  });
});
