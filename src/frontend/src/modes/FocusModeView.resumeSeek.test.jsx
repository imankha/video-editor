import { render } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * T15340: `/focus/p/{id}?t=37` opens with the player at 0:37. The one-shot seek
 * waits for a real duration (useVideo.seek's own T10750 guard would otherwise
 * refuse an early seek and silently clamp to 0), then drops the URL's `t` so a
 * later reload/navigation on this project never reseeks.
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
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
  Toggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange?.(!checked)} />
  ),
}));
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: () => '0:00' }));
vi.mock('./focus', () => ({ FocusMode: () => <div />, CropOverlay: () => <div /> }));
vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
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

import { FocusModeView } from './FocusModeView';

function renderView(overrides = {}) {
  const props = {
    videoRef: { current: null },
    videoUrl: 'blob:video',
    metadata: { width: 1920, height: 1080, framerate: 30 },
    isFullscreen: false,
    handlers: {},
    aspectRatio: '9:16',
    globalAspectRatio: '9:16',
    onAspectRatioChange: vi.fn(),
    keyframes: [],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

describe('FocusModeView resume seek (T15340)', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('seeks once the player has a duration, using the URL `t`, then drops the param', () => {
    window.history.pushState({}, '', '/focus/p/7?t=37');
    const seek = vi.fn();
    renderView({ projectId: 7, duration: 60, seek });

    expect(seek).toHaveBeenCalledWith(37);
    expect(window.location.pathname + window.location.search).toBe('/focus/p/7');
  });

  it('does not seek before the video has a duration', () => {
    window.history.pushState({}, '', '/focus/p/7?t=37');
    const seek = vi.fn();
    renderView({ projectId: 7, duration: 0, seek });

    expect(seek).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?t=37');
  });

  it('does not seek for a `t` that names a different project', () => {
    window.history.pushState({}, '', '/focus/p/9?t=37');
    const seek = vi.fn();
    renderView({ projectId: 7, duration: 60, seek });

    expect(seek).not.toHaveBeenCalled();
  });

  it('is a true one-shot: a duration change after the seek never reseeks', () => {
    window.history.pushState({}, '', '/focus/p/7?t=37');
    const seek = vi.fn();
    const { rerender } = renderView({ projectId: 7, duration: 60, seek });
    expect(seek).toHaveBeenCalledTimes(1);

    rerender(<FocusModeView
      videoRef={{ current: null }}
      videoUrl="blob:video"
      metadata={{ width: 1920, height: 1080, framerate: 30 }}
      isFullscreen={false}
      handlers={{}}
      aspectRatio="9:16"
      globalAspectRatio="9:16"
      onAspectRatioChange={vi.fn()}
      keyframes={[]}
      clipsWithCurrentState={[]}
      getTimelineScale={() => 1}
      getSegmentExportData={() => ({})}
      getFilteredKeyframesForExport={() => []}
      projectId={7}
      duration={65}
      seek={seek}
    />);
    expect(seek).toHaveBeenCalledTimes(1);
  });
});
