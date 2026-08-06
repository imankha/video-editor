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
