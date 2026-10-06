import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// T11240 C1/C3: a single-clip Focus project must render no multi-clip editing UI:
// no Clips settings-rail tab, no "N clips in this reel" copy, no project Total
// chip. RED on master for the Clips tab / copy (FocusClipsPanel + its tab are
// still mounted regardless of clip count); the Total chip assertion is already
// true on master for a single clip (isMultiClip requires length > 1) and stays
// true — a characterization, not a red-to-green flip.

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
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: () => '0:00' }));
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

function renderView(overrides = {}) {
  const clip = { id: 1, cropKeyframes: [], segments: {} };
  const props = {
    videoRef: { current: null },
    videoUrl: 'blob:video',
    metadata: { width: 1920, height: 1080, framerate: 30 },
    isFullscreen: false,
    handlers: {},
    aspectRatio: '9:16',
    globalAspectRatio: '9:16',
    onAspectRatioChange: vi.fn(),
    keyframes: [{ frame: 10, x: 0, y: 0, width: 205, height: 365, origin: 'user' }],
    hasClips: true,
    clipsWithCurrentState: [clip],
    selectedClipEffectiveDuration: 5,
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

describe('FocusModeView single-clip UI (T11240)', () => {
  it('renders no Clips settings-rail tab', () => {
    renderView();
    expect(screen.queryByTestId('settings-tab-clips')).toBeNull();
  });

  it('renders no "clips in this reel" copy anywhere', () => {
    renderView();
    expect(screen.queryByText(/clips? in this reel/i)).toBeNull();
  });

  it('renders no project Total output chip for a single clip', () => {
    renderView();
    expect(screen.queryByTestId('project-output-length-chip')).toBeNull();
  });
});
