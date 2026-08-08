import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T6630 round 6 item 2: "all text settings should be for the text regions
 * the playhead is currently on ... if playhead is over an area with no text
 * regions, then the text tab is disabled." Pins:
 *   - the Text tab's region list is filtered to region(s) active AT
 *     currentTime (the SAME half-open-range test as TextOverlayPreview.jsx),
 *     not the full unfiltered textOverlays array
 *   - the Text tab button itself is disabled when that filtered list is empty
 *   - an already-active Text tab does NOT get force-navigated away when it
 *     becomes disabled (mid-playback boundary crossing)
 *
 * OverlayModeView renders its settings-tabs section TWICE (desktop/mobile
 * layout breakpoints, both mounted -- CSS hides one) -- every query below
 * uses getAllByTestId(...)[0] to consistently target the first copy rather
 * than tripping RTL's "multiple elements found" error.
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({
  default: () => <div data-testid="overlay-export-button">Export</div>,
}));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: (t) => `${t}` }));
vi.mock('./overlay', () => ({
  OverlayMode: () => <div data-testid="overlay-timeline" />,
  HighlightOverlay: () => <div />,
  PlayerDetectionOverlay: () => <div />,
  TextOverlayPreview: () => <div />,
}));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { OverlayModeView } from './OverlayModeView';

const REGION_EARLY = {
  id: 'r1', index: 0, startTime: 0, endTime: 2,
  elements: [{ id: 'a1', spec: { text: 'EARLY' }, enabled: true }],
};
const REGION_LATE = {
  id: 'r2', index: 1, startTime: 5, endTime: 7,
  elements: [{ id: 'b1', spec: { text: 'LATE' }, enabled: true }],
};

function baseProps(overrides = {}) {
  return {
    videoRef: { current: null },
    effectiveOverlayVideoUrl: 'blob:overlay',
    effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 10 },
    isFullscreen: false,
    handlers: {},
    highlightRegions: [],
    highlightBoundaries: [],
    highlightRegionKeyframes: [],
    getTimelineScale: () => 1,
    getRegionsForExport: () => [],
    textOverlays: [REGION_EARLY, REGION_LATE],
    currentTime: 0,
    ...overrides,
  };
}

function firstTextTab() {
  return screen.getAllByTestId('overlay-tab-text')[0];
}

describe('OverlayModeView — Text tab scoped to the playhead (T6630 round 6 item 2)', () => {
  it('the Text tab lists only the region active at currentTime (not the full array)', () => {
    render(<OverlayModeView {...baseProps({ currentTime: 0.5 })} />); // inside REGION_EARLY [0,2), outside REGION_LATE [5,7)
    fireEvent.click(firstTextTab());
    expect(screen.getAllByText('EARLY').length).toBeGreaterThan(0);
    expect(screen.queryByText('LATE')).toBeNull();
  });

  it('moving the playhead into the OTHER region shows THAT region instead', () => {
    const { rerender } = render(<OverlayModeView {...baseProps({ currentTime: 0.5 })} />);
    fireEvent.click(firstTextTab());
    expect(screen.getAllByText('EARLY').length).toBeGreaterThan(0);

    rerender(<OverlayModeView {...baseProps({ currentTime: 6 })} />);
    expect(screen.getAllByText('LATE').length).toBeGreaterThan(0);
    expect(screen.queryByText('EARLY')).toBeNull();
  });

  it('the Text tab button reads dimmed (title explains why) when no region is under the playhead', () => {
    render(<OverlayModeView {...baseProps({ currentTime: 3.5 })} />); // between the two regions
    expect(firstTextTab().getAttribute('title')).toMatch(/no text region/i);
  });

  it('T6630 round 7 item 1: a SELECTED region does NOT show once the playhead leaves its range -- no exception for selection', () => {
    // Round 6 copied TextOverlayPreview.jsx's selectedRegionId short-circuit
    // into this filter too (a just-created region needs to show
    // immediately). Round 7 user direction removed that exception for the
    // SETTINGS panel specifically: "when my playhead was not over any text
    // region i expect disabled and empty text settings" -- even if that
    // region is still the selected one. (TextOverlayPreview.jsx's OWN
    // filter, the actual video burn-in, keeps its short-circuit --
    // unaffected by this, a separate call site.) Region create/select both
    // seek the playhead into range, so a legitimately-just-selected region
    // still shows via the range check alone -- this test is the case where
    // the playhead has since moved AWAY, which must now hide it.
    render(<OverlayModeView {...baseProps({ currentTime: 3.5, selectedRegionId: 'r1' })} />); // outside REGION_EARLY [0,2) but selected
    const textTab = firstTextTab();
    expect(textTab.getAttribute('title')).toMatch(/no text region/i); // dimmed
    fireEvent.click(textTab);
    expect(screen.queryByText('EARLY')).toBeNull();
    expect(screen.getAllByText(/no text region under the playhead/i).length).toBeGreaterThan(0);
  });

  it('T6630 round 7 item 1 bug fix: a sub-millisecond float gap just BELOW startTime still shows the region (creation-seek quantization)', () => {
    // Live-debugged: wrappedAddRegion's own `seek(newRegion.startTime)` can
    // leave React's currentTime a HAIR below region.startTime (observed
    // ~0.0000007s in a real browser -- the video element's reported
    // currentTime after a programmatic seek is not bit-identical to the
    // requested value). A bare `<=` permanently hid a just-created region's
    // own settings since the video was paused and currentTime never moved
    // again. The fix is a small EPSILON tolerance, not a re-introduction of
    // the removed selectedRegionId exception.
    const justBelowStart = REGION_EARLY.startTime - 0.0000007;
    render(<OverlayModeView {...baseProps({ currentTime: justBelowStart })} />);
    fireEvent.click(firstTextTab());
    expect(screen.getAllByText('EARLY').length).toBeGreaterThan(0);
  });

  it('T6630 round 7 item 1: the epsilon tolerance stays far below one video frame -- a real 0.1s gap outside the range still hides the region', () => {
    // Guards against the epsilon fix accidentally widening "the playhead is
    // over this region" into any perceptible range.
    render(<OverlayModeView {...baseProps({ currentTime: REGION_EARLY.startTime - 0.1 })} />);
    fireEvent.click(firstTextTab());
    expect(screen.queryByText('EARLY')).toBeNull();
    expect(screen.getAllByText(/no text region under the playhead/i).length).toBeGreaterThan(0);
  });

  it('the Text tab button reads enabled when a region IS under the playhead', () => {
    render(<OverlayModeView {...baseProps({ currentTime: 0.5 })} />);
    expect(firstTextTab().getAttribute('title')).toBeNull();
  });

  it('the dimmed Text tab is STILL CLICKABLE -- a brand-new video with zero regions anywhere must still be able to reach the "click the timeline" guidance', () => {
    render(<OverlayModeView {...baseProps({ currentTime: 3.5, textOverlays: [] })} />);
    const tab = firstTextTab();
    expect(tab.getAttribute('title')).toMatch(/no text region/i);
    expect(tab.disabled).toBe(false);
    fireEvent.click(tab);
    expect(screen.getAllByTestId('overlay-tabpanel-text').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no text region under the playhead/i).length).toBeGreaterThan(0);
  });

  it('an already-active Text tab does not get yanked away when the playhead moves off every region', () => {
    const { rerender } = render(<OverlayModeView {...baseProps({ currentTime: 0.5 })} />);
    fireEvent.click(firstTextTab());
    expect(screen.getAllByTestId('overlay-tabpanel-text').length).toBeGreaterThan(0);

    rerender(<OverlayModeView {...baseProps({ currentTime: 3.5 })} />);
    // Still ON the text tab (not force-switched to overlay), now showing its
    // own natural empty state instead of vanishing out from under the user.
    expect(screen.getAllByTestId('overlay-tabpanel-text').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no text region under the playhead/i).length).toBeGreaterThan(0);
  });
});
