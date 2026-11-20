import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

/**
 * T9950 Slice 1: the segment/speed/trim track collapses behind a "Trim and
 * slow motion" disclosure (renamed from "Advanced editing" 2026-09-18, then
 * "Trim and SlowMo" -> "Trim and slow motion" in 3662653a0; testid unchanged).
 * The original R4 default (open when the clip already has splits or a trim
 * range) was reversed in 134b1c6c4 ("opt-in editing steps"): the track is
 * opt-in every time and stays collapsed until the user opens it, even when
 * the clip already has saved edits. The edits themselves are untouched.
 */

vi.mock('../components/AspectRatioSelector', () => ({ default: () => <div /> }));
vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({ default: ({ actionsAbove }) => <div>{actionsAbove}</div> }));
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
vi.mock('../components/shared/clipConstants', () => ({ DEFAULT_CLIP_BEFORE: 6, DEFAULT_CLIP_AFTER: 2, formatTimeSimple: () => '0:00' }));
let lastFocusModeProps = null;
vi.mock('./focus', () => ({
  FocusMode: (props) => {
    lastFocusModeProps = props;
    return <div />;
  },
  CropOverlay: () => <div />,
}));
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
    keyframes: [{ frame: 10, x: 0, y: 0, width: 100, height: 100, origin: 'user' }],
    clipsWithCurrentState: [],
    getTimelineScale: () => 1,
    getSegmentExportData: () => ({}),
    getFilteredKeyframesForExport: () => [],
    // Trim and SlowMo is locked until the guided steps are done (drag + play).
    isPlaying: true,
    ...overrides,
  };
  return render(<FocusModeView {...props} />);
}

describe('FocusModeView Advanced editing disclosure (T9950 Slice 1)', () => {
  it('defaults collapsed for a fresh clip with no splits or trim', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    const toggle = screen.getByTestId('trim-slowmo-button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(lastFocusModeProps.showSegments).toBe(false);
  });

  // Regression (2026-09-18 user request): the disclosure's label was renamed
  // from "Advanced editing" to name what it reveals (segment/speed/trim
  // controls). Current copy is "Trim and slow motion" (3662653a0).
  it('labels the button "Trim and slow motion"', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    expect(screen.getByRole('button', { name: 'Trim and slow motion' })).toBe(
      screen.getByTestId('trim-slowmo-button'),
    );
  });

  // 134b1c6c4: Trim and slow motion is opt-in every time; saved splits do not
  // auto-open it. Opening it still reveals the existing split.
  it('stays collapsed when the clip already has a user split, and opens on click', () => {
    renderView({ segmentBoundaries: [0, 50, 100], trimRange: null });
    const toggle = screen.getByTestId('trim-slowmo-button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(lastFocusModeProps.showSegments).toBe(false);
    fireEvent.click(toggle);
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-expanded')).toBe('true');
    expect(lastFocusModeProps.showSegments).toBe(true);
    expect(lastFocusModeProps.segmentBoundaries).toEqual([0, 50, 100]);
  });

  it('stays collapsed when the clip already has a trim range (134b1c6c4 opt-in)', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: { start: 0, end: 50 } });
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-expanded')).toBe('false');
    expect(lastFocusModeProps.showSegments).toBe(false);
  });

  it('toggles open/closed on click (gesture override)', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    const toggle = screen.getByTestId('trim-slowmo-button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-expanded')).toBe('true');
    expect(lastFocusModeProps.showSegments).toBe(true);
    fireEvent.click(screen.getByTestId('trim-slowmo-button'));
    expect(screen.getByTestId('trim-slowmo-button').getAttribute('aria-expanded')).toBe('false');
  });

  it('does not render the disclosure without a video', () => {
    renderView({ videoUrl: '' });
    expect(screen.queryByTestId('trim-slowmo-button')).toBeNull();
  });

  // T13580:C1 (bug 21): on a phone the lane opens below the fixed bottom panel;
  // opening it must bring the timeline scope into view, clear of the CTA band.
  // T16710: the scroll happens even when the scope sits inside the scroller's viewport but
  // under the band (scrollIntoView 'nearest' skipped that case in Chromium).
  function withLayout({ scopeTop, scopeBottom, marginBottom }, run) {
    const origRect = Element.prototype.getBoundingClientRect;
    const origScrollBy = Element.prototype.scrollBy;
    const origRaf = globalThis.requestAnimationFrame;
    const origStyle = window.getComputedStyle;
    const scrolled = [];
    Element.prototype.getBoundingClientRect = function () {
      if (this.dataset?.testid === 'trim-guide-scope') return { top: scopeTop, bottom: scopeBottom };
      return { top: 0, bottom: 800 };
    };
    Element.prototype.scrollBy = function (opts) { scrolled.push([this, opts]); };
    globalThis.requestAnimationFrame = (cb) => { cb(0); return 0; };
    window.getComputedStyle = (el) => {
      if (el.dataset?.testid === 'trim-guide-scope') return { overflowY: 'visible', scrollMarginBottom: `${marginBottom}px` };
      if (el.dataset?.testid === 'view-scroller') return { overflowY: 'auto' };
      return { overflowY: 'visible' };
    };
    try {
      run(scrolled);
    } finally {
      Element.prototype.getBoundingClientRect = origRect;
      Element.prototype.scrollBy = origScrollBy;
      globalThis.requestAnimationFrame = origRaf;
      window.getComputedStyle = origStyle;
    }
  }

  it('scrolls the timeline scope clear of the band when Trim and slow motion opens', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    const scope = screen.getByTestId('trim-guide-scope');
    expect(scope.style.scrollMarginBottom).toContain('--cta-bar-h');
    scope.parentElement.dataset.testid = 'view-scroller';
    // 1280x800 staging layout: scope 490-744 inside the 800px scroller, band 73px + 8px margin.
    withLayout({ scopeTop: 490, scopeBottom: 744, marginBottom: 81 }, (scrolled) => {
      fireEvent.click(screen.getByTestId('trim-slowmo-button'));
      expect(scrolled).toHaveLength(1);
      expect(scrolled[0][0]).toBe(scope.parentElement);
      expect(scrolled[0][1]).toEqual({ top: 25, behavior: 'smooth' });
      // Closing does not scroll.
      fireEvent.click(screen.getByTestId('trim-slowmo-button'));
      expect(scrolled).toHaveLength(1);
    });
  });

  it('does not scroll when the timeline scope already clears the band', () => {
    renderView({ segmentBoundaries: [0, 100], trimRange: null });
    screen.getByTestId('trim-guide-scope').parentElement.dataset.testid = 'view-scroller';
    withLayout({ scopeTop: 300, scopeBottom: 600, marginBottom: 81 }, (scrolled) => {
      fireEvent.click(screen.getByTestId('trim-slowmo-button'));
      expect(scrolled).toHaveLength(0);
    });
  });
});
