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

  it('a SELECTED region still shows even when the playhead is NOT inside its range (matches TextOverlayPreview.jsx\'s own selectedRegionId short-circuit)', () => {
    // Diagnosed live: a freshly created/selected region renders on the video
    // stage via TextOverlayPreview's selectedRegionId short-circuit even
    // before the playhead has settled exactly inside its range, but a
    // range-only Text tab filter showed "no region here" for that SAME
    // region at that SAME instant -- a real, user-visible mismatch between
    // what's on screen and what the settings panel claims is there.
    render(<OverlayModeView {...baseProps({ currentTime: 3.5, selectedRegionId: 'r1' })} />); // outside REGION_EARLY [0,2) but selected
    const textTab = firstTextTab();
    expect(textTab.getAttribute('title')).toBeNull(); // NOT dimmed
    fireEvent.click(textTab);
    expect(screen.getAllByText('EARLY').length).toBeGreaterThan(0);
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
