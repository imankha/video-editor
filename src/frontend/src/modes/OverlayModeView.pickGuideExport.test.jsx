import { render, act } from '@testing-library/react';
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
import { useExportStore } from '../stores/exportStore';

// Live walk 2026-10-17: after the last athlete pick, "Spotlight set. Tap Generate..." stayed up (with its
// shade dimming the whole page) for the entire spotlight export, behind "Adding your spotlight".
// While the export runs the pick walk is over: only the job card speaks.
const props = () => ({
  videoRef: { current: null },
  effectiveOverlayVideoUrl: 'blob:overlay',
  effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 2 },
  isFullscreen: false, handlers: {}, highlightRegions: [], highlightBoundaries: [], highlightRegionKeyframes: [],
  getTimelineScale: () => 1, getRegionsForExport: () => [], textOverlays: [], currentTime: 0,
  projectId: 7, pickGuidePhase: 'done', pickGuideStep: 4, pickGuideTotal: 4,
});

describe('OverlayModeView: the pick walk stands down while the spotlight export runs', () => {
  beforeEach(() => {
    useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } }));
    useExportStore.setState({ activeExports: {} });
  });

  it('"Spotlight set" shows before Generate, and is gone once the export is processing', () => {
    render(<OverlayModeView {...props()} />);
    expect(document.body.textContent).toContain(GUIDE.overlay.pick.done.title);
    act(() => { useExportStore.setState({ activeExports: { e1: { projectId: 7, type: 'overlay', status: 'processing' } } }); });
    expect(document.body.textContent).not.toContain(GUIDE.overlay.pick.done.title);
    expect(document.body.textContent).toContain(GUIDE.overlay.progress);
  });
});
