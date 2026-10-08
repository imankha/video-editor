import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T10970: the Overlay timeline's Text lane starts collapsed unless the clip
 * already has text. Pins:
 *   - a clip with NO text regions defaults to the lane hidden
 *   - a clip that already HAS text regions defaults to the lane shown
 *   - the "Add text" gesture opens the lane (gesture override; 3662653a0
 *     replaced the old "Text" disclosure toggle with this card)
 * The OverlayMode mock records the `showTextLane` prop it receives.
 */

const overlayModeProps = vi.fn();

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({
  default: () => <div data-testid="overlay-export-button">Export</div>,
}));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}),
  HIGHLIGHT_EFFECT_LABELS: {},
  EXPORT_CONFIG: {},
}));
vi.mock('../components/shared', () => ({ Button: ({ children }) => <button>{children}</button> }));
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: (t) => `${t}` }));
vi.mock('./overlay', () => ({
  OverlayMode: (props) => {
    overlayModeProps(props);
    return <div data-testid="overlay-timeline" />;
  },
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
    effectiveOverlayMetadata: { width: 1920, height: 1080, framerate: 30, duration: 10 },
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

function lastShowTextLane() {
  const calls = overlayModeProps.mock.calls;
  return calls[calls.length - 1][0].showTextLane;
}

// 3662653a0 ("Unify CTA cards and guidance across editor modes") removed the
// under-timeline "Text" disclosure button; the "Add text" action card in the
// action band is now the gesture that opens the Text lane (it sets the same
// textLaneOverride to true). The derived defaults below are unchanged.
describe('OverlayModeView -- Text lane disclosure (T10970)', () => {
  it('a clip with no text regions starts with the lane hidden', () => {
    render(<OverlayModeView {...baseProps()} />);
    expect(lastShowTextLane()).toBe(false);
    expect(screen.queryByTestId('text-lane-disclosure')).toBeNull();
  });

  it('a clip that already has text regions starts with the lane shown', () => {
    render(<OverlayModeView {...baseProps({ textOverlays: [REGION] })} />);
    expect(lastShowTextLane()).toBe(true);
  });

  it('clicking Add text opens the lane and adds a region at the playhead when none is there', () => {
    const onAddRegion = vi.fn();
    render(<OverlayModeView {...baseProps({ onAddRegion, currentTime: 5 })} />);
    expect(lastShowTextLane()).toBe(false);
    fireEvent.click(screen.getByTestId('overlay-add-text-button'));
    expect(lastShowTextLane()).toBe(true);
    expect(onAddRegion).toHaveBeenCalledTimes(1);
    expect(onAddRegion).toHaveBeenCalledWith(5);
  });

  it('clicking Add text over existing text keeps the lane shown and adds no duplicate region', () => {
    const onAddRegion = vi.fn();
    render(<OverlayModeView {...baseProps({ textOverlays: [REGION], onAddRegion, currentTime: 1 })} />);
    fireEvent.click(screen.getByTestId('overlay-add-text-button'));
    expect(lastShowTextLane()).toBe(true);
    expect(onAddRegion).not.toHaveBeenCalled();
  });
});
