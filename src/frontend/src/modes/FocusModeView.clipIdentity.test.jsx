import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

/**
 * T10310 (2026-09-18 user request): the desktop "clip identity" block used to be
 * a full-width bordered/backgrounded card duplicating the clip title (already
 * shown in the breadcrumb above the editor) plus the game name plus tags. The
 * user X'd it out and asked for the game name to move somewhere that doesn't
 * spend a dedicated horizontal bar on it. Fix: the game name renders as plain
 * de-emphasized text with no card; the clip title is dropped from this component
 * entirely on desktop (mobile keeps its own separate under-video chip); tags keep
 * their own card since they carry real visual weight, but it never bundles the
 * game name in with it.
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
vi.mock('../components/shared', () => ({
  Button: ({ children }) => <button>{children}</button>,
  Toggle: ({ checked, onChange }) => (
    <button role="switch" aria-checked={checked} onClick={() => onChange?.(!checked)} />
  ),
}));
vi.mock('../components/shared/clipConstants', () => ({ formatTimeSimple: () => '0:00' }));
vi.mock('./focus', () => ({ FocusMode: () => <div />, CropOverlay: () => <div /> }));
vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
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
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { FocusModeView } from './FocusModeView';

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
    clipTitle: 'Play 1',
    clipGameName: 'Vs Carlsbad Game Sep 1',
    keyframes: [],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

// The old "clip identity" bar and the new tags-only card share the SAME class
// signature by design (`mb-4 ... border-white/20 ... p-3 lg:p-4`) -- distinct
// from the much bigger outer editor-area card (`p-3 sm:p-6`, no `mb-4`), which
// wraps everything (video included) and is unrelated to this fix. So walk for
// THAT specific small-card signature, not just "any bordered ancestor".
function identityOrTagsCardAncestorOf(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (el.classList.contains('border-white/20') && el.classList.contains('mb-4')) return el;
  }
  return null;
}

describe('FocusModeView desktop clip identity (T10310)', () => {
  it('renders the game name as plain text with no bordered card ancestor', () => {
    renderView({ clipTags: [] });

    const gameName = screen.getByText('Vs Carlsbad Game Sep 1');
    expect(identityOrTagsCardAncestorOf(gameName)).toBeNull();
    // No small identity/tags card at all -- there are no tags to justify one.
    expect(document.querySelector('.border-white\\/20.mb-4')).toBeNull();
  });

  it('never re-renders the clip title in a desktop bordered card (already in the breadcrumb above)', () => {
    renderView({ clipTags: [] });

    // "Play 1" still exists once, in the mobile-only under-video chip (lg:hidden) --
    // never bundled into a bordered identity/tags card.
    const title = screen.getByText('Play 1');
    expect(identityOrTagsCardAncestorOf(title)).toBeNull();
  });

  it('tags keep their own bordered card, separate from the game name', () => {
    renderView({ clipTags: ['Goal', 'Assist'] });

    const gameName = screen.getByText('Vs Carlsbad Game Sep 1');
    const tag = screen.getByText('Goal');
    expect(identityOrTagsCardAncestorOf(gameName)).toBeNull();
    const tagCard = identityOrTagsCardAncestorOf(tag);
    expect(tagCard).not.toBeNull();
    // The card holding tags never also contains the game name text.
    expect(tagCard.textContent).not.toMatch('Vs Carlsbad');
  });
});
