import { render } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * T15340: `/overlay/p/{id}?t=37` opens with the player at 0:37. Same one-shot
 * seek pattern as FocusModeView.resumeSeek.test.jsx -- waits for a real duration,
 * then drops the URL's `t` so a later reload/navigation on this project never
 * reseeks.
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({ default: () => <div /> }));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: () => '0:00' }));
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
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false, useIsLandscape: () => false, useIsPhonePortrait: () => false, useIsSmallPhoneViewport: () => false }));

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
    videoTags: [],
    ...overrides,
  };
}

function renderView(overrides = {}) {
  return render(<OverlayModeView {...baseProps(overrides)} />);
}

describe('OverlayModeView resume seek (T15340)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('seeks once the player has a duration, using the URL `t`, then drops the param', () => {
    window.history.pushState({}, '', '/overlay/p/7?t=37');
    const seek = vi.fn();
    renderView({ projectId: 7, effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 60 }, duration: 60, seek });

    expect(seek).toHaveBeenCalledWith(37);
    expect(window.location.pathname + window.location.search).toBe('/overlay/p/7');
  });

  it('does not seek before the video has a duration', () => {
    window.history.pushState({}, '', '/overlay/p/7?t=37');
    const seek = vi.fn();
    renderView({ projectId: 7, effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 0 }, duration: 0, seek });

    expect(seek).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?t=37');
  });

  // T15340 fix round 1: the gate must use the real (video-element-sourced)
  // `duration`, not the API-sourced `effectiveOverlayMetadata.duration` --
  // the latter lands before the player can actually seek, so a resume seek
  // fired on it alone used to be refused by useVideo.seek() and permanently
  // lost (C2). Pin that `effectiveOverlayMetadata.duration` being ready is NOT
  // sufficient on its own.
  it('does not seek on metadata duration alone -- waits for the real video duration', () => {
    window.history.pushState({}, '', '/overlay/p/7?t=37');
    const seek = vi.fn();
    renderView({ projectId: 7, effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 60 }, duration: 0, seek });

    expect(seek).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?t=37');
  });

  it('does not seek for a `t` that names a different project', () => {
    window.history.pushState({}, '', '/overlay/p/9?t=37');
    const seek = vi.fn();
    renderView({ projectId: 7, effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 60 }, duration: 60, seek });

    expect(seek).not.toHaveBeenCalled();
  });
});
