import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveGuide } from '../components/instructions/resolveGuide';
import { useSettingsStore } from '../stores/settingsStore';
import { useGuidePulse } from '../components/instructions/GuideScope';
import { GUIDE_PULSE } from '../components/instructions/guideTargets';

/**
 * T12500: "Add text" never dead-ends. Over existing text it adds a text block
 * into that region (not a no-op that leaves an empty panel); the Text tab's
 * sheet is titled "Text", not "Spotlight settings".
 */

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({
  default: function ExportMock({ actionsAbove }) {
    const pulse = useGuidePulse(GUIDE_PULSE.EXPORT);
    return <div data-testid="overlay-export-button" data-pulsing={pulse ? 'yes' : 'no'}>{actionsAbove}Export</div>;
  },
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

// T13380: staging re-walk 2026-10-25. With the Add text sheet open the sentence says "type a name...",
// but the pick channel kept pulsing Generate (pick.done) and shading the text field. The text rule owns the screen.
const REGION = { id: 'r1', index: 0, startTime: 0, endTime: 2, elements: [{ id: 'a1', spec: { text: 'HELLO' }, enabled: true }] };
const props = () => ({
  videoRef: { current: null },
  effectiveOverlayVideoUrl: 'blob:overlay',
  effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 2 },
  isFullscreen: false, handlers: {}, highlightRegions: [], highlightBoundaries: [], highlightRegionKeyframes: [],
  getTimelineScale: () => 1, getRegionsForExport: () => [], textOverlays: [REGION], currentTime: 1, onAddElement: vi.fn(),
  projectId: 7, pickGuidePhase: 'done', pickGuideStep: 4, pickGuideTotal: 4,
});

describe('T13380: the text rule owns the Overlay screen', () => {
  beforeEach(() => {
    useSettingsStore.setState((st) => ({ settings: { ...st.settings, guidance: { ...st.settings.guidance, coachEnabled: true } } }));
  });

  it('T13380:C1 Generate pulses for the pick walk until Add text is tapped, then nothing else pulses', () => {
    render(<OverlayModeView {...props()} />);
    expect(screen.getByTestId('overlay-export-button').dataset.pulsing).toBe('yes');
    fireEvent.click(screen.getByTestId('overlay-add-text-button'));
    expect(screen.getByTestId('overlay-text-guide')).toBeTruthy();
    expect(screen.getByTestId('overlay-export-button').dataset.pulsing).toBe('no');
  });

  it('T13380:C2 the text rule cuts the text field and timeline text blocks out of the shade', () => {
    const g = resolveGuide({ screen: 'overlay', job: { status: 'none' }, local: { textOpen: true } });
    expect(g.id).toBe('overlay.text');
    const clear = [...g.keepClear, ...g.shadeClear];
    expect(clear).toEqual(expect.arrayContaining(['[data-testid="text-settings-panel"]', '[data-testid^="text-block-body-"]', '[data-testid^="text-inline-edit-"]']));
  });
});
