import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AnnotateTimeline } from './AnnotateTimeline';

/**
 * T11150 — the empty-plays message must use Highlight-flow vocabulary ("plays",
 * never "clips"). The MOBILE timeline branch renders a single ClipRegionLayer
 * WITHOUT an explicit emptyMessage, so it fell through to ClipRegionLayer's old
 * default 'No clips yet' — a user-visible "clip" string on a zero-play mobile
 * game. Pins the default at "No plays yet" and guards against any "clip" text.
 */

beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Mobile detection (useIsMobile reads matchMedia): match the max-width query.
  window.matchMedia = (query) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});
afterEach(() => cleanup());

const baseProps = {
  currentTime: 0,
  duration: 300,
  onSeek: () => {},
  regions: [],
  selectedRegionId: null,
  onSelectRegion: () => {},
  onDeleteRegion: () => {},
};

describe('AnnotateTimeline — empty message vocabulary (T11150)', () => {
  it('mobile, zero plays: shows "No plays yet" and no "clip" text anywhere', () => {
    const { container } = render(<AnnotateTimeline {...baseProps} />);
    expect(screen.getByText('No plays yet')).toBeTruthy();
    expect(container.textContent).not.toMatch(/clip/i);
    // Attributes too (title/aria-label/placeholder).
    container.querySelectorAll('[title], [aria-label], [placeholder]').forEach((el) => {
      for (const attr of ['title', 'aria-label', 'placeholder']) {
        const v = el.getAttribute(attr);
        if (v) expect(v).not.toMatch(/clip/i);
      }
    });
  });
});
