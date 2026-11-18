import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * T17190:C1 -- during a sharpen the progress card says the parent can leave and where the
 * highlight will be, never "Generating" / "Time remaining varies.", and on Frame it sits
 * BELOW the video instead of floating over it (docked into the slot under focus-video-stage).
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
vi.mock('../modes/focus', () => ({ FocusMode: () => <div />, CropOverlay: () => <div /> }));
vi.mock('../hooks/useIsMobile', async (orig) => ({ ...(await orig()), useIsMobile: () => true }));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true,
    handleInteraction: () => {},
    handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {},
    handleLongPressTouchEnd: () => {},
  }),
}));

import GlobalExportIndicator from './GlobalExportIndicator';
import { FocusModeView } from '../modes/FocusModeView';
import { useExportStore } from '../stores/exportStore';

function sharpening(percent = 15) {
  useExportStore.setState({
    activeExports: {
      export_1: {
        exportId: 'export_1', projectId: 7, projectName: 'Saturday goal', type: 'framing', status: 'processing',
        progress: { current: percent, total: 100, percent, message: 'Rendering', phase: 'processing' },
        startedAt: new Date().toISOString(), completedAt: null, error: null,
      },
    },
  });
}

function renderFrame() {
  return render(
    <>
      <FocusModeView
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
      />
      <GlobalExportIndicator />
    </>,
  );
}

afterEach(() => {
  cleanup();
  useExportStore.getState().reset();
});

describe('T17190:C1 sharpen progress card', () => {
  it('says the parent can leave and where the highlight goes, with no retired copy', () => {
    sharpening(15);
    render(<GlobalExportIndicator />);
    const text = screen.getByTestId('global-export-indicator').textContent;
    expect(text).toContain('Sharpening your highlight... 15%');
    expect(text).toContain('You can leave. It will be in Highlights when it is ready.');
    expect(text).toContain('Usually a few minutes');
    expect(text).not.toMatch(/Generating/);
    expect(text).not.toMatch(/Time remaining varies/);
  });

  it('on Frame the card sits in the slot directly below the video, not floating over it', () => {
    sharpening(15);
    renderFrame();
    const stage = screen.getByTestId('focus-video-stage');
    const card = screen.getByTestId('global-export-indicator');
    expect(stage.contains(card)).toBe(false);
    expect(stage.nextElementSibling?.contains(card)).toBe(true);
    expect(card.className).not.toMatch(/\bfixed\b/);
  });
});
