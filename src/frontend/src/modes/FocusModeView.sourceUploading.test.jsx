import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T15730: a clip whose source game is still uploading gets `videoUrl: null` and
 * `isSourceUploading: true` from FocusScreen (see FocusScreen.jsx's 409 handling).
 * Pins both acceptance criteria at the FocusModeView layer:
 *   C1: VideoPlayer receives isSourceUploading so it renders the "still uploading"
 *       panel instead of a dead-URL <video> (VideoPlayer.t15730.test.jsx proves the
 *       panel itself; this proves FocusModeView forwards the flag).
 *   C2: Sharpen (Generate) is disabled -- ExportButtonContainer receives
 *       disabled=true because FocusModeView derives it from `!videoUrl`.
 */

vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
let lastVideoPlayerProps = null;
vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: (p) => { lastVideoPlayerProps = p; return <div />; } }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({ default: ({ actionsAbove }) => <div>{actionsAbove}</div> }));
let lastExportContainerArgs = null;
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: (args) => { lastExportContainerArgs = args; return {}; },
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
    isPlaying: true,
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

describe('T15730 FocusModeView source-uploading disables Sharpen and forwards the flag', () => {
  beforeEach(() => {
    lastVideoPlayerProps = null;
    lastExportContainerArgs = null;
  });

  it('C1: forwards isSourceUploading to VideoPlayer', () => {
    renderView({ videoUrl: null, isSourceUploading: true });
    expect(lastVideoPlayerProps.isSourceUploading).toBe(true);
  });

  it('C2: offers no Sharpen/Generate band at all while there is no video URL (ActionBand is gated on videoUrl)', () => {
    renderView({ videoUrl: null, isSourceUploading: true });
    expect(lastExportContainerArgs).toBeNull();
  });

  it('offers the export band, enabled, for a healthy clip with a real video URL', () => {
    renderView({ videoUrl: 'blob:video', isSourceUploading: false });
    expect(lastExportContainerArgs.disabled).toBe(false);
    expect(lastVideoPlayerProps.isSourceUploading).toBe(false);
  });
});
