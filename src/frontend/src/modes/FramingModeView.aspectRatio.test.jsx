import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T4050: the reel-level AspectRatioSelector must reflect the GLOBAL (reel) aspect
 * ratio, not the clip-level crop ratio. Previously FramingModeView passed the
 * clip-level `aspectRatio` to the selector; the value was only correct because a
 * sync effect happened to keep them aligned. This locks the selector to
 * `globalAspectRatio` so the displayed ratio is always the persisted reel ratio.
 */

// Capture every aspectRatio the selector is rendered with.
const selectorRatios = [];
vi.mock('../components/AspectRatioSelector', () => ({
  default: ({ aspectRatio }) => {
    selectorRatios.push(aspectRatio);
    return <div data-testid="aspect-selector">{aspectRatio}</div>;
  },
}));

// Stub the heavy children — we only care about prop wiring, not their behaviour.
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
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: () => '0:00' }));
vi.mock('./framing', () => ({ FramingMode: () => <div />, CropOverlay: () => <div /> }));
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
vi.mock('../stores/editorStore', () => ({ useEditorStore: () => () => {} }));

import { FramingModeView } from './FramingModeView';

function renderView(overrides = {}) {
  const props = {
    videoRef: { current: null },
    videoUrl: 'blob:video',
    metadata: { width: 1920, height: 1080, framerate: 30 },
    isFullscreen: false,
    handlers: {},
    aspectRatio: '9:16',        // clip-level crop ratio
    globalAspectRatio: '16:9',  // reel-level ratio (authoritative for the selector)
    onAspectRatioChange: vi.fn(),
    keyframes: [],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    ...overrides,
  };
  return render(<FramingModeView {...props} />);
}

describe('FramingModeView aspect-ratio selector wiring (T4050)', () => {
  beforeEach(() => {
    selectorRatios.length = 0;
  });

  it('passes the GLOBAL aspect ratio to the selector, not the clip-level ratio', () => {
    renderView({ aspectRatio: '9:16', globalAspectRatio: '16:9' });
    expect(selectorRatios.length).toBeGreaterThan(0);
    // Every rendered selector must show the reel-level ratio.
    for (const r of selectorRatios) {
      expect(r).toBe('16:9');
    }
    expect(selectorRatios).not.toContain('9:16');
  });

  it('reflects a 9:16 reel ratio even when the clip crop ratio is 16:9', () => {
    renderView({ aspectRatio: '16:9', globalAspectRatio: '9:16' });
    expect(selectorRatios.length).toBeGreaterThan(0);
    for (const r of selectorRatios) {
      expect(r).toBe('9:16');
    }
  });
});
