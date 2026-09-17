import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * P0 regression (2026-09-15): T9950 Slice 3's output-aspect preview call to
 * useVideoDisplayRect passed a `panOffset: { x: 0, y: 0 }` object literal
 * re-created every render. useVideoDisplayRect's layout effect depends on
 * `panOffset` BY REFERENCE (see useVideoDisplayRect.js's own test: "a fresh
 * object each render would re-trigger forever") -- with a real videoRef/
 * container so the effect doesn't bail out early, this fired setRect on
 * every render, forever, crashing Focus mode with "Maximum update depth
 * exceeded" for EVERY draft opened (the call is unconditional, not gated on
 * the `previewing` toggle). The existing FocusModeView tests all use
 * `videoRef: { current: null }`, which short-circuits the effect before the
 * loop can manifest -- this test mounts a REAL video+container instead, the
 * same way useVideoDisplayRect.test.js does, so the loop actually reproduces.
 */

vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({ default: () => <div /> }));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
  Toggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange?.(!checked)} />
  ),
}));
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: () => '0:00' }));
vi.mock('./focus', () => ({ FocusMode: () => <div />, CropOverlay: () => <div /> }));
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));

import { FocusModeView } from './FocusModeView';

describe('FocusModeView — output preview pan-offset stability', () => {
  let container;

  afterEach(() => {
    if (container?.parentNode) container.parentNode.removeChild(container);
    vi.restoreAllMocks();
  });

  it('does not loop (Maximum update depth exceeded) when mounted with a real video element', () => {
    container = document.createElement('div');
    container.className = 'video-container';
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 400,
      height: 400,
      left: 0,
      top: 0,
      right: 400,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    const video = document.createElement('video');
    container.appendChild(video);
    document.body.appendChild(container);

    const props = {
      videoRef: { current: video },
      videoUrl: 'blob:video',
      metadata: { width: 1920, height: 1080, framerate: 30 },
      isFullscreen: false,
      handlers: {},
      aspectRatio: '9:16',
      globalAspectRatio: '9:16',
      onAspectRatioChange: vi.fn(),
      keyframes: [{ frame: 10, x: 0, y: 0, width: 205, height: 365, origin: 'user' }],
      clipsWithCurrentState: [],
      getTimelineScale: () => 1,
      getSegmentExportData: () => ({}),
      getFilteredKeyframesForExport: () => [],
    };

    expect(() => render(<FocusModeView {...props} />)).not.toThrow();
  });
});
