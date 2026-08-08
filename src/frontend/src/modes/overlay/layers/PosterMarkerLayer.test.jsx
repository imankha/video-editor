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

// jsdom does not implement scrollIntoView. The round 7 item 6 mount-reveal
// effect calls it unconditionally on every mount, so every test needs a
// stub present -- individual describe blocks below may replace this with a
// vi.fn() spy when they need to assert on call counts.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});

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

describe('PosterMarkerLayer — revealOnActive scrolls itself into view (T6630 round 6 item 4 + round 7 item 6)', () => {
  /* ROOT CAUSE (live-debugged via a real browser, T6630 round 6): the marker
   * was never a rendering/z-index bug -- it renders correctly (visible,
   * opacity 1, z-40, valid coordinates) but its DEFAULT position can land
   * past the right edge of the horizontally-scrollable timeline once the
   * PRE-EXISTING auto-zoom (OverlayScreen.jsx, driven by detection-marker
   * spacing, up to 500% -- unrelated to text lanes) widens the scrollable
   * content far past the viewport, while the scroll container starts at
   * scrollLeft: 0. document.elementFromPoint at the marker's own bounding-box
   * center returned null in the real browser -- off-screen, not occluded.
   *
   * Round 7 item 6 extended this: the SAME off-screen-default problem can
   * happen on the very FIRST render too (the Overlay tab, not Thumbnail, is
   * the default active tab -- OverlayModeView.jsx's `activeTab` useState --
   * so `revealOnActive` starts false and the round-6 fix alone never fires).
   * Revealing once, unconditionally, on mount is safe specifically because
   * there is no prior user scroll position to disturb before the user has
   * looked at anything -- unlike a reveal on every mount of a tab the user
   * is actively using, which WOULD fight their own scrolling.
   */
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('scrolls into view once on mount even when revealOnActive is false (T6630 round 7 item 6 -- visible on the initial screen)', () => {
    renderMarker({ revealOnActive: false });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ inline: 'center' })
    );
  });

  it('scrolls itself into view when revealOnActive is true', () => {
    renderMarker({ revealOnActive: true });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ inline: 'center' })
    );
  });

  it('scrolls AGAIN when revealOnActive transitions from false to true post-mount (opening the Thumbnail tab later)', () => {
    const { rerender } = renderMarker({ revealOnActive: false });
    // The initial mount already revealed once (round 7 item 6) -- clear that
    // call so this assertion isolates the LATER, tab-open-triggered reveal.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    Element.prototype.scrollIntoView.mockClear();

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
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('T6630 round 7 item 6 bug fix: still reveals once the real DOM node mounts, even if the FIRST render had no duration yet (metadata still loading)', () => {
    // Live-debugged: this component returns null while `timelineDuration <=
    // 0` -- on a genuinely fresh page load, metadata can arrive a render or
    // two AFTER this component first mounts. The mount-reveal effect used to
    // run (and permanently latch its one-shot guard) on that FIRST, null-
    // returning render, when `trackRef.current` was still null -- silently
    // no-opping forever, even once the marker actually rendered later.
    const onDragEnd = vi.fn();
    const { rerender, container } = render(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer visualTime={0} duration={0} visualDuration={0} onDragEnd={onDragEnd} />
      </div>
    );
    // No marker DOM yet -- the component returned null.
    expect(container.querySelector('[data-testid="poster-marker"]')).toBeNull();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    // Metadata arrives -- a REAL duration on a later render.
    rerender(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer visualTime={4.85} duration={DURATION} visualDuration={DURATION} onDragEnd={onDragEnd} />
      </div>
    );
    expect(screen.getByTestId('poster-marker')).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('T6630 round 7 item 6 bug fix: re-reveals when visualTime settles to a LATER value after mount, before any interaction', () => {
    // Live-debugged: the item 6 correction changed the no-marker default
    // from the window's midpoint to 2s into the window -- a value far more
    // sensitive to WHICH window is used. `posterSlowmoSection` can arrive in
    // a LATER render than `duration` (async data), so the marker's computed
    // visualTime can jump (e.g. "2s against a placeholder no-slowmo window"
    // -> "slowmoStart+2s once real section data lands") AFTER the initial
    // reveal already fired -- stranding the marker off-screen again with no
    // second chance, since the old effect only depended on
    // [revealOnActive, timelineDuration], not visualTime itself.
    const { rerender } = renderMarker({ visualTime: 2.0 });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer visualTime={9.0} duration={DURATION} visualDuration={DURATION} />
      </div>
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('T6630 round 7 item 6: stops auto-following visualTime once the user has interacted with the marker', () => {
    const { onDragEnd, rerender } = renderMarker({ visualTime: 2.0 });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    const marker = screen.getByTestId('poster-marker');
    fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    Element.prototype.scrollIntoView.mockClear();

    // A later visualTime change (e.g. the parent re-rendering with the
    // user's own just-committed value) must NOT trigger another auto-reveal
    // on this SAME instance -- the user has already engaged with the marker
    // directly, so further auto-follow would fight their own choice.
    rerender(
      <div className="timeline-scroll-container">
        <PosterMarkerLayer visualTime={9.0} duration={DURATION} visualDuration={DURATION} onDragEnd={onDragEnd} />
      </div>
    );
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('T6630 round 7 item 6: schedules ONE bounded follow-up reveal (~900ms) to catch the timeline\'s own auto-zoom settling after the initial reveal', () => {
    // Live-verified: this component has no visibility into the timeline's
    // own auto-zoom (driven by DETECTION marker spacing, a separate async
    // load), which can widen the scrollable content AFTER this reveal
    // already centered the marker -- pushing it back out of view with
    // nothing in this component's own props changing to react to it.
    vi.useFakeTimers();
    try {
      renderMarker({ visualTime: 2.0 });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(899);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('T6630 round 7 item 6: the bounded follow-up reveal does NOT fire once the user has interacted before it elapses', () => {
    vi.useFakeTimers();
    try {
      const { onDragEnd } = renderMarker({ visualTime: 2.0 });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

      const marker = screen.getByTestId('poster-marker');
      fireEvent.pointerDown(marker, { pointerId: 1, pointerType: 'mouse', clientX: 500, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
      fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'mouse', clientX: 600, clientY: 10 });
      expect(onDragEnd).toHaveBeenCalledTimes(1);
      Element.prototype.scrollIntoView.mockClear();

      vi.advanceTimersByTime(1000);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
