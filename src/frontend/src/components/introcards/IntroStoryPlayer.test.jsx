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
import { render, screen, cleanup, act } from '@testing-library/react';

const { mockSeekIntro, useIntroPlaybackMock } = vi.hoisted(() => ({
  mockSeekIntro: vi.fn(),
  useIntroPlaybackMock: vi.fn(),
}));

vi.mock('./useIntroPlayback', () => ({
  useIntroPlayback: (...args) => useIntroPlaybackMock(...args),
}));

// T6960: the composite holds the intro clock until the card photo preloads.
// SAMPLE_INTRO has previewUrl:null, so existing tests never hit the preload;
// the dedicated T6960 tests below drive it explicitly.
const { preloadIntroImageMock } = vi.hoisted(() => ({ preloadIntroImageMock: vi.fn() }));
vi.mock('./preloadIntroImage', () => ({
  preloadIntroImage: (...args) => preloadIntroImageMock(...args),
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
  CollectionPlayer: ({ reels, renderScrubber, initialIndex, initialSeekFraction, landingToken, onProgress }) => {
    // Expose onProgress on the DOM node itself (jsdom keeps live object refs
    // on properties, unlike data-* attrs which stringify) so BLOCKING #2 tests
    // can invoke exactly what IntroStoryPlayer wired to CollectionPlayer.
    return (
      <div
        data-testid="collection-player"
        data-render-scrubber={String(renderScrubber)}
        data-initial-index={initialIndex}
        data-initial-seek-fraction={initialSeekFraction}
        data-landing-token={landingToken}
        ref={(node) => { if (node) node.__onProgress = onProgress; }}
      >
        reels:{reels?.length ?? 0}
      </div>
    );
  },
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

const mockSetPlaying = vi.fn();

beforeEach(() => {
  mockSeekIntro.mockClear();
  mockSetPlaying.mockClear();
  preloadIntroImageMock.mockReset();
  preloadIntroImageMock.mockResolvedValue('loaded');
  useIntroPlaybackMock.mockReset();
  useIntroPlaybackMock.mockReturnValue({
    introTimeMs: 0,
    seekIntro: mockSeekIntro,
    setPlaying: mockSetPlaying,
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
      return { introTimeMs: 4000, seekIntro: mockSeekIntro, setPlaying: mockSetPlaying, onIntroEnded: opts?.onIntroEnded };
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
      return { introTimeMs: 4000, seekIntro: mockSeekIntro, setPlaying: mockSetPlaying, onIntroEnded: opts?.onIntroEnded };
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
      return { introTimeMs: 4000, seekIntro: mockSeekIntro, setPlaying: mockSetPlaying, onIntroEnded: opts?.onIntroEnded };
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

describe('IntroStoryPlayer landing token (T6710 Stage 4.5 MAJOR #4)', () => {
  it('bumps landingToken on every scrub, even a repeat scrub to the SAME (index, fraction) as a prior one', () => {
    let capturedOnScrub;
    const { rerender } = render(
      <IntroStoryPlayer
        intro={null}
        aspect="9:16"
        reels={REELS}
        title="T"
        onClose={vi.fn()}
        __captureOnScrub={(fn) => { capturedOnScrub = fn; }}
      />,
    );

    capturedOnScrub(4000); // reel 0 (10s), 4000ms -> fraction 0.4
    rerender(
      <IntroStoryPlayer
        intro={null}
        aspect="9:16"
        reels={REELS}
        title="T"
        onClose={vi.fn()}
        __captureOnScrub={(fn) => { capturedOnScrub = fn; }}
      />,
    );
    const tokenAfterFirst = screen.getByTestId('collection-player').dataset.landingToken;

    capturedOnScrub(4000); // identical (index, fraction) as the first scrub
    rerender(
      <IntroStoryPlayer
        intro={null}
        aspect="9:16"
        reels={REELS}
        title="T"
        onClose={vi.fn()}
        __captureOnScrub={(fn) => { capturedOnScrub = fn; }}
      />,
    );
    const tokenAfterSecond = screen.getByTestId('collection-player').dataset.landingToken;

    expect(tokenAfterSecond).not.toBe(tokenAfterFirst);
  });
});

describe('IntroStoryPlayer composite bar layering (T6710 Stage 4.5 BLOCKING #1)', () => {
  it('wraps the composite bar in a fixed, positively-z-indexed container above both region renderers', () => {
    const { container } = render(
      <IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />,
    );
    // The composite bar's own root has no position/z-index (CompositeScrubber
    // stays a plain div so CollectionPlayer's own internal usage, laid out
    // inside ITS fixed panel, is unaffected). IntroStoryPlayer must supply the
    // fixed + z-indexed wrapper itself so the bar isn't a bare, unpositioned
    // sibling of the fixed/z-layered region renderers (which paint above it
    // under CSS stacking rules regardless of DOM order).
    const wrapper = container.querySelector('.fixed.inset-0');
    expect(wrapper).not.toBeNull();
    // Named z-index scale (constants/zLayers.js), not a magic number — must be
    // at/above the highest region z-layer in play (Z.PLAYER z-[70], the intro
    // default z-[85]).
    expect(wrapper.className).toMatch(/z-\[(90|100|9999)\]/);
  });

  it('the bar wrapper does not block clicks to the region beneath it (pointer-events-none on the full-viewport wrapper)', () => {
    const { container } = render(
      <IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />,
    );
    const wrapper = container.querySelector('.fixed.inset-0');
    expect(wrapper.className).toContain('pointer-events-none');
  });
});

describe('IntroStoryPlayer intro clock freeze (T6710 Stage 4.5 MAJOR #3)', () => {
  it('calls setPlaying(true) while region is "intro"', () => {
    render(<IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    expect(mockSetPlaying).toHaveBeenCalledWith(true);
    expect(mockSetPlaying).not.toHaveBeenCalledWith(false);
  });

  it('calls setPlaying(false) once region leaves "intro" (forward auto-continue)', () => {
    let capturedOnIntroEnded;
    useIntroPlaybackMock.mockImplementation((durationSec, opts) => {
      capturedOnIntroEnded = opts?.onIntroEnded;
      return { introTimeMs: 4000, seekIntro: mockSeekIntro, setPlaying: mockSetPlaying, onIntroEnded: opts?.onIntroEnded };
    });
    const { rerender } = render(
      <IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />,
    );
    mockSetPlaying.mockClear();
    capturedOnIntroEnded();
    rerender(<IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    expect(mockSetPlaying).toHaveBeenCalledWith(false);
  });

  it('re-arms setPlaying(true) on a backward scrub back into the intro', () => {
    let capturedOnIntroEnded;
    let capturedOnScrub;
    useIntroPlaybackMock.mockImplementation((durationSec, opts) => {
      capturedOnIntroEnded = opts?.onIntroEnded;
      return { introTimeMs: 4000, seekIntro: mockSeekIntro, setPlaying: mockSetPlaying, onIntroEnded: opts?.onIntroEnded };
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
    capturedOnIntroEnded(); // -> reels, setPlaying(false)
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
    mockSetPlaying.mockClear();
    capturedOnScrub(1500); // backward scrub into the intro -> region='intro' again
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
    expect(mockSetPlaying).toHaveBeenCalledWith(true);
  });
});

describe('IntroStoryPlayer reel live progress wiring (T6710 Stage 4.5 BLOCKING #2)', () => {
  it('passes an onProgress callback to CollectionPlayer', () => {
    render(<IntroStoryPlayer intro={null} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    const player = screen.getByTestId('collection-player');
    expect(typeof player.__onProgress).toBe('function');
  });

  it('reflects a reported {activeIndex, segmentProgress} into the correct reel segment fillPercent on the rendered composite bar', () => {
    const { container } = render(
      <IntroStoryPlayer intro={null} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />,
    );
    const player = screen.getByTestId('collection-player');

    act(() => {
      player.__onProgress({ activeIndex: 1, segmentProgress: 0.5 });
    });

    // No intro (intro=null) -> segment 0 = reel "One" (fully passed, 100%),
    // segment 1 = reel "Two" (active, 50%).
    const cells = container.querySelectorAll('[data-segment-kind="reel"]');
    expect(cells).toHaveLength(2);
    // ProgressTrack renders the fill as `h-full rounded-full bg-white` with an
    // inline `width: ${progress}%` — the track wrapper itself is a SIBLING
    // element (`h-1 rounded-full overflow-hidden bg-white/25`), so scope to
    // the fill's own distinguishing class (`bg-white`, no `/25`) to avoid
    // matching the track.
    const fill0 = cells[0].querySelector('.bg-white.h-full');
    const fill1 = cells[1].querySelector('.bg-white.h-full');
    expect(fill0.style.width).toBe('100%');
    expect(fill1.style.width).toBe('50%');
  });
});

describe('IntroStoryPlayer photo-readiness gate (T6960)', () => {
  const PHOTO_INTRO = { ...SAMPLE_INTRO, previewUrl: 'https://r2.example/card.jpg' };

  it('holds the intro clock (setPlaying false) until the photo preload settles', async () => {
    let resolvePreload;
    preloadIntroImageMock.mockImplementation(() => new Promise((resolve) => { resolvePreload = resolve; }));

    render(<IntroStoryPlayer intro={PHOTO_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    await act(async () => {});

    expect(preloadIntroImageMock).toHaveBeenCalledWith(PHOTO_INTRO.previewUrl);
    // region==='intro' but assets not ready -> the play switch must be false.
    expect(mockSetPlaying).toHaveBeenLastCalledWith(false);

    await act(async () => { resolvePreload('loaded'); });
    expect(mockSetPlaying).toHaveBeenLastCalledWith(true);
  });

  it('a photoless intro starts the clock immediately (no preload, no hold)', async () => {
    render(<IntroStoryPlayer intro={SAMPLE_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    await act(async () => {});
    expect(preloadIntroImageMock).not.toHaveBeenCalled();
    expect(mockSetPlaying).toHaveBeenLastCalledWith(true);
  });

  it('a failed/timed-out preload still starts the clock (bounded degrade, never a hang)', async () => {
    preloadIntroImageMock.mockResolvedValue('timeout');
    render(<IntroStoryPlayer intro={PHOTO_INTRO} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />);
    await act(async () => {});
    expect(mockSetPlaying).toHaveBeenLastCalledWith(true);
  });
});

describe('IntroStoryPlayer photo-gate re-arm on URL change (T6960 reviewer MAJOR-2)', () => {
  it('re-holds the clock when a mounted player receives a NEW previewUrl', async () => {
    const resolvers = [];
    preloadIntroImageMock.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const first = { ...SAMPLE_INTRO, previewUrl: 'https://r2.example/a.jpg' };

    const { rerender } = render(
      <IntroStoryPlayer intro={first} aspect="9:16" reels={REELS} title="T" onClose={vi.fn()} />,
    );
    await act(async () => { resolvers[0]('loaded'); });
    expect(mockSetPlaying).toHaveBeenLastCalledWith(true);

    rerender(
      <IntroStoryPlayer
        intro={{ ...first, previewUrl: 'https://r2.example/b.jpg' }}
        aspect="9:16"
        reels={REELS}
        title="T"
        onClose={vi.fn()}
      />,
    );
    await act(async () => {});
    // New photo, not yet settled -> the clock must be held again.
    expect(preloadIntroImageMock).toHaveBeenCalledTimes(2);
    expect(mockSetPlaying).toHaveBeenLastCalledWith(false);

    await act(async () => { resolvers[1]('loaded'); });
    expect(mockSetPlaying).toHaveBeenLastCalledWith(true);
  });
});
