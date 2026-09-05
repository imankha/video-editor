import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FootageStrip } from './FootageStrip';
import { formatClockTime, humanizeMinutes } from '../utils/footageDisplay';

// T8820 — FootageStrip renders useFootageIntake's decided plan as evidence-bearing
// chips + connectors + one trust line. Fixtures mirror T8800's three real cases
// (DJI time-chain, Legends name-fallback, unknown/please-check) plus the synthetic
// >3hr "two games?" gap and a probeError chip. The strip is presentational, so we
// hand it props directly — no hook.

function item(name, { duration = 60, creationTime = null, probeError = false } = {}) {
  return { name, size: 1024, duration, creationTime, file: new File(['x'], name), probeError };
}

// DJI: 4 continuous 8-min-ish segments, ordered by embedded time, one 9-min break
// after segment 2 (index 1). afterIndex + seconds mirror inferOrder's contract.
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

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

describe('FootageStrip — DJI time-chain fixture', () => {
  it('renders 4 chips, the green time trust line, and one "9 min break" connector', () => {
    render(<FootageStrip order={djiOrder} items={djiOrder} confidence="time" gaps={djiGaps} />);
    expect(screen.getAllByTestId('footage-chip')).toHaveLength(4);

    const trust = screen.getByTestId('footage-trust-line');
    expect(trust.textContent).toBe('Put in order by the time each was recorded');
    expect(trust.className).toContain('text-green-400');

    const connectors = screen.getAllByTestId('footage-gap-connector');
    expect(connectors).toHaveLength(1);
    expect(connectors[0].textContent).toContain('9 min break');
    expect(connectors[0].getAttribute('data-huge')).toBe('false');
  });

  it('chips show recorded clock time (mono) as evidence when ordered by time', () => {
    render(<FootageStrip order={djiOrder} items={djiOrder} confidence="time" gaps={djiGaps} />);
    const evidence = screen.getAllByTestId('footage-chip-evidence');
    expect(evidence[0].textContent).toBe(formatClockTime(DJI_BASE));
    expect(evidence[0].className).toContain('font-mono');
  });

  it('header humanizes count + total duration', () => {
    render(<FootageStrip order={djiOrder} items={djiOrder} confidence="time" gaps={djiGaps} />);
    // 4 * 480s = 1920s -> 32 min
    expect(screen.getByTestId('footage-strip-header').textContent).toBe(
      `Your game - 4 videos - ${humanizeMinutes(1920)}`
    );
  });
});

describe('FootageStrip — Legends name-fallback fixture', () => {
  it('shows the name trust line and filename (not clock time) evidence', () => {
    render(<FootageStrip order={legendsOrder} items={legendsOrder} confidence="name" gaps={[]} />);
    const trust = screen.getByTestId('footage-trust-line');
    expect(trust.textContent).toBe('Put in order by their names');
    expect(trust.className).toContain('text-gray-400');

    const evidence = screen.getAllByTestId('footage-chip-evidence');
    expect(evidence[0].textContent).toBe('1st-half.mp4');
    expect(evidence[0].className).not.toContain('font-mono');
  });
});

describe('FootageStrip — unknown fixture', () => {
  it('turns the container + badges yellow and shows the please-check trust line', () => {
    render(<FootageStrip order={legendsOrder} items={legendsOrder} confidence="unknown" gaps={[]} />);
    expect(screen.getByTestId('footage-strip').className).toContain('border-yellow-500');
    const trust = screen.getByTestId('footage-trust-line');
    expect(trust.textContent).toBe("We couldn't tell what order these go in - please check");
    expect(trust.className).toContain('text-yellow-400');
  });
});

describe('FootageStrip — manual', () => {
  it('shows the "Order set by you" trust line', () => {
    render(<FootageStrip order={legendsOrder} items={legendsOrder} confidence="manual" gaps={[]} />);
    expect(screen.getByTestId('footage-trust-line').textContent).toBe('Order set by you');
  });
});

describe('FootageStrip — huge (>3hr) gap', () => {
  it('renders a yellow "two games?" connector with the separate-upload sub-line', () => {
    const order = [item('a.mp4', { duration: 600 }), item('b.mp4', { duration: 600 })];
    render(
      <FootageStrip order={order} items={order} confidence="time" gaps={[{ afterIndex: 0, seconds: 14400 }]} />
    );
    const connector = screen.getByTestId('footage-gap-connector');
    expect(connector.getAttribute('data-huge')).toBe('true');
    expect(connector.textContent).toContain('4 hr gap - two games?');
    expect(connector.textContent).toContain('upload that game separately');
    expect(connector.className).toContain('yellow');
  });
});

describe('FootageStrip — skipped junk disclosure', () => {
  it('renders a quiet gray details with the camera-files explanation, never a warning color', () => {
    render(
      <FootageStrip order={legendsOrder} items={legendsOrder} confidence="name" gaps={[]} skipped={['a.THM', 'b.LRF']} />
    );
    const details = screen.getByTestId('footage-skipped');
    expect(details.querySelector('summary').textContent).toBe('Skipped 2 extra camera files');
    expect(details.textContent).toContain('Photos and helper files the camera makes - not game video.');
    expect(details.className).toContain('text-gray-500');
    expect(details.className).not.toContain('yellow');
    expect(details.className).not.toContain('red');
  });
});

describe('FootageStrip — probeError chip', () => {
  it('renders a red "Can\'t read this one" chip excluded from totals, remove-only', () => {
    const bad = item('broken.mp4', { probeError: true });
    const order = [item('good.mp4', { duration: 600 })];
    const onRemove = vi.fn();
    render(
      <FootageStrip order={order} items={[...order, bad]} confidence="name" gaps={[]} onRemove={onRemove} />
    );
    // Excluded from the header count (1 video, not 2).
    expect(screen.getByTestId('footage-strip-header').textContent).toContain('1 videos');
    const errChip = screen.getByTestId('footage-chip-error');
    expect(errChip.textContent).toContain("Can't read this one");
    fireEvent.click(within(errChip).getByLabelText('Remove broken.mp4'));
    expect(onRemove).toHaveBeenCalledWith('broken.mp4');
  });
});

describe('FootageStrip — gestures', () => {
  it('the chip X calls onRemove with the file name', () => {
    const onRemove = vi.fn();
    render(<FootageStrip order={djiOrder} items={djiOrder} confidence="time" gaps={djiGaps} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Remove DJI_0004.MP4'));
    expect(onRemove).toHaveBeenCalledWith('DJI_0004.MP4');
  });

  it('Adjust order is always present and calls onAdjustOrder', () => {
    const onAdjustOrder = vi.fn();
    render(
      <FootageStrip order={djiOrder} items={djiOrder} confidence="time" gaps={djiGaps} onAdjustOrder={onAdjustOrder} />
    );
    fireEvent.click(screen.getByTestId('footage-adjust-order'));
    expect(onAdjustOrder).toHaveBeenCalled();
  });

  it('+ Add more calls onAddMore', () => {
    const onAddMore = vi.fn();
    render(<FootageStrip order={djiOrder} items={djiOrder} confidence="time" gaps={djiGaps} onAddMore={onAddMore} />);
    fireEvent.click(screen.getByTestId('footage-add-more'));
    expect(onAddMore).toHaveBeenCalled();
  });
});
