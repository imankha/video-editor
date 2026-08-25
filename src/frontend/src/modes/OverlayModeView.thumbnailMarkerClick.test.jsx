import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T7720: clicking (not dragging) the thumbnail marker on the overlay timeline
 * must (a) switch the settings section to the Thumbnail tab and (b) seek the
 * playhead to the marker's frame -- the same "click a timeline element -> open
 * its tab + seek" shape handleSelectRegion uses for text regions.
 *
 * OverlayMode is stubbed to CAPTURE the onPosterMarkerClick prop
 * OverlayModeView threads down (the real marker-click wiring is unit-tested in
 * PosterMarkerLayer.test.jsx); invoking it here exercises OverlayModeView's own
 * handlePosterMarkerClick handler end to end. OverlayModeView mounts its
 * settings-tabs section twice (desktop/mobile), so the panel query uses
 * getAllByTestId(...).
 */

let capturedOnPosterMarkerClick = null;

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
  OverlayMode: ({ onPosterMarkerClick }) => {
    capturedOnPosterMarkerClick = onPosterMarkerClick;
    return <div data-testid="overlay-timeline" />;
  },
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
    textOverlays: [],
    currentTime: 0,
    ...overrides,
  };
}

beforeEach(() => { capturedOnPosterMarkerClick = null; });

describe('OverlayModeView — clicking the thumbnail marker opens the Thumbnail tab + seeks (T7720)', () => {
  it('threads onPosterMarkerClick down to OverlayMode', () => {
    render(<OverlayModeView {...baseProps()} />);
    expect(typeof capturedOnPosterMarkerClick).toBe('function');
  });

  it('a marker click switches to the Thumbnail tab AND seeks to the marker time (in visual space, passed through as-is)', () => {
    const seek = vi.fn();
    render(<OverlayModeView {...baseProps({ seek, currentTime: 0 })} />);

    // Default tab is 'overlay' -- the Thumbnail panel is not the active one yet.
    expect(screen.queryByTestId('overlay-tabpanel-thumbnail')).toBeNull();

    act(() => { capturedOnPosterMarkerClick(4.85); });

    // Switched to the Thumbnail tab...
    expect(screen.getAllByTestId('overlay-tabpanel-thumbnail').length).toBeGreaterThan(0);
    // ...and seeked to the marker's own time, unconverted (visual == seek space).
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(4.85);
  });

  it('does not throw when seek is absent (optional-chaining guard mirrors handleSelectRegion)', () => {
    render(<OverlayModeView {...baseProps({ seek: undefined })} />);
    expect(() => act(() => { capturedOnPosterMarkerClick(2.0); })).not.toThrow();
    expect(screen.getAllByTestId('overlay-tabpanel-thumbnail').length).toBeGreaterThan(0);
  });
});
