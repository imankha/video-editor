import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/** T13580:C4 (bug 23): Frame shows a loading state, never "No video loaded", while the clip URL is pending. */

vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
let lastVideoPlayerProps = null;
vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: (p) => { lastVideoPlayerProps = p; return <div />; } }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({ default: ({ actionsAbove }) => <div>{actionsAbove}</div> }));
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
vi.mock('./focus', () => ({
  FocusMode: () => <div />,
  CropOverlay: () => <div />,
}));
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
    keyframes: [{ frame: 10, x: 0, y: 0, width: 100, height: 100, origin: 'user' }],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    // Trim and SlowMo is locked until the guided steps are done (drag + play).
    isPlaying: true,
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}


describe('FocusModeView loading state (T13580)', () => {
  it('tells VideoPlayer it is loading while there is no video URL yet', () => {
    renderView({ videoUrl: '', isLoading: false, isProjectLoading: false, error: null });
    expect(lastVideoPlayerProps.isLoading).toBe(true);
  });

  it('is not loading once the video URL is present', () => {
    renderView({ videoUrl: 'blob:video', isLoading: false, isProjectLoading: false });
    expect(lastVideoPlayerProps.isLoading).toBe(false);
  });
});
