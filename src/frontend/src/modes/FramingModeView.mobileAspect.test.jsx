import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * T7130 (prod bugs 41p/42p): the reel aspect-ratio selector was unreachable on a phone.
 * The controls bar holding the interactive selector was `hidden lg:flex`, and what mobile
 * showed instead was `<AspectRatioSelector readOnly />` — a div styled like the control,
 * whose only "you can't tap this" signal was a title tooltip touch never surfaces. Users
 * tapped it forever and reported a broken button.
 *
 * jsdom cannot see the bug directly: Tailwind CSS is not loaded here, so `hidden lg:flex`
 * is an inert className and every instance is "in the DOM" either way. So this pins the
 * structural facts instead — one selector, always interactive, never inside a `hidden`
 * ancestor. Visibility itself is verified in a real browser at 352/375/1280px.
 */

const selectorProps = [];
vi.mock('../components/AspectRatioSelector', () => ({
  default: (props) => {
    selectorProps.push(props);
    return (
      <div
        data-testid="aspect-selector"
        data-interactive={props.onAspectRatioChange ? 'true' : 'false'}
      />
    );
  },
}));

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

// Toggled per-test.
const isMobileMock = vi.fn(() => false);
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => isMobileMock() }));

import { FramingModeView } from './FramingModeView';

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
    clipTitle: 'Brilliant Play',
    keyframes: [],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    ...overrides,
  };
  return render(<FramingModeView {...props} />);
}

/** Bare `hidden` (not `lg:hidden`) on any ancestor means the node is gone below 1024px. */
function hiddenAncestorOf(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (el.classList.contains('hidden')) return el;
  }
  return null;
}

describe('FramingModeView aspect-ratio reachability on mobile (T7130)', () => {
  beforeEach(() => {
    selectorProps.length = 0;
  });

  it('renders exactly one aspect selector, and it is interactive', () => {
    isMobileMock.mockReturnValue(true);
    renderView();

    const selectors = screen.getAllByTestId('aspect-selector');
    expect(selectors).toHaveLength(1);
    expect(selectors[0].getAttribute('data-interactive')).toBe('true');
  });

  it('never renders a read-only look-alike selector', () => {
    isMobileMock.mockReturnValue(true);
    renderView();

    for (const props of selectorProps) {
      expect(props.readOnly).toBeUndefined();
      expect(typeof props.onAspectRatioChange).toBe('function');
    }
  });

  it('keeps the interactive selector out of any desktop-only (`hidden`) container', () => {
    isMobileMock.mockReturnValue(true);
    renderView();

    const selector = screen.getByTestId('aspect-selector');
    expect(hiddenAncestorOf(selector)).toBeNull();
  });

  it('keeps the selector interactive and reachable when the clip has no title', () => {
    // Pre-fix the mobile chip lived inside a `clipTitle &&` guard, so an untitled clip
    // showed no ratio at all — and the only other instance was the `hidden` desktop bar.
    isMobileMock.mockReturnValue(true);
    renderView({ clipTitle: undefined });

    const selectors = screen.getAllByTestId('aspect-selector');
    expect(selectors).toHaveLength(1);
    expect(selectors[0].getAttribute('data-interactive')).toBe('true');
    expect(hiddenAncestorOf(selectors[0])).toBeNull();
  });

  it('still renders one interactive selector on desktop (no regression)', () => {
    isMobileMock.mockReturnValue(false);
    renderView();

    const selectors = screen.getAllByTestId('aspect-selector');
    expect(selectors).toHaveLength(1);
    expect(selectors[0].getAttribute('data-interactive')).toBe('true');
    expect(hiddenAncestorOf(selectors[0])).toBeNull();
  });
});
