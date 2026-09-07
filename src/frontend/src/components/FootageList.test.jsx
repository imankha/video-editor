import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FootageList } from './FootageList';
import { formatClockTime, humanizeMinutes } from '../utils/footageDisplay';

// T8822/T8824 — FootageList: lane 0 is the always-draggable order list; a violet
// angle section (mini-map + labelled rows) renders below it only when the model
// hands over more than one lane. Fixtures mirror T8800's three real cases (DJI
// time-chain, Legends name-fallback, unknown/please-check) plus the T8824
// overlap states (angle, ASK question, manual fold).

function item(name, { duration = 60, creationTime = null, probeError = false } = {}) {
  return { name, size: 1024, duration, creationTime, file: new File(['x'], name), probeError };
}

/** Build a single-lane `lanes` array the way inferPlacement's _finishSequence/
 *  _timeMode would, from a plain item order (prefix-sum offsets). */
function oneLane(order) {
  let acc = 0;
  return [
    order.map((it) => {
      const offsetSeconds = acc;
      acc += it.duration || 0;
      return { item: it, offsetSeconds, endSeconds: acc, lane: 0 };
    }),
  ];
}

const DJI_BASE = new Date('2026-09-05T14:00:00');
const djiItems = [
  item('DJI_0003.MP4', { duration: 480, creationTime: DJI_BASE }),
  item('DJI_0004.MP4', { duration: 480, creationTime: new Date('2026-09-05T14:08:00') }),
  item('DJI_0005.MP4', { duration: 480, creationTime: new Date('2026-09-05T14:25:00') }),
  item('DJI_0006.MP4', { duration: 480, creationTime: new Date('2026-09-05T14:33:00') }),
];
const djiLanes = oneLane(djiItems);
const djiGaps = [{ afterIndex: 1, seconds: 529 }];

const legendsItems = [
  item('1st-half.mp4', { duration: 1500 }),
  item('2nd-half.mp4', { duration: 1500 }),
];
const legendsLanes = oneLane(legendsItems);

// Three plain segments (no creationTime/gaps) for the drag-to-reorder tests below.
const DRAG_ITEMS = [item('A.mp4', { duration: 600 }), item('B.mp4', { duration: 600 }), item('C.mp4', { duration: 600 })];

function renderList(props = {}) {
  const onReorder = vi.fn();
  const onRemove = vi.fn();
  const onAddMore = vi.fn();
  const onSetPlacementMode = vi.fn();
  const utils = render(
    <FootageList
      items={djiItems}
      confidence="time"
      placement="time"
      lanes={djiLanes}
      gaps={djiGaps}
      onReorder={onReorder}
      onRemove={onRemove}
      onAddMore={onAddMore}
      onSetPlacementMode={onSetPlacementMode}
      {...props}
    />
  );
  return { onReorder, onRemove, onAddMore, onSetPlacementMode, ...utils };
}

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

describe('FootageList — DJI time-chain fixture (lanes.length === 1, zero new pixels)', () => {
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

  it('renders no angle section, no question, no override link (DOM-equality: zero angle pixels)', () => {
    renderList();
    expect(screen.queryByTestId('footage-angle-section')).toBeNull();
    expect(screen.queryByTestId('footage-question')).toBeNull();
    expect(screen.queryByTestId('footage-override-link')).toBeNull();
  });
});

describe('FootageList — Legends name-fallback fixture', () => {
  it('shows the name trust line; the row title already carries the filename, so evidence stays duration-only (no duplicate, no clock time)', () => {
    render(<FootageList items={legendsItems} confidence="name" placement="sequence" lanes={legendsLanes} gaps={[]} />);
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
    render(<FootageList items={legendsItems} confidence="unknown" placement="sequence" lanes={legendsLanes} gaps={[]} />);
    expect(screen.getByTestId('footage-list').className).toContain('border-yellow-500');
    const trust = screen.getByTestId('footage-trust-line');
    expect(trust.textContent).toBe("We couldn't tell what order these go in - please check");
    expect(trust.className).toContain('text-yellow-400');
  });
});

describe('FootageList — manual', () => {
  it('shows the "Order set by you" trust line, with the restore-clock link when every item is timed', () => {
    const timedItems = [
      item('a.mp4', { duration: 60, creationTime: new Date('2026-09-05T14:00:00') }),
      item('b.mp4', { duration: 60, creationTime: new Date('2026-09-05T14:01:00') }),
    ];
    render(<FootageList items={timedItems} confidence="manual" placement="sequence" lanes={oneLane(timedItems)} gaps={[]} />);
    expect(screen.getByTestId('footage-trust-line').textContent).toBe('Order set by you');
    expect(screen.getByTestId('footage-override-link').textContent).toBe('Use the recorded times instead');
  });

  it('hides the restore-clock link when the set never had a usable clock', () => {
    render(<FootageList items={legendsItems} confidence="manual" placement="sequence" lanes={legendsLanes} gaps={[]} />);
    expect(screen.getByTestId('footage-trust-line').textContent).toBe('Order set by you');
    expect(screen.queryByTestId('footage-override-link')).toBeNull();
  });
});

describe('FootageList — huge (>3hr) gap', () => {
  it('renders a yellow "two games?" connector with the separate-upload sub-line', () => {
    const items = [item('a.mp4', { duration: 600 }), item('b.mp4', { duration: 600 })];
    render(
      <FootageList
        items={items}
        confidence="time"
        placement="time"
        lanes={oneLane(items)}
        gaps={[{ afterIndex: 0, seconds: 14400 }]}
      />
    );
    const connector = screen.getByTestId('footage-gap-connector');
    expect(connector.getAttribute('data-huge')).toBe('true');
    expect(connector.textContent).toContain('4 hr gap - two games?');
    expect(connector.textContent).toContain('upload that game separately');
    expect(connector.className).toContain('yellow');
  });
});

describe('FootageList — skipped junk disclosure', () => {
  it('renders a quiet gray details with the camera-files explanation, never a warning color', () => {
    render(
      <FootageList
        items={legendsItems}
        confidence="name"
        placement="sequence"
        lanes={legendsLanes}
        gaps={[]}
        skipped={['a.THM', 'b.LRF']}
      />
    );
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
    const good = item('good.mp4', { duration: 600 });
    const onRemove = vi.fn();
    render(
      <FootageList
        items={[good, bad]}
        confidence="name"
        placement="sequence"
        lanes={oneLane([good])}
        gaps={[]}
        onRemove={onRemove}
      />
    );
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
    render(
      <FootageList
        items={DRAG_ITEMS}
        confidence="time"
        placement="time"
        lanes={oneLane(DRAG_ITEMS)}
        gaps={[]}
        onReorder={onReorder}
        {...overrides}
      />
    );
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

  it('dragging lane 0 while an angle is showing appends the angle name (folds it into the resulting order)', () => {
    const onReorder = vi.fn();
    const main = item('main.mp4', { duration: 1500, creationTime: new Date('2026-09-05T14:00:00') });
    const other = item('other.mp4', { duration: 1500, creationTime: new Date('2026-09-05T14:25:00') });
    const angle = item('sideline.mp4', { duration: 240, creationTime: new Date('2026-09-05T14:10:00') });
    const lanes = [
      [
        { item: main, offsetSeconds: 0, endSeconds: 1500, lane: 0 },
        { item: other, offsetSeconds: 1500, endSeconds: 3000, lane: 0 },
      ],
      [{ item: angle, offsetSeconds: 600, endSeconds: 840, lane: 1 }],
    ];
    render(<FootageList items={[main, other, angle]} confidence="time" placement="time" lanes={lanes} gaps={[]} onReorder={onReorder} />);
    const rows = screen.getAllByTestId('footage-row'); // lane 0 only: main, other
    expect(rows).toHaveLength(2);
    rows.forEach((row, i) => {
      row.getBoundingClientRect = () => ({
        left: 0, right: 300, top: i * 40, bottom: i * 40 + 40, width: 300, height: 40, x: 0, y: i * 40,
      });
    });
    fireEvent.pointerDown(screen.getByTestId('footage-row-handle-0'), { pointerId: 1, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 60 }); // push main.mp4 after other.mp4
    expect(onReorder).toHaveBeenCalledWith(['other.mp4', 'main.mp4', 'sideline.mp4']);
  });
});

// --- T8824: angle lanes / mini-map / question / override link -----------------

describe('FootageList — angle lanes (lanes.length > 1)', () => {
  const main = item('DJI_0004.MP4', { duration: 1020, creationTime: new Date('2026-09-05T18:19:00') }); // 17 min
  const angle = item('sideline.mp4', { duration: 240, creationTime: new Date('2026-09-05T18:25:00') }); // 4 min
  const lanes = [
    [{ item: main, offsetSeconds: 0, endSeconds: 1020, lane: 0 }],
    [{ item: angle, offsetSeconds: 360, endSeconds: 600, lane: 1 }],
  ];

  it('renders the angle section with a mini-map and one labelled row per angle', () => {
    render(<FootageList items={[main, angle]} confidence="time" placement="time" lanes={lanes} gaps={[]} />);
    expect(screen.getByTestId('footage-angle-section')).toBeTruthy();
    expect(screen.getByTestId('footage-angle-minimap')).toBeTruthy();
    const rows = screen.getAllByTestId('footage-angle-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('sideline.mp4');
    const sub = screen.getByTestId('footage-angle-row-sub');
    expect(sub.textContent).toBe('4 min - overlaps DJI_0004 from 6:25 PM to 6:29 PM');
  });

  it('trust line names the angle count and shows the "not two cameras" override link', () => {
    const onSetPlacementMode = vi.fn();
    render(
      <FootageList
        items={[main, angle]}
        confidence="time"
        placement="time"
        lanes={lanes}
        gaps={[]}
        onSetPlacementMode={onSetPlacementMode}
      />
    );
    expect(screen.getByTestId('footage-trust-line').textContent).toBe(
      'Put in order by the time each was recorded - and 1 angle filmed at the same time'
    );
    const link = screen.getByTestId('footage-override-link');
    expect(link.textContent).toBe('Not two cameras? Put them all in order instead');
    fireEvent.click(link);
    expect(onSetPlacementMode).toHaveBeenCalledWith('sequence');
  });

  it('pluralizes for 2+ angles and names both overlap partners on the second angle row', () => {
    const angle2 = item('dads-phone.mp4', { duration: 480, creationTime: new Date('2026-09-05T18:27:00') });
    const lanes3 = [
      [{ item: main, offsetSeconds: 0, endSeconds: 1020, lane: 0 }],
      [{ item: angle, offsetSeconds: 360, endSeconds: 600, lane: 1 }],
      [{ item: angle2, offsetSeconds: 480, endSeconds: 960, lane: 2 }],
    ];
    render(<FootageList items={[main, angle, angle2]} confidence="time" placement="time" lanes={lanes3} gaps={[]} />);
    expect(screen.getByTestId('footage-trust-line').textContent).toContain('2 angles filmed at the same time');
    const dadsRow = screen.getAllByTestId('footage-angle-row').find((r) => r.querySelector('[title="dads-phone.mp4"]'));
    const dadsSub = within(dadsRow).getByTestId('footage-angle-row-sub');
    expect(dadsSub.textContent).toContain('overlaps DJI_0004 and sideline');
  });

  it('the angle row remove button calls onRemove', () => {
    const onRemove = vi.fn();
    render(<FootageList items={[main, angle]} confidence="time" placement="time" lanes={lanes} gaps={[]} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Remove sideline.mp4'));
    expect(onRemove).toHaveBeenCalledWith('sideline.mp4');
  });
});

describe('FootageList — artifact (names) trust line + override link', () => {
  it('shows the new copy + "were they filmed at the same time" link when every item is timed', () => {
    const legendsTimedItems = [
      item('1st-half.mp4', { duration: 2700, creationTime: new Date('2026-09-05T10:13:00') }),
      item('2nd-half.mp4', { duration: 2700, creationTime: new Date('2026-09-05T10:00:00') }),
    ];
    const onSetPlacementMode = vi.fn();
    render(
      <FootageList
        items={legendsTimedItems}
        confidence="name"
        placement="sequence"
        lanes={oneLane([legendsTimedItems[1], legendsTimedItems[0]])}
        gaps={[]}
        onSetPlacementMode={onSetPlacementMode}
      />
    );
    expect(screen.getByTestId('footage-trust-line').textContent).toBe(
      'These look like two parts of one recording - put in order by their names'
    );
    const link = screen.getByTestId('footage-override-link');
    expect(link.textContent).toBe('Were they filmed at the same time? Show them as angles');
    fireEvent.click(link);
    expect(onSetPlacementMode).toHaveBeenCalledWith('time');
  });

  it('slop (confidence "time", placement "sequence") keeps the plain green line, no link', () => {
    const items = [
      item('DJI_0010.MP4', { duration: 600, creationTime: new Date('2026-09-05T14:00:00') }),
      item('DJI_0011.MP4', { duration: 600, creationTime: new Date('2026-09-05T14:09:15') }),
    ];
    render(<FootageList items={items} confidence="time" placement="sequence" lanes={oneLane(items)} gaps={[]} />);
    expect(screen.getByTestId('footage-trust-line').textContent).toBe('Put in order by the time each was recorded');
    expect(screen.queryByTestId('footage-override-link')).toBeNull();
  });

  it('the plain no-clock name fallback (no overlap at all) shows the old copy, no link', () => {
    render(<FootageList items={legendsItems} confidence="name" placement="sequence" lanes={legendsLanes} gaps={[]} />);
    expect(screen.getByTestId('footage-trust-line').textContent).toBe('Put in order by their names');
    expect(screen.queryByTestId('footage-override-link')).toBeNull();
  });
});

describe('FootageList — ASK question state', () => {
  const a = item('IMG_1001.MOV', { duration: 1800, creationTime: new Date('2026-09-05T14:00:00') });
  const b = item('clip_9987.MOV', { duration: 1800, creationTime: new Date('2026-09-05T14:15:00') });
  const lanes = oneLane([a, b]);
  const question = { a, b };

  it('renders the yellow question box with a safe-default "No" and a "Yes"', () => {
    render(<FootageList items={[a, b]} confidence="unknown" placement="sequence" lanes={lanes} gaps={[]} question={question} />);
    expect(screen.getByTestId('footage-list').className).toContain('border-yellow-500');
    const q = screen.getByTestId('footage-question');
    expect(q.textContent).toContain('Were IMG_1001 and clip_9987 filmed at the same time?');
    expect(screen.getByTestId('footage-question-no').textContent).toBe('No - two parts of one game');
    expect(screen.getByTestId('footage-question-yes').textContent).toBe('Yes - two cameras at once');
    expect(screen.getByTestId('footage-trust-line').textContent).toBe(
      'We put them in order by their names - check this looks right'
    );
  });

  it('clicking Yes/No calls setPlacementMode with the right mode', () => {
    const onSetPlacementMode = vi.fn();
    render(
      <FootageList
        items={[a, b]}
        confidence="unknown"
        placement="sequence"
        lanes={lanes}
        gaps={[]}
        question={question}
        onSetPlacementMode={onSetPlacementMode}
      />
    );
    fireEvent.click(screen.getByTestId('footage-question-yes'));
    expect(onSetPlacementMode).toHaveBeenCalledWith('time');
    fireEvent.click(screen.getByTestId('footage-question-no'));
    expect(onSetPlacementMode).toHaveBeenCalledWith('sequence');
  });

  it('submit is never blocked by the question (no disabled affordance, just informational)', () => {
    render(<FootageList items={[a, b]} confidence="unknown" placement="sequence" lanes={lanes} gaps={[]} question={question} />);
    expect(screen.getByTestId('footage-question-yes').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTestId('footage-question-no').hasAttribute('disabled')).toBe(false);
  });
});

describe('FootageList — responsive sweep (360/390/428px)', () => {
  const main = item('DJI_0004.MP4', { duration: 1020, creationTime: new Date('2026-09-05T18:19:00') });
  const angle = item('sideline.mp4', { duration: 240, creationTime: new Date('2026-09-05T18:25:00') });
  const lanes = [
    [{ item: main, offsetSeconds: 0, endSeconds: 1020, lane: 0 }],
    [{ item: angle, offsetSeconds: 360, endSeconds: 600, lane: 1 }],
  ];

  it.each([360, 390, 428])('renders the full angle section at %ipx without crashing', (width) => {
    const { container } = render(
      <div style={{ width: `${width}px` }}>
        <FootageList items={[main, angle]} confidence="time" placement="time" lanes={lanes} gaps={[]} />
      </div>
    );
    expect(container.querySelector('[data-testid="footage-angle-section"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="footage-angle-row-sub"]').textContent).toContain('overlaps DJI_0004');
  });
});
