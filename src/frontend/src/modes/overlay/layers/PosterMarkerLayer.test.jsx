import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PosterMarkerLayer from './PosterMarkerLayer';

/**
 * T5410: the poster (cover-photo) marker must be visible without hovering,
 * reachable at coarse pointer (>=44px hit box), draggable via Pointer Events
 * (mirrors RegionLayer.touch.test.jsx), and fire drag-end EXACTLY ONCE per
 * gesture -- never more, never a reactive write.
 */

const DURATION = 10;

// jsdom implements neither Element.prototype.scrollTo (the T6870 horizontal-
// only reveal mechanism) nor scrollIntoView. The mount-reveal effect runs on
// every mount, so every test needs harmless stubs present -- the reveal
// describe block below replaces scrollTo with a vi.fn() spy to assert on it.
Element.prototype.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};

let coarse = false;
function setCoarse(value) {
  coarse = value;
  window.matchMedia = (query) => ({
    matches: query.includes('coarse') ? coarse : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

function renderMarker(overrides = {}) {
  const onDragEnd = vi.fn();
  const utils = render(
    <div className="timeline-scroll-container">
      <PosterMarkerLayer
        visualTime={4.85}
        duration={DURATION}
        visualDuration={DURATION}
        onDragEnd={onDragEnd}
        {...overrides}
      />
    </div>
  );
  const container = utils.container.querySelector('.timeline-scroll-container');
  container.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 1000, bottom: 48, width: 1000, height: 48, x: 0, y: 0,
  });
  return { onDragEnd, ...utils };
}

// clientX -> visual time given the mocked 1000px track (edgePadding=20 default).
const timeAtX = (clientX) => ((clientX - 20) / 960) * DURATION;

// T6630 round 7 item 5: reproduces the REAL DOM nesting -- an outer,
// viewport-clipped `.timeline-scroll-container` (overflow-x: auto) wrapping an
// inner full-scaled-width "relative" div (TimelineBase.jsx's "Scaled timeline
// content", the marker's actual `parentElement` and the same reference
// TextLayer.jsx/RegionLayer.jsx use). The two elements are given DIFFERENT
// widths on purpose so any test that measures against the wrong one produces a
// provably different (wrong) answer.
function renderMarkerZoomed(overrides = {}) {
  const onDragEnd = vi.fn();
  const utils = render(
    <div className="timeline-scroll-container">
      <div className="relative">
        <PosterMarkerLayer
          visualTime={4.85}
          duration={DURATION}
          visualDuration={DURATION}
          onDragEnd={onDragEnd}
          {...overrides}
        />
      </div>
    </div>
  );
  const scrollContainer = utils.container.querySelector('.timeline-scroll-container');
  const scaledContent = utils.container.querySelector('.relative');
  // Viewport-clipped: only ~30% of the scaled content is actually visible.
  scrollContainer.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 300, bottom: 48, width: 300, height: 48, x: 0, y: 0,
  });
  // Full scaled width -- what the marker's CSS `left` percentage is relative to.
  scaledContent.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 1000, bottom: 48, width: 1000, height: 48, x: 0, y: 0,
  });
  // scrollWidth/clientWidth/scrollLeft for the follow-scroll mechanism
  // (T6630 round 7 item 5 corrected) -- jsdom defaults these to 0, so the
  // scrollable geometry needs explicit mocking, same as getBoundingClientRect.
  Object.defineProperty(scrollContainer, 'scrollWidth', { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, 'clientWidth', { value: 300, configurable: true });
  scrollContainer.scrollLeft = 0;
  return { onDragEnd, scrollContainer, ...utils };
}

beforeEach(() => setCoarse(false));
afterEach(() => cleanup());

describe('PosterMarkerLayer (T5410)', () => {
  it('renders at rest, visible WITHOUT hover (no opacity-0/group-hover gating)', () => {
    renderMarker();
    const marker = screen.getByTestId('poster-marker');
    expect(marker.className).not.toMatch(/opacity-0/);
    expect(marker.className).not.toMatch(/group-hover/);
  });

  it('is keyboard-reachable: role=slider, tabIndex=0, aria-label present', () => {
    renderMarker();
    const marker = screen.getByTestId('poster-marker');
    expect(marker.getAttribute('role')).toBe('slider');
    expect(marker.getAttribute('tabindex')).toBe('0');
    expect(marker.getAttribute('aria-label')).toBeTruthy();
  });

  it('enlarges the hit target to >=44px on coarse pointers, 32px on fine', () => {
    setCoarse(true);
    const { unmount } = renderMarker();
    const coarseMarker = screen.getByTestId('poster-marker');
    expect(parseFloat(coarseMarker.style.width)).toBeGreaterThanOrEqual(44);
    unmount();

    setCoarse(false);
    renderMarker();
    const fineMarker = screen.getByTestId('poster-marker');
    expect(parseFloat(fineMarker.style.width)).toBe(32);
  });

  it('dragging the marker fires onDragEnd EXACTLY ONCE, at drag-end (not per move)', () => {
    const { onDragEnd } = renderMarker();
    const marker = screen.getByTestId('poster-marker');

    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 550, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
    expect(onDragEnd).not.toHaveBeenCalled(); // no write mid-drag

    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 620, clientY: 10 });

    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledWith(expect.closeTo(timeAtX(620), 5));
  });

  it('a pure CLICK (pointerdown+up, no movement) commits NOTHING -- the marker moves only on a drag (T6560)', () => {
    const { onDragEnd } = renderMarker();
    const marker = screen.getByTestId('poster-marker');

    // Down and up at the SAME clientX: this is a click, not a drag. Before T6560
    // it snapped the marker to pixelToVisualTime(clientX); now it must be a no-op.
    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('a release-IN-PLACE (sub-threshold jitter) commits NOTHING (T6560)', () => {
    const { onDragEnd } = renderMarker();
    const marker = screen.getByTestId('poster-marker');

    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    // Jitter within DRAG_THRESHOLD_PX (4px) and back -- not a deliberate move.
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 502, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('honours a marker time outside a hypothetical window with no clamping (renders near the start)', () => {
    renderMarker({ visualTime: 0.1 });
    const marker = screen.getByTestId('poster-marker');
    // positionPercent = (0.1 / 10) * 100 = 1% -> the /100 fraction baked into the calc is 0.01.
    expect(marker.style.left).toContain('0.01');
  });

  it('greys out and shows the inactive state when a custom image is in use', () => {
    renderMarker({ isUploaded: true });
    const marker = screen.getByTestId('poster-marker');
    // T6590: UI term is "thumbnail" (not "preview image"/"cover photo").
    expect(marker.title).toMatch(/thumbnail/i);
    expect(marker.title).toMatch(/inactive/i);
  });

  it('disabled during export: pointer-events none, arrow keys are no-ops', () => {
    const { onDragEnd } = renderMarker({ disabled: true });
    const marker = screen.getByTestId('poster-marker');
    fireEvent.keyDown(marker, { key: 'ArrowRight' });
    expect(onDragEnd).not.toHaveBeenCalled();
  });
});

describe('PosterMarkerLayer — reveal scrolls the timeline HORIZONTALLY, never the page (T6870)', () => {
  /* ROOT CAUSE of "Overlay always opens scrolled" (T6870): the reveal used
   * `trackRef.current.scrollIntoView({ block: 'nearest', inline: 'center' })`.
   * `scrollIntoView` walks EVERY scrollable ancestor -- `inline: 'center'`
   * did the wanted horizontal centering, but `block: 'nearest'` ALSO scrolled
   * the page/main container VERTICALLY down to the timeline whenever it sat
   * below the fold at mount. Since the effect fires on mount, again at the
   * 900ms retry, and on every visualTime change until first interaction, the
   * page was yanked down on entry every time (and fought a user scrolling
   * back up). Fix: center the marker by setting the ONE horizontal scroll
   * container's scrollLeft (via scrollTo({ left })) -- one axis, one element,
   * no page movement by construction.
   *
   * WHY THE HORIZONTAL REVEAL IS STILL NEEDED (unchanged from T6630): the
   * marker's DEFAULT position can land past the right edge of the
   * horizontally-scrollable timeline once the pre-existing auto-zoom
   * (OverlayScreen.jsx, up to 500%) widens the content past the viewport
   * while scrollLeft starts at 0 -- so it must still be scrolled into view,
   * just horizontally-only.
   *
   * The reveal fixture gives the scroll container real scrollWidth (1000) >
   * clientWidth (300) so there is something to scroll; jsdom defaults both to
   * 0 (maxScroll <= 0 -> reveal is a no-op, "content fits" -- nothing to do).
   */
  function renderRevealMarker(overrides = {}) {
    const onDragEnd = vi.fn();
    const utils = render(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer
          visualTime={4.85}
          duration={DURATION}
          visualDuration={DURATION}
          onDragEnd={onDragEnd}
          {...overrides}
        />
      </div>
    );
    const scrollContainer = utils.container.querySelector('.timeline-scroll-container');
    return { onDragEnd, scrollContainer, ...utils };
  }

  // Centered scrollLeft target for a given visualTime, mirroring the
  // component: markerPx = edgePadding + (scrollWidth - 2*edgePadding)*percent,
  // target = clamp(markerPx - clientWidth/2, 0, scrollWidth - clientWidth).
  // (scrollWidth=1000, clientWidth=300, edgePadding=20 in this fixture.)
  const revealTargetFor = (visualTime) => {
    const percent = Math.max(0, Math.min(100, (visualTime / DURATION) * 100)) / 100;
    const markerPx = 20 + (1000 - 40) * percent;
    return Math.max(0, Math.min(markerPx - 150, 700));
  };

  const origScrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
  const origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
    // A spy on the OLD mechanism so we can pin the regression: the reveal must
    // NEVER call scrollIntoView again (that is what scrolled the page).
    Element.prototype.scrollIntoView = vi.fn();
    // jsdom does no layout, so scrollWidth/clientWidth default to 0 -- which
    // would make the reveal (guarded on maxScroll > 0) a no-op. Report a real
    // 1000px content / 300px viewport for the timeline container BEFORE mount
    // (keyed by class, so only it is affected), so the mount-reveal effect
    // sees something to scroll the moment it runs.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() { return this.classList?.contains('timeline-scroll-container') ? 1000 : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() { return this.classList?.contains('timeline-scroll-container') ? 300 : 0; },
    });
  });

  afterEach(() => {
    if (origScrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', origScrollWidth);
    else delete HTMLElement.prototype.scrollWidth;
    if (origClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClientWidth);
    else delete HTMLElement.prototype.clientWidth;
  });

  it('centers the marker by scrolling ONLY the horizontal container -- never scrollIntoView/the page (T6870)', () => {
    const { scrollContainer } = renderRevealMarker({ revealOnActive: false });
    expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);
    const arg = scrollContainer.scrollTo.mock.calls[0][0];
    // Horizontal only: a `left` is passed, `top` is NOT -- so the page/vertical
    // scroll offset is left untouched by construction.
    expect(arg.top).toBeUndefined();
    expect(arg.behavior).toBe('smooth');
    expect(arg.left).toBeCloseTo(revealTargetFor(4.85), 1);
    // The banned page-scrolling call is gone for good.
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls into view once on mount even when revealOnActive is false (visible on the initial screen)', () => {
    const { scrollContainer } = renderRevealMarker({ revealOnActive: false });
    expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollContainer.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.closeTo(revealTargetFor(4.85), 1), behavior: 'smooth' })
    );
  });

  it('scrolls itself into view when revealOnActive is true', () => {
    const { scrollContainer } = renderRevealMarker({ revealOnActive: true });
    expect(scrollContainer.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.closeTo(revealTargetFor(4.85), 1) })
    );
  });

  it('scrolls AGAIN when revealOnActive transitions from false to true post-mount (opening the Thumbnail tab later)', () => {
    const { rerender, scrollContainer } = renderRevealMarker({ revealOnActive: false });
    // The initial mount already revealed once -- clear that call so this
    // assertion isolates the LATER, tab-open-triggered reveal.
    expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);
    scrollContainer.scrollTo.mockClear();

    rerender(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer
          visualTime={4.85}
          duration={DURATION}
          visualDuration={DURATION}
          revealOnActive
        />
      </div>
    );
    expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('still reveals once the real DOM node mounts, even if the FIRST render had no duration yet (metadata still loading)', () => {
    // This component returns null while `timelineDuration <= 0` -- on a fresh
    // page load, metadata can arrive a render or two AFTER first mount. The
    // reveal must fire when the marker actually renders, not latch a no-op on
    // the first null-returning render (trackRef.current still null then).
    const onDragEnd = vi.fn();
    const { rerender, container } = render(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer visualTime={0} duration={0} visualDuration={0} onDragEnd={onDragEnd} />
      </div>
    );
    const scrollContainer = container.querySelector('.timeline-scroll-container');
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 300, configurable: true });
    scrollContainer.scrollLeft = 0;
    // No marker DOM yet -- the component returned null.
    expect(container.querySelector('[data-testid="poster-marker"]')).toBeNull();
    expect(scrollContainer.scrollTo).not.toHaveBeenCalled();

    // Metadata arrives -- a REAL duration on a later render.
    rerender(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer visualTime={4.85} duration={DURATION} visualDuration={DURATION} onDragEnd={onDragEnd} />
      </div>
    );
    expect(screen.getByTestId('poster-marker')).toBeTruthy();
    expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('re-reveals when visualTime settles to a LATER value after mount, before any interaction', () => {
    // `posterSlowmoSection` can arrive in a LATER render than `duration`, so
    // the marker's computed visualTime can jump AFTER the initial reveal --
    // the effect depends on visualTime so it re-centers on the new value.
    const { rerender, scrollContainer } = renderRevealMarker({ visualTime: 2.0 });
    expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollContainer.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: expect.closeTo(revealTargetFor(2.0), 1) })
    );

    rerender(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer visualTime={9.0} duration={DURATION} visualDuration={DURATION} />
      </div>
    );
    expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(2);
    // Re-centered on the NEW time (9.0 -> clamped to maxScroll 700).
    expect(scrollContainer.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ left: expect.closeTo(revealTargetFor(9.0), 1) })
    );
  });

  it('stops auto-following visualTime once the user has interacted with the marker', () => {
    const { onDragEnd, rerender, scrollContainer } = renderRevealMarker({ visualTime: 2.0 });
    expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);

    const marker = screen.getByTestId('poster-marker');
    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    scrollContainer.scrollTo.mockClear();

    // A later visualTime change (e.g. the parent re-rendering with the user's
    // own just-committed value) must NOT trigger another auto-reveal on this
    // SAME instance -- the user has already engaged with the marker directly.
    rerender(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer visualTime={9.0} duration={DURATION} visualDuration={DURATION} onDragEnd={onDragEnd} />
      </div>
    );
    expect(scrollContainer.scrollTo).not.toHaveBeenCalled();
  });

  it('schedules ONE bounded follow-up reveal (~900ms) to catch the timeline\'s own auto-zoom settling after the initial reveal', () => {
    // This component has no visibility into the timeline's own auto-zoom
    // (a separate async load) which can widen the content AFTER this reveal
    // already centered the marker -- so it re-checks once, 900ms later.
    vi.useFakeTimers();
    try {
      const { scrollContainer } = renderRevealMarker({ visualTime: 2.0 });
      expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(899);
      expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2);
      expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the bounded follow-up reveal does NOT fire once the user has interacted before it elapses', () => {
    vi.useFakeTimers();
    try {
      const { onDragEnd, scrollContainer } = renderRevealMarker({ visualTime: 2.0 });
      expect(scrollContainer.scrollTo).toHaveBeenCalledTimes(1);

      const marker = screen.getByTestId('poster-marker');
      fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
      expect(onDragEnd).toHaveBeenCalledTimes(1);
      scrollContainer.scrollTo.mockClear();

      vi.advanceTimersByTime(1000);
      expect(scrollContainer.scrollTo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a no-op when the timeline content fits the viewport (scrollWidth == clientWidth -> maxScroll <= 0, nothing to scroll)', () => {
    // Content that fits: scrollWidth == clientWidth, so maxScroll <= 0 -- the
    // "content fits, marker already visible" branch. The reveal must touch no
    // scroll position at all (and certainly never the page). Override the
    // describe-wide geometry so the container reports a fitting viewport.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get() { return this.classList?.contains('timeline-scroll-container') ? 300 : 0; },
    });
    render(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer visualTime={4.85} duration={DURATION} visualDuration={DURATION} onDragEnd={vi.fn()} />
      </div>
    );
    expect(Element.prototype.scrollTo).not.toHaveBeenCalled();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('PosterMarkerLayer -- drag measures against the full-scaled parent, not the clipped scroll container (T6630 round 7 item 5)', () => {
  /* ROOT CAUSE (live-debugged via a real browser drag, T6630 round 7): the
   * marker's CSS `left` is a percentage of its DIRECT PARENT's full width
   * (the timeline's scaled content div -- 1000px in this fixture). The drag
   * handler used to measure pointer position against `.closest('.timeline-
   * scroll-container')` instead -- the OUTER, viewport-clipped box (300px in
   * this fixture). Two different reference widths for drag-input vs
   * render-output meant every drag overshot by (fullWidth/clippedWidth)x; a
   * real 400px drag measured a 412px rendered drift and pushed the marker
   * off the visible scrolled area ("the marker just disappears"). Fixed by
   * measuring against `trackRef.current.parentElement` -- the SAME element
   * the render math (and TextLayer.jsx/RegionLayer.jsx) already use. */
  it('commits a drag using the full-scaled parent width, not the clipped scroll container width', () => {
    const { onDragEnd } = renderMarkerZoomed();
    const marker = screen.getByTestId('poster-marker');

    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });

    // Against the 1000px full-scaled parent (correct): ((600-20)/960)*10 ~= 6.04s.
    // Against the 300px clipped scroll container (the bug): would clamp to
    // usableWidth (260px), i.e. the timeline's END (10s) -- a very different,
    // provably wrong answer this assertion rules out.
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledWith(expect.closeTo(((600 - 20) / 960) * DURATION, 5));
  });
});

describe('PosterMarkerLayer -- dragging auto-scrolls the timeline to follow the marker, like the playhead (T6630 round 7 item 5 corrected)', () => {
  /* User correction after the original round 7 item 5 fix: "the marker
   * should move just like the playhead." TimelineBase.jsx already has a
   * shared, reusable follow-scroll mechanism for the playhead
   * (`computeFollowScrollTarget`) that keeps it within a margin of the
   * visible viewport. The marker had no equivalent -- reusing the SAME
   * function (not reimplementing the math) means dragging the marker near
   * an edge auto-scrolls the timeline to keep it visible, exactly like the
   * playhead's own follow-scroll. */
  it('scrolls the container to follow the marker when dragged near the right edge', () => {
    const { scrollContainer } = renderMarkerZoomed({ visualTime: 0 });
    const marker = screen.getByTestId('poster-marker');
    expect(scrollContainer.scrollLeft).toBe(0);

    // clientX=280 -> pixelToVisualTime against the 1000px full-scaled
    // parent: ((280-20)/960)*10 ~= 2.7s -> ~29% progress, near the right
    // edge of the 300px-visible/1000px-total viewport (scrollLeft still 0).
    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 750, clientY: 10 });

    expect(scrollContainer.scrollLeft, 'auto-scrolled to keep the dragged-to position in view').toBeGreaterThan(0);
  });

  it('does NOT scroll when the drag stays comfortably within the visible margin', () => {
    const { scrollContainer } = renderMarkerZoomed({ visualTime: 0 });
    const marker = screen.getByTestId('poster-marker');

    // A small move that stays within the container's own 300px width and
    // clear of computeFollowScrollTarget's 15%-of-clientWidth edge margin.
    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 150, clientY: 10 });

    expect(scrollContainer.scrollLeft).toBe(0);
  });
});
