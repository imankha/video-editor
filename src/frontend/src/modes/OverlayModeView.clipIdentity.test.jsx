import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

/**
 * 2026-09-20 (user request): the desktop "Clip identity" card (title + game name +
 * in-match game clock, T5670) duplicated the breadcrumb directly above it (title +
 * game name already live there since T10310) and spent a whole horizontal bar doing
 * it. Same fix as Focus/T10310 (see FocusModeView.clipIdentity.test.jsx): title and
 * game name are dropped from this component entirely on desktop — game name was
 * already on the breadcrumb, and the game clock moved there too (Breadcrumb's new
 * itemMeta prop, threaded via App.jsx/UnifiedHeader). Tags keep their own small card
 * (real visual weight), never bundling the game name/title back in.
 */

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
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { OverlayModeView } from './OverlayModeView';

function renderView(overrides = {}) {
  const props = {
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
    videoTitle: 'Play 4',
    gameName: 'Vs Carlsbad Game Sep 1',
    gameClock: "0'26\"",
    videoTags: [],
    ...overrides,
  };
  return render(<OverlayModeView {...props} />);
}

// Same small-card class signature FocusModeView.clipIdentity.test.jsx pins.
function identityOrTagsCardAncestorOf(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (el.classList.contains('border-white/20') && el.classList.contains('mb-4')) return el;
  }
  return null;
}

describe('OverlayModeView desktop clip identity (2026-09-20)', () => {
  it('no longer renders a standalone desktop title/game-name card (both moved to the breadcrumb)', () => {
    renderView({ videoTags: [] });

    // "Play 4" / "Vs Carlsbad Game Sep 1" as exact standalone text only ever hit the
    // old desktop identity card. They live in the breadcrumb now, outside this
    // component (the mobile-only chip still mentions them, bundled together).
    expect(document.querySelector('.border-white\\/20.mb-4')).toBeNull();
  });

  it('never re-renders the clip title in a desktop bordered card (already in the breadcrumb above)', () => {
    renderView({ videoTags: [] });

    const titles = screen.getAllByText('Play 4');
    for (const title of titles) {
      expect(identityOrTagsCardAncestorOf(title)).toBeNull();
    }
  });

  it('tags keep their own bordered card, and it never pulls in the title or game name', () => {
    renderView({ videoTags: ['Goal', 'Assist'] });

    const tag = screen.getByText('Goal');
    const tagCard = identityOrTagsCardAncestorOf(tag);
    expect(tagCard).not.toBeNull();
    expect(tagCard.textContent).not.toMatch('Vs Carlsbad');
    expect(tagCard.textContent).not.toMatch('Play 4');
  });
});
