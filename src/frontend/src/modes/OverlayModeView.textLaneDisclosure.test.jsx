import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T10970: the Overlay timeline's Text lane sits behind a "Text" disclosure
 * under the timeline, mirroring Focus's "Trim and Slo-mo" (T9950). Pins:
 *   - a clip with NO text regions defaults to the lane hidden
 *   - a clip that already HAS text regions defaults to the lane shown
 *   - the disclosure click flips the lane either way (gesture override)
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
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: (t) => `${t}` }));
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
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));

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

describe('OverlayModeView -- Text lane disclosure (T10970)', () => {
  it('a clip with no text regions starts with the lane hidden and the disclosure collapsed', () => {
    render(<OverlayModeView {...baseProps()} />);
    expect(lastShowTextLane()).toBe(false);
    expect(screen.getByTestId('text-lane-disclosure').getAttribute('aria-expanded')).toBe('false');
  });

  it('a clip that already has text regions starts with the lane shown', () => {
    render(<OverlayModeView {...baseProps({ textOverlays: [REGION] })} />);
    expect(lastShowTextLane()).toBe(true);
    expect(screen.getByTestId('text-lane-disclosure').getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking the disclosure opens the lane, clicking again hides it', () => {
    render(<OverlayModeView {...baseProps()} />);
    const disclosure = screen.getByTestId('text-lane-disclosure');
    fireEvent.click(disclosure);
    expect(lastShowTextLane()).toBe(true);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(disclosure);
    expect(lastShowTextLane()).toBe(false);
  });

  it('the disclosure can hide a lane that defaulted open because text exists', () => {
    render(<OverlayModeView {...baseProps({ textOverlays: [REGION] })} />);
    fireEvent.click(screen.getByTestId('text-lane-disclosure'));
    expect(lastShowTextLane()).toBe(false);
  });
});
