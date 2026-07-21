import { render, screen, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import OverrideHint from './OverrideHint';

/**
 * T5610 — the manual-override discoverability hint's show/hide + fade lifecycle.
 * It only animates; the parent (OverlayModeView) decides WHEN to show. Here we pin:
 *   - visible -> renders the pill with the exact copy at full opacity
 *   - never interactive (pointer-events-none) so it can't steal a tap
 *   - visible->false fades (opacity-0) then unmounts after the 300ms transition
 *
 * T5643 — moved the pill to sit under the "N players detected" badge (top-right of the
 * video area) and added a new gate upstream: OverlayModeView now also requires
 * `selectedHighlightKeyframeIndex === null` before setting `visible`, so a selected
 * tracking/spotlight keyframe hides the hint. That gate is computed in OverlayModeView
 * (not owned by this dumb component), so it's covered end-to-end by the T5643 live-drive
 * QA; here we pin the component-level contract the gate relies on (visible=false hides,
 * per the "hidden when a frame is selected" case below) plus the new placement classes.
 */

const FULL = 'Tap the spotlight to adjust it — or hide tracking to edit freely';

afterEach(() => cleanup());

describe('OverrideHint', () => {
  it('renders the pill with the copy and is non-interactive at full opacity', () => {
    render(<OverrideHint visible text={FULL} />);
    const pill = screen.getByTestId('override-hint');
    expect(pill.textContent).toBe(FULL);
    expect(pill.className).toContain('pointer-events-none');
    expect(pill.className).toContain('opacity-100');
    expect(pill.className).not.toContain('opacity-0');
  });

  it('positions itself under the "N players detected" badge (top-right of the video area)', () => {
    render(<OverrideHint visible text={FULL} />);
    const pill = screen.getByTestId('override-hint');
    expect(pill.className).toContain('top-14');
    expect(pill.className).toContain('right-4');
    expect(pill.className).not.toContain('bottom-3');
  });

  it('renders nothing when not visible from the start', () => {
    render(<OverrideHint visible={false} text={FULL} />);
    expect(screen.queryByTestId('override-hint')).toBeNull();
  });

  it('is hidden when a tracking frame is selected (OverlayModeView sets visible=false)', () => {
    // The selected-frame gate is computed upstream in OverlayModeView
    // (selectedHighlightKeyframeIndex === null); this component only reacts to `visible`.
    render(<OverrideHint visible={false} text={FULL} />);
    expect(screen.queryByTestId('override-hint')).toBeNull();
  });

  it('fades out (opacity-0) then unmounts ~300ms after visible flips false', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<OverrideHint visible text={FULL} />);
      expect(screen.getByTestId('override-hint').className).toContain('opacity-100');

      rerender(<OverrideHint visible={false} text={FULL} />);
      // Still mounted, now fading.
      const fading = screen.getByTestId('override-hint');
      expect(fading.className).toContain('opacity-0');
      expect(fading.className).toContain('transition-opacity');

      // After the transition window it unmounts and stays gone.
      act(() => vi.advanceTimersByTime(320));
      expect(screen.queryByTestId('override-hint')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a shortened mobile copy', () => {
    render(<OverrideHint visible text="Tap the spotlight to adjust" />);
    expect(screen.getByTestId('override-hint').textContent).toBe('Tap the spotlight to adjust');
  });
});
