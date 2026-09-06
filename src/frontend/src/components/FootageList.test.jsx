import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FootageList } from './FootageList';
import { formatClockTime, humanizeMinutes } from '../utils/footageDisplay';

// T8822 — FootageList merges T8820's FootageStrip (evidence/trust/gap/junk display)
// and FootageReorderList (always-draggable rows) into one component, plus a new
// light-touch overlap badge. Fixtures mirror T8800's three real cases (DJI
// time-chain, Legends name-fallback, unknown/please-check) plus the synthetic >3hr
// "two games?" gap, a probeError row, and two overlapping DJI-style segments.

function item(name, { duration = 60, creationTime = null, probeError = false } = {}) {
  return { name, size: 1024, duration, creationTime, file: new File(['x'], name), probeError };
}

const DJI_BASE = new Date('2026-09-05T14:00:00');
const djiOrder = [
  item('DJI_0003.MP4', { duration: 480, creationTime: DJI_BASE }),
  item('DJI_0004.MP4', { duration: 480, creationTime: new Date('2026-09-05T14:08:00') }),
  item('DJI_0005.MP4', { duration: 480, creationTime: new Date('2026-09-05T14:25:00') }),
  item('DJI_0006.MP4', { duration: 480, creationTime: new Date('2026-09-05T14:33:00') }),
];
const djiGaps = [{ afterIndex: 1, seconds: 529 }];

const legendsOrder = [
  item('1st-half.mp4', { duration: 1500 }),
  item('2nd-half.mp4', { duration: 1500 }),
];

// Three plain segments (no creationTime/gaps) for the drag-to-reorder tests below.
const DRAG_ORDER = [item('A.mp4', { duration: 600 }), item('B.mp4', { duration: 600 }), item('C.mp4', { duration: 600 })];

function renderList(props = {}) {
  const onReorder = vi.fn();
  const onRemove = vi.fn();
  const onAddMore = vi.fn();
  const utils = render(
    <FootageList order={djiOrder} items={djiOrder} confidence="time" gaps={djiGaps} onReorder={onReorder} onRemove={onRemove} onAddMore={onAddMore} {...props} />
  );
  return { onReorder, onRemove, onAddMore, ...utils };
}

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

describe('FootageList — DJI time-chain fixture', () => {
  it('renders 4 rows, the green time trust line, and one "9 min break" connector', () => {
    renderList();
    expect(screen.getAllByTestId('footage-row')).toHaveLength(4);

    const trust = screen.getByTestId('footage-trust-line');
    expect(trust.textContent).toBe('Put in order by the time each was recorded');
    expect(trust.className).toContain('text-green-400');

    const connectors = screen.getAllByTestId('footage-gap-connector');
    expect(connectors).toHaveLength(1);
    expect(connectors[0].textContent).toContain('9 min break');
    expect(connectors[0].getAttribute('data-huge')).toBe('false');
  });

  it('rows show recorded clock time (mono) as evidence when ordered by time', () => {
    renderList();
    const evidence = screen.getAllByTestId('footage-row-evidence');
    expect(evidence[0].textContent).toContain(formatClockTime(DJI_BASE));
    expect(evidence[0].querySelector('.font-mono')).toBeTruthy();
  });

  it('header humanizes count + total duration', () => {
    renderList();
    // 4 * 480s = 1920s -> 32 min
    expect(screen.getByTestId('footage-list-header').textContent).toBe(
      `Your game - 4 videos - ${humanizeMinutes(1920)}`
    );
  });
});

describe('FootageList — Legends name-fallback fixture', () => {
  it('shows the name trust line; the row title already carries the filename, so evidence stays duration-only (no duplicate, no clock time)', () => {
    render(<FootageList order={legendsOrder} items={legendsOrder} confidence="name" gaps={[]} />);
    const trust = screen.getByTestId('footage-trust-line');
    expect(trust.textContent).toBe('Put in order by their names');
    expect(trust.className).toContain('text-gray-400');

    // Filename appears exactly once (the row title), not duplicated into evidence.
    expect(screen.getAllByText('1st-half.mp4')).toHaveLength(1);
    const evidence = screen.getAllByTestId('footage-row-evidence');
    expect(evidence[0].textContent).not.toContain('1st-half.mp4');
    expect(evidence[0].querySelector('.font-mono')).toBeNull();
  });
});

describe('FootageList — unknown fixture', () => {
  it('turns the container + badges yellow and shows the please-check trust line', () => {
    render(<FootageList order={legendsOrder} items={legendsOrder} confidence="unknown" gaps={[]} />);
    expect(screen.getByTestId('footage-list').className).toContain('border-yellow-500');
    const trust = screen.getByTestId('footage-trust-line');
    expect(trust.textContent).toBe("We couldn't tell what order these go in - please check");
    expect(trust.className).toContain('text-yellow-400');
  });
});

describe('FootageList — manual', () => {
  it('shows the "Order set by you" trust line', () => {
    render(<FootageList order={legendsOrder} items={legendsOrder} confidence="manual" gaps={[]} />);
    expect(screen.getByTestId('footage-trust-line').textContent).toBe('Order set by you');
  });
});

describe('FootageList — huge (>3hr) gap', () => {
  it('renders a yellow "two games?" connector with the separate-upload sub-line', () => {
    const order = [item('a.mp4', { duration: 600 }), item('b.mp4', { duration: 600 })];
    render(<FootageList order={order} items={order} confidence="time" gaps={[{ afterIndex: 0, seconds: 14400 }]} />);
    const connector = screen.getByTestId('footage-gap-connector');
    expect(connector.getAttribute('data-huge')).toBe('true');
    expect(connector.textContent).toContain('4 hr gap - two games?');
    expect(connector.textContent).toContain('upload that game separately');
    expect(connector.className).toContain('yellow');
  });
});

describe('FootageList — skipped junk disclosure', () => {
  it('renders a quiet gray details with the camera-files explanation, never a warning color', () => {
    render(<FootageList order={legendsOrder} items={legendsOrder} confidence="name" gaps={[]} skipped={['a.THM', 'b.LRF']} />);
    const details = screen.getByTestId('footage-skipped');
    expect(details.querySelector('summary').textContent).toBe('Skipped 2 extra camera files');
    expect(details.textContent).toContain('Photos and helper files the camera makes - not game video.');
    expect(details.className).toContain('text-gray-500');
    expect(details.className).not.toContain('yellow');
    expect(details.className).not.toContain('red');
  });
});

describe('FootageList — probeError row', () => {
  it('renders a red "Can\'t read this one" row excluded from totals, remove-only', () => {
    const bad = item('broken.mp4', { probeError: true });
    const order = [item('good.mp4', { duration: 600 })];
    const onRemove = vi.fn();
    render(<FootageList order={order} items={[...order, bad]} confidence="name" gaps={[]} onRemove={onRemove} />);
    // Excluded from the header count (1 video, not 2).
    expect(screen.getByTestId('footage-list-header').textContent).toContain('1 videos');
    const errRow = screen.getByTestId('footage-row-error');
    expect(errRow.textContent).toContain("Can't read this one");
    fireEvent.click(within(errRow).getByLabelText('Remove broken.mp4'));
    expect(onRemove).toHaveBeenCalledWith('broken.mp4');
  });
});

describe('FootageList — gestures', () => {
  it('the row X always calls onRemove', () => {
    const { onRemove } = renderList();
    fireEvent.click(screen.getByLabelText('Remove DJI_0004.MP4'));
    expect(onRemove).toHaveBeenCalledWith('DJI_0004.MP4');
  });

  it('+ Add more calls onAddMore', () => {
    const { onAddMore } = renderList();
    fireEvent.click(screen.getByTestId('footage-add-more'));
    expect(onAddMore).toHaveBeenCalled();
  });

  it('there is no separate "Adjust order" mode — every row is draggable immediately', () => {
    renderList();
    expect(screen.queryByTestId('footage-adjust-order')).toBeNull();
    expect(screen.queryByTestId('footage-reorder-done')).toBeNull();
    expect(screen.getAllByTestId(/footage-row-handle-/).length).toBeGreaterThan(0);
  });
});

describe('FootageList — drag to reorder (Pointer Events, jsdom zero-layout pinned)', () => {
  function renderDraggable(overrides = {}) {
    const onReorder = vi.fn();
    render(<FootageList order={DRAG_ORDER} items={DRAG_ORDER} confidence="time" gaps={[]} onReorder={onReorder} {...overrides} />);
    // Pin stacked 40px rows: A [0,40), B [40,80), C [80,120) — same pattern as
    // RegionLayer.touch.test.jsx / the old FootageReorderList spec.
    const rows = screen.getAllByTestId('footage-row');
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({
        left: 0, right: 300, top: i * 40, bottom: i * 40 + 40, width: 300, height: 40, x: 0, y: i * 40,
      });
    });
    return { onReorder, rows };
  }

  it('drag handles carry touch-none so the browser does not hijack the gesture', () => {
    renderDraggable();
    expect(screen.getByTestId('footage-row-handle-0').className).toContain('touch-none');
  });

  it('dragging row A down past B updates the sequence via onReorder (manual flip)', () => {
    const { onReorder } = renderDraggable();
    const handle = screen.getByTestId('footage-row-handle-0');

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
    const { onReorder } = renderDraggable();
    fireEvent.pointerDown(screen.getByTestId('footage-row-handle-0'), { pointerId: 1, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 9, clientY: 90 });
    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe('FootageList — overlap badge (T8822, light-touch)', () => {
  it('flags two items whose recorded time ranges intersect, at confidence "time"', () => {
    const base = new Date('2026-09-05T14:00:00');
    const order = [
      item('main-camera.mp4', { duration: 1500, creationTime: base }), // 14:00-14:25
      item('phone-clip.mp4', { duration: 600, creationTime: new Date('2026-09-05T14:10:00') }), // 14:10-14:20, overlaps
    ];
    render(<FootageList order={order} items={order} confidence="time" gaps={[]} />);
    const badges = screen.getAllByTestId('footage-overlap-badge');
    expect(badges).toHaveLength(2); // both sides of the overlap are flagged
    expect(badges[0].textContent).toContain('overlaps with');
    expect(badges[0].textContent).toContain("we'll treat it as a second angle");
  });

  it('names the extra count when an item overlaps more than one other', () => {
    const base = new Date('2026-09-05T14:00:00');
    const order = [
      item('main-camera.mp4', { duration: 3000, creationTime: base }), // spans both
      item('phone1.mp4', { duration: 300, creationTime: new Date('2026-09-05T14:05:00') }),
      item('phone2.mp4', { duration: 300, creationTime: new Date('2026-09-05T14:40:00') }),
    ];
    render(<FootageList order={order} items={order} confidence="time" gaps={[]} />);
    const badges = screen.getAllByTestId('footage-overlap-badge');
    // main-camera overlaps both phone clips -> its badge names the first and counts the rest.
    const mainBadge = badges.find((b) => b.textContent.includes('(and 1 more)'));
    expect(mainBadge).toBeTruthy();
  });

  it('does not flag non-overlapping items', () => {
    renderList(); // djiOrder: continuous, non-overlapping segments
    expect(screen.queryByTestId('footage-overlap-badge')).toBeNull();
  });

  it('never flags overlap when confidence is not "time" (no reliable evidence)', () => {
    const base = new Date('2026-09-05T14:00:00');
    const order = [
      item('main-camera.mp4', { duration: 1500, creationTime: base }),
      item('phone-clip.mp4', { duration: 600, creationTime: new Date('2026-09-05T14:10:00') }),
    ];
    render(<FootageList order={order} items={order} confidence="manual" gaps={[]} />);
    expect(screen.queryByTestId('footage-overlap-badge')).toBeNull();
  });
});
