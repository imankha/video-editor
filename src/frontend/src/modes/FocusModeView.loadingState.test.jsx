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
  Button: ({ children, onClick, 'data-testid': testId }) => (
    <button onClick={onClick} data-testid={testId}>{children}</button>
  ),
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

// T16040: a project open with no video and nothing in flight must never sit on the
// plain "Loading..." spinner forever -- it looks identical whether the load will
// finish in a second or never.
describe('FocusModeView stuck-empty state (T16040)', () => {
  it('stops telling VideoPlayer it is loading once stuckEmpty fires', () => {
    const { getByTestId } = renderView({
      videoUrl: '', isLoading: false, isProjectLoading: false, error: null, stuckEmpty: true,
    });
    expect(lastVideoPlayerProps.isLoading).toBe(false);
    expect(getByTestId('focus-stuck-empty')).toBeTruthy();
  });

  it('offers a way back when stuck, via the passed-in handler', () => {
    const onBackToAnnotate = vi.fn();
    const { getByTestId } = renderView({
      videoUrl: '', isLoading: false, isProjectLoading: false, error: null, stuckEmpty: true, onBackToAnnotate,
    });
    getByTestId('focus-stuck-back-to-annotate').click();
    expect(onBackToAnnotate).toHaveBeenCalled();
  });

  it('does not show the stuck message while a real error is already shown', () => {
    const { queryByTestId } = renderView({
      videoUrl: '', isLoading: false, isProjectLoading: false, error: 'boom', stuckEmpty: true,
    });
    expect(queryByTestId('focus-stuck-empty')).toBeNull();
  });
});
