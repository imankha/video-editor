import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GUIDE } from '../config/displayNames';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * T12500: "Add text" never dead-ends. Over existing text it adds a text block
 * into that region (not a no-op that leaves an empty panel); the Text tab's
 * sheet is titled "Text", not "Spotlight settings".
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({
  default: ({ actionsAbove }) => <div data-testid="overlay-export-button">{actionsAbove}Export</div>,
}));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: (t) => `${t}` }));
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

const REGION = {
  id: 'r1', index: 0, startTime: 0, endTime: 2,
  elements: [{ id: 'a1', spec: { text: 'HELLO' }, enabled: true }],
};

function baseProps(overrides = {}) {
  return {
    videoRef: { current: null },
    effectiveOverlayVideoUrl: 'blob:overlay',
    effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 2 },
    isFullscreen: false,
    handlers: {},
    highlightRegions: [],
    highlightBoundaries: [],
    highlightRegionKeyframes: [],
    getTimelineScale: () => 1,
    getRegionsForExport: () => [],
    textOverlays: [],
    currentTime: 0,
    ...overrides,
  };
}


// T12790: the text tip was a hand-rolled coach with its own copy, so the overlay.text guide
// rule could never match. Add text now resolves that rule like every other guide.
describe('OverlayModeView -- Add text guide (T12790)', () => {
  beforeEach(() => useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } })));

  it('Add text shows the overlay.text guide sentence', () => {
    render(<OverlayModeView {...baseProps({ textOverlays: [REGION], onAddElement: vi.fn(), currentTime: 1 })} />);
    expect(document.body.textContent).not.toContain(GUIDE.overlay.text);
    fireEvent.click(screen.getByTestId('overlay-add-text-button'));
    expect(screen.getByTestId('overlay-text-guide').textContent).toContain(GUIDE.overlay.text);
    expect(document.body.textContent).not.toContain('Make the text your own.');
  });
});
