import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FootageReorderList } from './FootageReorderList';

// T8820 — the vertical drag-reorder editor. Drag uses Pointer Events (mouse+touch
// via one path) exactly like the timeline trim levers; this jsdom spec exercises
// the pointerdown -> window pointermove -> onReorder wiring. jsdom returns zero
// layout, so we pin deterministic row rects (40px tall, stacked) the same way
// RegionLayer.touch.test.jsx pins the track rect.

function item(name, duration = 600) {
  return { name, size: 1024, duration, creationTime: null, file: new File(['x'], name) };
}
const ORDER = [item('A.mp4'), item('B.mp4'), item('C.mp4')];

function renderList(overrides = {}) {
  const onReorder = vi.fn();
  const onRemove = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <FootageReorderList order={ORDER} confidence="time" onReorder={onReorder} onRemove={onRemove} onClose={onClose} {...overrides} />
  );
  // Pin stacked 40px rows: A [0,40), B [40,80), C [80,120).
  const rows = screen.getAllByTestId('footage-reorder-row');
  rows.forEach((row, i) => {
    row.getBoundingClientRect = () => ({
      left: 0, right: 300, top: i * 40, bottom: i * 40 + 40, width: 300, height: 40, x: 0, y: i * 40,
    });
  });
  return { onReorder, onRemove, onClose, rows, ...utils };
}

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

describe('FootageReorderList', () => {
  it('renders the header, helper text and a row per item', () => {
    renderList();
    expect(screen.getByText('Fix the order')).toBeTruthy();
    expect(screen.getByText('Drag to match how the game was played')).toBeTruthy();
    expect(screen.getAllByTestId('footage-reorder-row')).toHaveLength(3);
  });

  it('drag handles carry touch-none so the browser does not hijack the gesture', () => {
    renderList();
    expect(screen.getByTestId('footage-reorder-handle-0').className).toContain('touch-none');
  });

  it('dragging row A down past B updates the sequence via onReorder (manual flip)', () => {
    const { onReorder } = renderList();
    const handle = screen.getByTestId('footage-reorder-handle-0');

    fireEvent.pointerDown(handle, { pointerId: 1, pointerType: 'touch', clientY: 20 });
    // Move to y=90: above C's midpoint (100), below B's (60) -> A inserts before C.
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientY: 90 });

    expect(onReorder).toHaveBeenCalled();
    expect(onReorder.mock.calls.at(-1)[0]).toEqual(['B.mp4', 'A.mp4', 'C.mp4']);

    // pointerup ends the drag: later moves are ignored.
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: 'touch', clientY: 90 });
    onReorder.mockClear();
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: 'touch', clientY: 10 });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('ignores a second finger (different pointerId) mid-drag', () => {
    const { onReorder } = renderList();
    fireEvent.pointerDown(screen.getByTestId('footage-reorder-handle-0'), { pointerId: 1, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 9, clientY: 90 });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('the row X always calls onRemove', () => {
    const { onRemove } = renderList();
    fireEvent.click(screen.getByLabelText('Remove B.mp4'));
    expect(onRemove).toHaveBeenCalledWith('B.mp4');
  });

  it('Done calls onClose', () => {
    const { onClose } = renderList();
    fireEvent.click(screen.getByTestId('footage-reorder-done'));
    expect(onClose).toHaveBeenCalled();
  });
});
