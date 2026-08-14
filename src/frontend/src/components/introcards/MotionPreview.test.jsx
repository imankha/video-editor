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
import { render, cleanup, fireEvent } from '@testing-library/react';

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

  // T7030 — the intro photo blanks (first play AND scrub-back) because the
  // visible <img> always loads from the cache preloadIntroImage warmed, so it is
  // `complete` at attach time and the `load` event never re-fires to the reveal
  // gate. These pin that a cache-complete image reveals WITHOUT a load event,
  // that a scrub-forward-then-backward remount against the same warmed cache
  // still reveals, and that a genuinely broken image stays skeleton.
  const PHOTO_CARD = {
    ...SAMPLE_CARD,
    image_key: 'user/1/intro/photo.png',
    previewUrl: 'https://r2.example/intro/photo.png?sig=abc',
  };

  // Simulate the browser's HTMLImageElement completeness for a src jsdom never
  // actually fetches. Overrides the prototype getters so the ref callback /
  // effect read our controlled cache state; restored in afterEach.
  let imgPropOverrides = [];
  function stubImageState({ complete, naturalWidth }) {
    for (const [prop, value] of [['complete', complete], ['naturalWidth', naturalWidth]]) {
      const original = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, prop);
      imgPropOverrides.push([prop, original]);
      Object.defineProperty(window.HTMLImageElement.prototype, prop, {
        configurable: true,
        get() { return value; },
      });
    }
  }
  afterEach(() => {
    for (const [prop, original] of imgPropOverrides) {
      if (original) Object.defineProperty(window.HTMLImageElement.prototype, prop, original);
      else delete window.HTMLImageElement.prototype[prop];
    }
    imgPropOverrides = [];
  });

  const skeletonOf = (c) => c.querySelector('[data-testid="motion-preview-photo-skeleton"]');
  const renderPhotoCard = () => render(
    <MotionPreview
      card={PHOTO_CARD}
      profile={SAMPLE_PROFILE}
      aspect="9:16"
      boxWidth={270}
      boxHeight={480}
      currentTimeMs={0}
    />,
  );

  it('T7030: a cache-complete photo reveals WITHOUT a load event (first play)', () => {
    // Cache hit: complete + paintable at attach time, and no `load` ever fires.
    stubImageState({ complete: true, naturalWidth: 800 });
    const { container } = renderPhotoCard();

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // Revealed off the ref/effect completeness check alone — no fireEvent.load.
    expect(img.className).toContain('opacity-100');
    expect(img.className).not.toContain('opacity-0');
    expect(skeletonOf(container)).toBeNull();
  });

  it('T7030: scrub forward past the intro then back into it re-reveals the cached photo on remount', () => {
    stubImageState({ complete: true, naturalWidth: 800 });

    // Scrub-back remounts IntroPreRoll -> MotionPreview fresh (region ternary).
    // First mount (intro playing), then unmount (region -> reels)...
    const first = renderPhotoCard();
    expect(first.container.querySelector('img').className).toContain('opacity-100');
    cleanup();

    // ...then a fresh mount against the SAME warmed cache (scrub back into intro),
    // again with no new load event. Must not be left blank.
    const { container } = renderPhotoCard();
    const img = container.querySelector('img');
    expect(img.className).toContain('opacity-100');
    expect(skeletonOf(container)).toBeNull();
  });

  it('T7030: a not-yet-loaded photo stays skeleton until its load event, then reveals', () => {
    stubImageState({ complete: false, naturalWidth: 0 });
    const { container } = renderPhotoCard();

    const img = container.querySelector('img');
    expect(img.className).toContain('opacity-0');
    expect(skeletonOf(container)).not.toBeNull();

    fireEvent.load(img);
    expect(img.className).toContain('opacity-100');
    expect(skeletonOf(container)).toBeNull();
  });

  it('T7030: a broken photo (complete but 0-width) stays skeleton, never falsely revealed', () => {
    stubImageState({ complete: true, naturalWidth: 0 });
    const { container } = renderPhotoCard();

    const img = container.querySelector('img');
    expect(img.className).toContain('opacity-0');
    expect(skeletonOf(container)).not.toBeNull();
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
