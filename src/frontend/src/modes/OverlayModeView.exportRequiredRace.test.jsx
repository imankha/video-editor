import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9800: the "Export required for Spotlight mode" banner flashed during the
 * transient post-export window. showExportRequired could not tell "never
 * exported" (effectiveOverlayVideoUrl falsy because nothing was rendered) from
 * "export just completed, new working video still hydrating" (effectiveOverlay-
 * VideoUrl momentarily falsy while the store catches up). hasFramingEdits is a
 * static persisted fact that stays true through that window, so the warning
 * fired. The fix threads shouldWaitForWorkingVideo (computed by
 * deriveOverlayVideoSource in OverlayScreen) into OverlayModeView and gates the
 * banner on !shouldWaitForWorkingVideo. This pins that gate.
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
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: () => '0:00' }));
vi.mock('./overlay', () => ({
  OverlayMode: () => <div data-testid="overlay-timeline" />,
  HighlightOverlay: () => <div />,
  PlayerDetectionOverlay: () => <div />,
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

const BANNER = 'Export required for Spotlight mode';

function renderView(overrides = {}) {
  const props = {
    videoRef: { current: null },
    // No overlay video yet — the state that makes the banner eligible.
    effectiveOverlayVideoUrl: null,
    effectiveOverlayMetadata: null,
    isFullscreen: false,
    handlers: {},
    highlightRegions: [],
    highlightBoundaries: [],
    highlightRegionKeyframes: [],
    getTimelineScale: () => 1,
    getRegionsForExport: () => [],
    // Banner preconditions: a framing source exists and the clip is dirty.
    framingVideoUrl: 'blob:framing',
    hasFramingEdits: true,
    hasMultipleClips: false,
    ...overrides,
  };
  return render(<OverlayModeView {...props} />);
}

describe('OverlayModeView export-required race (T9800)', () => {
  it('suppresses the banner during the post-export wait window even with framing edits', () => {
    renderView({ shouldWaitForWorkingVideo: true, hasFramingEdits: true });
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('still shows the banner for a genuinely-dirty project that is not waiting', () => {
    renderView({ shouldWaitForWorkingVideo: false, hasFramingEdits: true });
    expect(screen.getByText(BANNER)).toBeTruthy();
  });

  it('defaults to showing the banner when shouldWaitForWorkingVideo is omitted (dirty, not waiting)', () => {
    renderView({ hasFramingEdits: true });
    expect(screen.getByText(BANNER)).toBeTruthy();
  });

  it('suppresses the banner for multiple-clips dirtiness while waiting', () => {
    renderView({ shouldWaitForWorkingVideo: true, hasFramingEdits: false, hasMultipleClips: true });
    expect(screen.queryByText(BANNER)).toBeNull();
  });
});
