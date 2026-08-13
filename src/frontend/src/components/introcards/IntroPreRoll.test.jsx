// T5220 — IntroPreRoll: the DOM pre-roll wrapper around MotionPreview shown
// before playback on the 3 React public surfaces (SharedVideoOverlay,
// SharedCollectionView), mirroring BrandedEndCard's mount-gated pattern in
// reverse (design §5, §9).
//
// T6710: MotionPreview stopped self-completing via setTimeout(onDone) -- it
// is now purely currentTimeMs-driven/seekable, and end-of-intro ownership
// moved to the composite (useIntroPlayback's onIntroEnded, owner in-app path
// only). IntroPreRoll's OTHER two callers (SharedVideoOverlay,
// SharedCollectionView, out of this task's scope) still call it the old way
// -- no currentTimeMs, relying on `onDone` firing once. IntroPreRoll now owns
// a small internal fallback clock for exactly that case (see IntroPreRoll.jsx
// useFallbackClock) so those two files needed zero changes. MotionPreview is
// mocked here so this stays a pure unit test of IntroPreRoll's own
// gating/currentTimeMs-threading/fallback-onDone logic, not the render engine.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('./MotionPreview', () => ({
  MotionPreview: vi.fn(({ currentTimeMs }) => (
    <div data-testid="mock-motion-preview" data-current-time-ms={currentTimeMs}>
      mock motion preview
    </div>
  )),
}));

// T6960: the self-driven clock is gated on the photo preload settling. Default
// mock resolves immediately (tests flush with an async act()); individual
// tests swap in a deferred promise to pin the gate itself.
const { preloadIntroImageMock } = vi.hoisted(() => ({ preloadIntroImageMock: vi.fn() }));
vi.mock('./preloadIntroImage', () => ({
  preloadIntroImage: (...args) => preloadIntroImageMock(...args),
}));

import { IntroPreRoll } from './IntroPreRoll';
import { MotionPreview } from './MotionPreview';

beforeEach(() => {
  preloadIntroImageMock.mockReset();
  preloadIntroImageMock.mockResolvedValue('loaded');
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

const SAMPLE_INTRO = {
  card: { id: 5, image_key: 'k.png', treatment: 'gold', shown_fields: ['position'], text_elements: {} },
  previewUrl: 'https://r2.example/card.jpg',
  field_values: { full_name: 'Jordan Vega', position: 'Point Guard' },
  profile: { focal_x: 0.5, focal_y: 0.3, zoom: 1.1 },
};

describe('IntroPreRoll', () => {
  it('renders nothing when intro is null', () => {
    const { container } = render(<IntroPreRoll intro={null} onDone={() => {}} />);
    expect(container.firstChild).toBeNull();
    expect(MotionPreview).not.toHaveBeenCalled();
  });

  it('renders nothing when intro is undefined', () => {
    const { container } = render(<IntroPreRoll onDone={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts MotionPreview when intro is present', async () => {
    render(<IntroPreRoll intro={SAMPLE_INTRO} onDone={() => {}} />);
    expect(screen.getByTestId('mock-motion-preview')).toBeTruthy();
    expect(MotionPreview).toHaveBeenCalledTimes(1);
    await act(async () => {}); // flush the T6960 preload resolution
  });

  it('calls onDone once its own fallback clock reaches the card duration (legacy no-currentTimeMs callers)', async () => {
    // SAMPLE_INTRO has no `duration` -> IntroPreRoll's fallback default of
    // 4.0s applies (mirrors MotionPreview's own `card?.duration || 4.0`).
    let rafCb = null;
    let nowMs = 0;
    const realRaf = global.requestAnimationFrame;
    const realCancel = global.cancelAnimationFrame;
    const realNow = global.performance.now;
    global.requestAnimationFrame = vi.fn((cb) => { rafCb = cb; return 1; });
    global.cancelAnimationFrame = vi.fn();
    global.performance.now = () => nowMs;
    try {
      const onDone = vi.fn();
      render(<IntroPreRoll intro={SAMPLE_INTRO} onDone={onDone} />);
      // T6960: flush the (immediately-resolving) photo preload so the gated
      // clock arms.
      await act(async () => {});
      expect(onDone).not.toHaveBeenCalled();

      const tick = (ms) => {
        nowMs += ms;
        const cb = rafCb;
        rafCb = null;
        act(() => { cb && cb(nowMs); });
      };

      tick(2000);
      expect(onDone).not.toHaveBeenCalled();
      tick(2001); // crosses the 4000ms fallback duration
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      global.requestAnimationFrame = realRaf;
      global.cancelAnimationFrame = realCancel;
      global.performance.now = realNow;
    }
  });

  it('T6960: holds the fallback clock until the photo preload settles, then plays', async () => {
    let resolvePreload;
    preloadIntroImageMock.mockImplementation(() => new Promise((resolve) => { resolvePreload = resolve; }));

    let rafCb = null;
    let nowMs = 0;
    const realRaf = global.requestAnimationFrame;
    const realCancel = global.cancelAnimationFrame;
    const realNow = global.performance.now;
    global.requestAnimationFrame = vi.fn((cb) => { rafCb = cb; return 1; });
    global.cancelAnimationFrame = vi.fn();
    global.performance.now = () => nowMs;
    try {
      const onDone = vi.fn();
      render(<IntroPreRoll intro={SAMPLE_INTRO} onDone={onDone} />);
      await act(async () => {});

      // Gate closed: the autoplay clock never armed — no rAF scheduled, the
      // card holds t=0 for however long the (bounded) preload takes.
      expect(preloadIntroImageMock).toHaveBeenCalledWith(SAMPLE_INTRO.previewUrl);
      expect(rafCb).toBeNull();
      expect(onDone).not.toHaveBeenCalled();

      // Preload settles -> clock arms and runs to completion as before.
      await act(async () => { resolvePreload('loaded'); });
      expect(rafCb).not.toBeNull();
      nowMs += 4001;
      const cb = rafCb;
      act(() => { cb(nowMs); });
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      global.requestAnimationFrame = realRaf;
      global.cancelAnimationFrame = realCancel;
      global.performance.now = realNow;
    }
  });

  it('T6960: the externally-driven path never triggers a preload here (IntroStoryPlayer owns its own gate)', async () => {
    render(<IntroPreRoll intro={SAMPLE_INTRO} currentTimeMs={0} />);
    await act(async () => {});
    expect(preloadIntroImageMock).not.toHaveBeenCalled();
  });

  it('T6960: a photoless intro never waits on a preload', async () => {
    const noPhoto = { ...SAMPLE_INTRO, previewUrl: null };
    let rafCb = null;
    const realRaf = global.requestAnimationFrame;
    const realCancel = global.cancelAnimationFrame;
    global.requestAnimationFrame = vi.fn((cb) => { rafCb = cb; return 1; });
    global.cancelAnimationFrame = vi.fn();
    try {
      render(<IntroPreRoll intro={noPhoto} onDone={() => {}} />);
      expect(preloadIntroImageMock).not.toHaveBeenCalled();
      expect(rafCb).not.toBeNull(); // clock armed immediately
    } finally {
      global.requestAnimationFrame = realRaf;
      global.cancelAnimationFrame = realCancel;
    }
  });

  it('threads an externally-driven currentTimeMs straight through and never runs its own fallback clock (owner in-app path)', () => {
    render(<IntroPreRoll intro={SAMPLE_INTRO} currentTimeMs={1234} />);
    expect(screen.getByTestId('mock-motion-preview').dataset.currentTimeMs).toBe('1234');
  });

  it('reassembles the split payload into the card/profile shape MotionPreview reads facts/photo from', async () => {
    // MotionPreview reads the photo off `card.previewUrl` (not a sibling prop)
    // and the facts off `profile.full_name`/`profile[shownField]` (not
    // `field_values`) -- see introCardPreviewElements.js. The backend payload
    // splits those into separate keys, so the wrapper must merge them back or
    // the pre-roll silently renders with no photo and no name/facts.
    render(<IntroPreRoll intro={SAMPLE_INTRO} onDone={() => {}} />);
    const call = MotionPreview.mock.calls[0][0];
    expect(call.card).toEqual({ ...SAMPLE_INTRO.card, previewUrl: SAMPLE_INTRO.previewUrl });
    expect(call.profile).toEqual({ ...SAMPLE_INTRO.profile, ...SAMPLE_INTRO.field_values });
    await act(async () => {}); // flush the T6960 preload resolution
  });
});
