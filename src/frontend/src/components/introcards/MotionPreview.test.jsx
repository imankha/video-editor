// T6710 Stage 3 — MotionPreview seek characterization (RED before Part A).
//
// Design doc §Part A / §9: MotionPreview must become `currentTimeMs`-driven and
// seekable so the composite scrubber can do a TRUE arbitrary seek backward into
// the intro (decision 2). Today (pre-T6710) it is mount-once, auto-plays via
// WAAPI `Animation`s built with no pause/seek control, and self-completes via
// `setTimeout(onDone, durationMs + 60)`. These tests pin the TARGET behavior:
//
//   1. Seeking to `currentTimeMs=X` holds pose X (a real `seek`, not just play).
//   2. A font-settle-triggered remount (new `elements` identity) at
//      currentTimeMs=X leaves the visual AT X, not reset to 0 (R1 guard).
//   3. No `setTimeout` auto-continue fires any more — end-of-intro ownership
//      moves to the composite via `useIntroPlayback`, not `MotionPreview`.
//
// jsdom has no Web Animations API, so this file polyfills a minimal, spy-able
// `Element.prototype.animate` before each test and inspects the fake
// `Animation` objects it hands back (currentTime, cancel calls) rather than
// depending on real WAAPI. `useCardPreviewElements` is mocked so the test
// controls `elements` identity directly (that is exactly the R1 remount this
// suite characterizes) instead of depending on the real font-settle rAF loop,
// which jsdom does not drive realistically.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Mock the element-layout hook so the test controls `elements` identity
// directly — this IS the font-settle remount scenario (R1), not a detail to
// hide behind a real settle timer.
const mockUseCardPreviewElements = vi.fn();
vi.mock('./introCardPreviewElements', () => ({
  useCardPreviewElements: (...args) => mockUseCardPreviewElements(...args),
}));

import { MotionPreview } from './MotionPreview';

const SAMPLE_CARD = {
  id: 1,
  treatment: 'gold',
  shown_fields: [],
  duration: 4.0,
  // no image_key -> TITLE_ONLY composition, no photo push-in animation.
};
const SAMPLE_PROFILE = { full_name: 'Jordan Vega' };

const ELEMENTS_A = [];
const ELEMENTS_B = []; // distinct array identity -> simulates a settle remount

let fakeAnimations;

function installAnimatePolyfill() {
  fakeAnimations = [];
  // Minimal fake WAAPI Animation: tracks currentTime assignments and cancel().
  window.Element.prototype.animate = vi.fn(function animate(keyframes, options) {
    const anim = {
      keyframes,
      options,
      _currentTime: 0,
      get currentTime() { return this._currentTime; },
      set currentTime(v) { this._currentTime = v; },
      cancel: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
    };
    fakeAnimations.push(anim);
    return anim;
  });
}

beforeEach(() => {
  installAnimatePolyfill();
  mockUseCardPreviewElements.mockReturnValue(ELEMENTS_A);
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
  delete window.Element.prototype.animate;
});

describe('MotionPreview seek characterization (T6710 — RED until Part A)', () => {
  it('accepts a currentTimeMs prop and holds pose X when seeked there', () => {
    render(
      <MotionPreview
        card={SAMPLE_CARD}
        profile={SAMPLE_PROFILE}
        aspect="9:16"
        boxWidth={270}
        boxHeight={480}
        currentTimeMs={2000}
      />,
    );

    // Target behavior: MotionPreview drives every animation's `currentTime` to
    // the prop value (a real seek), not merely relying on autoplay from 0.
    expect(fakeAnimations.length).toBeGreaterThan(0);
    for (const anim of fakeAnimations) {
      expect(anim.currentTime).toBe(2000);
    }
  });

  it('re-seeking via a currentTimeMs prop update moves the SAME animations to the new pose', () => {
    const { rerender } = render(
      <MotionPreview
        card={SAMPLE_CARD}
        profile={SAMPLE_PROFILE}
        aspect="9:16"
        boxWidth={270}
        boxHeight={480}
        currentTimeMs={500}
      />,
    );
    expect(fakeAnimations.every((a) => a.currentTime === 500)).toBe(true);

    rerender(
      <MotionPreview
        card={SAMPLE_CARD}
        profile={SAMPLE_PROFILE}
        aspect="9:16"
        boxWidth={270}
        boxHeight={480}
        currentTimeMs={3200}
      />,
    );
    expect(fakeAnimations.every((a) => a.currentTime === 3200)).toBe(true);
  });

  it('R1 guard: a font-settle-triggered remount (new elements identity) at currentTimeMs=X leaves the visual AT X, not reset to 0', () => {
    mockUseCardPreviewElements.mockReturnValue(ELEMENTS_A);
    const { rerender } = render(
      <MotionPreview
        card={SAMPLE_CARD}
        profile={SAMPLE_PROFILE}
        aspect="9:16"
        boxWidth={270}
        boxHeight={480}
        currentTimeMs={1800}
      />,
    );
    expect(fakeAnimations.every((a) => a.currentTime === 1800)).toBe(true);
    const priorAnimCount = fakeAnimations.length;

    // Simulate the font-settle remount: useCardPreviewElements now returns a
    // NEW array identity (elements content may even be identical) — this is
    // exactly introCardPreviewElements.js:277's late setState. currentTimeMs
    // prop is unchanged (no seek happened, no time has passed in this test).
    mockUseCardPreviewElements.mockReturnValue(ELEMENTS_B);
    rerender(
      <MotionPreview
        card={SAMPLE_CARD}
        profile={SAMPLE_PROFILE}
        aspect="9:16"
        boxWidth={270}
        boxHeight={480}
        currentTimeMs={1800}
      />,
    );

    // The rebuild must re-seek to the CURRENT clock (1800ms), never snap the
    // newly (re)built animations back to pose 0.
    const rebuiltAnimations = fakeAnimations.slice(priorAnimCount);
    expect(rebuiltAnimations.length).toBeGreaterThan(0);
    for (const anim of rebuiltAnimations) {
      expect(anim.currentTime).toBe(1800);
    }
  });

  it('does not auto-complete via setTimeout any more — no onDone fires from a bare mount', () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      render(
        <MotionPreview
          card={SAMPLE_CARD}
          profile={SAMPLE_PROFILE}
          aspect="9:16"
          boxWidth={270}
          boxHeight={480}
          currentTimeMs={0}
          onDone={onDone}
        />,
      );
      // durationSec=4.0 -> old code fired setTimeout(onDone, 4060). Advance well
      // past that; end-of-intro ownership has moved to the composite
      // (useIntroPlayback's onIntroEnded), so onDone must NEVER be called by
      // MotionPreview itself any more.
      vi.advanceTimersByTime(10000);
      expect(onDone).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
