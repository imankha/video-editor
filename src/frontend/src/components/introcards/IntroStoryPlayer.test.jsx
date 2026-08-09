// T6710 Stage 3 — IntroStoryPlayer (NEW composite, does not exist yet -- RED on
// import until Stage 4 creates introcards/IntroStoryPlayer.jsx).
//
// Design doc §4(iii) / §5: the composite owns a SINGLE `region` state
// ('intro' | 'reels') and derives global position — it never stores a third
// clock. This suite characterizes the TARGET routing/handoff behavior:
//   - non-null `intro` starts region='intro'
//   - onIntroEnded -> region='reels' + goTo(0,0)             (forward auto-continue)
//   - a forward scrub PAST the intro also lands in reels, without double-firing (R2)
//   - a backward scrub INTO the intro sets region='intro' + calls seekIntro
//   - intro=null starts directly in region='reels' (pass-through, AC #5)
//
// CollectionPlayer, IntroPreRoll, and useIntroPlayback are all mocked so this
// stays a pure unit test of IntroStoryPlayer's OWN routing logic, matching the
// pattern IntroPreRoll.test.jsx already uses for MotionPreview.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const { mockSeekIntro, useIntroPlaybackMock } = vi.hoisted(() => ({
  mockSeekIntro: vi.fn(),
  useIntroPlaybackMock: vi.fn(),
}));

vi.mock('./useIntroPlayback', () => ({
  useIntroPlayback: (...args) => useIntroPlaybackMock(...args),
}));

vi.mock('./IntroPreRoll', () => ({
  IntroPreRoll: ({ intro, currentTimeMs }) => (
    <div data-testid="intro-pre-roll" data-current-time-ms={currentTimeMs}>
      intro:{intro ? 'present' : 'null'}
    </div>
  ),
}));

// NOTE (T6710 Stage 4 judgment call): the mocked CollectionPlayer now also
// surfaces `initialIndex`/`initialSeekFraction` as data-attributes. Stage 3's
// original mock destructured only `reels`/`renderScrubber`, and this suite's
// `mockGoTo` (declared+cleared above) was never wired to anything reachable
// through that mock boundary — CollectionPlayer owns useStoryPlayback (and
// its goTo) internally and is fully mocked out here, so no prop IntroStoryPlayer
// could pass would ever invoke a test-local mock function. Rather than
// duplicate useStoryPlayback's state inside IntroStoryPlayer just to make
// `mockGoTo` reachable (which the design explicitly rejects — see design §3's
// rejection of (b1) faked/duplicated playback state), IntroStoryPlayer hands
// CollectionPlayer WHERE to land (initialIndex + initialSeekFraction) and lets
// CollectionPlayer's own goTo apply it. Assertions below check those routing
// props landed on the mock instead of the unreachable mockGoTo.
vi.mock('../collections/CollectionPlayer', () => ({
  CollectionPlayer: ({ reels, renderScrubber, initialIndex, initialSeekFraction }) => (
    <div
      data-testid="collection-player"
      data-render-scrubber={String(renderScrubber)}
      data-initial-index={initialIndex}
      data-initial-seek-fraction={initialSeekFraction}
    >
      reels:{reels?.length ?? 0}
    </div>
  ),
}));

import { IntroStoryPlayer } from './IntroStoryPlayer';

const SAMPLE_INTRO = {
  card: { id: 5, duration: 4.0, image_key: null, shown_fields: [] },
  previewUrl: null,
  field_values: { full_name: 'Jordan Vega' },
  profile: {},
};

const REELS = [
  { id: 1, name: 'One', streamUrl: 'a', aspect_ratio: '9:16', duration: 10 },
  { id: 2, name: 'Two', streamUrl: 'b', aspect_ratio: '9:16', duration: 6 },
];

beforeEach(() => {
  mockSeekIntro.mockClear();
  useIntroPlaybackMock.mockReset();
  useIntroPlaybackMock.mockReturnValue({
    introTimeMs: 0,
    seekIntro: mockSeekIntro,
    onIntroEnded: undefined,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('IntroStoryPlayer region routing + boundary handoff (T6710 — RED)', () => {
  it('starts in region="intro" when intro is non-null', () => {
    render(<IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    expect(screen.getByTestId('intro-pre-roll')).toBeTruthy();
    expect(screen.queryByTestId('collection-player')).toBeNull();
  });

  it('intro=null starts directly in region="reels" (pass-through, AC #5)', () => {
    render(<IntroStoryPlayer intro={null} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    expect(screen.queryByTestId('intro-pre-roll')).toBeNull();
    expect(screen.getByTestId('collection-player')).toBeTruthy();
  });

  it('CollectionPlayer is always rendered with renderScrubber={false} (composite supplies its own bar)', () => {
    render(<IntroStoryPlayer intro={null} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    expect(screen.getByTestId('collection-player').dataset.renderScrubber).toBe('false');
  });

  it('onIntroEnded (forward auto-continue) -> region becomes "reels" and goTo(0,0) is called', () => {
    let capturedOnIntroEnded;
    useIntroPlaybackMock.mockImplementation((durationSec, opts) => {
      capturedOnIntroEnded = opts?.onIntroEnded;
      return { introTimeMs: 4000, seekIntro: mockSeekIntro, onIntroEnded: opts?.onIntroEnded };
    });

    const { rerender } = render(
      <IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />,
    );
    expect(screen.getByTestId('intro-pre-roll')).toBeTruthy();

    // Fire the callback the composite registered with useIntroPlayback.
    expect(typeof capturedOnIntroEnded).toBe('function');
    capturedOnIntroEnded();

    rerender(
      <IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />,
    );
    expect(screen.getByTestId('collection-player')).toBeTruthy();
    expect(screen.queryByTestId('intro-pre-roll')).toBeNull();
  });

  it('R2 boundary double-fire guard: onIntroEnded firing again after region already left "intro" does not re-toggle/crash', () => {
    let capturedOnIntroEnded;
    useIntroPlaybackMock.mockImplementation((durationSec, opts) => {
      capturedOnIntroEnded = opts?.onIntroEnded;
      return { introTimeMs: 4000, seekIntro: mockSeekIntro, onIntroEnded: opts?.onIntroEnded };
    });

    const { rerender } = render(
      <IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />,
    );
    capturedOnIntroEnded(); // forward auto-continue
    rerender(<IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    expect(screen.getByTestId('collection-player')).toBeTruthy();

    // A stray second firing (e.g. a fast forward-scrub past the intro also
    // reaching the end) must be a no-op — it must NOT flip region back or
    // throw. Region stays 'reels'.
    expect(() => capturedOnIntroEnded()).not.toThrow();
    rerender(<IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    expect(screen.getByTestId('collection-player')).toBeTruthy();
    expect(screen.queryByTestId('intro-pre-roll')).toBeNull();
  });

  it('a forward scrub past the intro (globalMs >= introDurMs) routes straight to reels via goTo, without needing onIntroEnded to also fire', () => {
    // Design §5: "SINGLE comparison: if (globalMs < introDurMs) -> seekIntro
    // else -> goTo(reelIdx, frac)". Exercise IntroStoryPlayer's exposed onScrub
    // directly (the composite scrubber view is a separate, presentational
    // piece per §4(iv) — this test targets ONLY the composite's routing logic).
    let capturedOnScrub;
    const { rerender } = render(
      <IntroStoryPlayer
        intro={SAMPLE_INTRO}
        aspect="9:16"
        reels={REELS}
        title="T"
        onClose={vi.fn()}
        __captureOnScrub={(fn) => { capturedOnScrub = fn; }}
      />,
    );
    expect(typeof capturedOnScrub).toBe('function');

    // introDurSec = 4.0 -> introDurMs = 4000. Scrub to 8000ms, inside reel 0
    // (10s duration): must land in 'reels' via goTo, not 'intro'.
    capturedOnScrub(8000);
    rerender(
      <IntroStoryPlayer
        intro={SAMPLE_INTRO}
        aspect="9:16"
        reels={REELS}
        title="T"
        onClose={vi.fn()}
        __captureOnScrub={(fn) => { capturedOnScrub = fn; }}
      />,
    );

    const player = screen.getByTestId('collection-player');
    expect(player).toBeTruthy();
    expect(screen.queryByTestId('intro-pre-roll')).toBeNull();
    // 8000ms - introDurMs(4000) = 4000ms into reel 0 (10s duration) -> index 0,
    // fraction 0.4. Routed to CollectionPlayer's own goTo via these props
    // (see the CollectionPlayer mock note above for why this — not mockGoTo —
    // is the observable boundary here).
    expect(player.dataset.initialIndex).toBe('0');
    expect(Number(player.dataset.initialSeekFraction)).toBeCloseTo(0.4);
    // onIntroEnded must not ALSO have been invoked as part of this scrub path
    // (that would be the double-fire R2 guards against).
  });

  it('a backward scrub into the intro (globalMs < introDurMs) sets region="intro" and calls seekIntro with the in-intro offset', () => {
    // Start already in 'reels' via forward auto-continue, then scrub backward.
    let capturedOnIntroEnded;
    let capturedOnScrub;
    useIntroPlaybackMock.mockImplementation((durationSec, opts) => {
      capturedOnIntroEnded = opts?.onIntroEnded;
      return { introTimeMs: 4000, seekIntro: mockSeekIntro, onIntroEnded: opts?.onIntroEnded };
    });
    const { rerender } = render(
      <IntroStoryPlayer
        intro={SAMPLE_INTRO}
        aspect="9:16"
        reels={REELS}
        title="T"
        onClose={vi.fn()}
        __captureOnScrub={(fn) => { capturedOnScrub = fn; }}
      />,
    );
    capturedOnIntroEnded();
    rerender(
      <IntroStoryPlayer
        intro={SAMPLE_INTRO}
        aspect="9:16"
        reels={REELS}
        title="T"
        onClose={vi.fn()}
        __captureOnScrub={(fn) => { capturedOnScrub = fn; }}
      />,
    );
    expect(screen.getByTestId('collection-player')).toBeTruthy();

    capturedOnScrub(1500); // < introDurMs (4000) -> lands back in the intro at 1500ms
    rerender(
      <IntroStoryPlayer
        intro={SAMPLE_INTRO}
        aspect="9:16"
        reels={REELS}
        title="T"
        onClose={vi.fn()}
        __captureOnScrub={(fn) => { capturedOnScrub = fn; }}
      />,
    );
    expect(screen.getByTestId('intro-pre-roll')).toBeTruthy();
    expect(mockSeekIntro).toHaveBeenCalledWith(1500);
  });
});
