import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAdminStore } from '../../stores/adminStore';
import { JourneyTab, JourneyView } from './JourneyTab';
import { JourneyFlowChart } from './JourneyFlowChart';

const rate = (k, n) => (n >= 20 ? { pct: Math.round((100 * k) / n), k, n } : { pct: null, k, n });

function node(key, label, band, o = {}) {
  const base = { key, label, band, client_beacon: false, reached: 0, continued: 0,
    in_window: 0, stuck: 0, gone: 0, judged: 0, partial_from: null, no_data: false };
  const n = { ...base, ...o };
  n.judged = n.continued + n.stuck + n.gone;
  n.continue_rate = rate(n.continued, n.judged);
  return n;
}

const DATA = {
  nodes: [
    node('signed_up', 'Signed up', 'get', { reached: 30, continued: 20, stuck: 4, gone: 4, in_window: 2 }),
    node('started', 'Started', 'get', { reached: 20, continued: 10, stuck: 5, gone: 3, in_window: 2 }),
    node('frame_opened', 'Opened Frame', 'make', { reached: 10, continued: 10, partial_from: '2026-09-15' }),
    node('watched', 'Watched result', 'take', { reached: 0, no_data: true, client_beacon: true }),
  ],
  edges: [
    { from: 'signed_up', to: 'started', users: 20, skip: false },
    { from: 'started', to: 'frame_opened', users: 10, skip: true },
  ],
  bands: [{ key: 'get', label: 'Get footage in' }, { key: 'make', label: 'Make the highlight' },
    { key: 'take', label: 'Take it away' }],
  loss: [
    { stage: 'started', label: 'Started', lost: 8, stuck: 5, gone: 3, still_visiting: 5, judged: 18 },
    { stage: 'signed_up', label: 'Signed up', lost: 8, stuck: 4, gone: 4, still_visiting: 4, judged: 28 },
  ],
  money: { nodes: [], edges: [] },
  meta: { window_days: 14, inactive_days: 14 },
};

describe('JourneyFlowChart (T14010)', () => {
  it('renders every node and conserves counts in the labels', () => {
    render(<JourneyFlowChart nodes={DATA.nodes} edges={DATA.edges} bands={DATA.bands} />);
    for (const n of DATA.nodes) expect(screen.getByTestId(`journey-node-${n.key}`)).toBeTruthy();
    for (const n of DATA.nodes) {
      expect(n.reached).toBe(n.continued + n.in_window + n.stuck + n.gone);
    }
  });

  it('labels every drop with count and kind (colour is not the only encoding)', () => {
    render(<JourneyFlowChart nodes={DATA.nodes} edges={DATA.edges} bands={DATA.bands} />);
    expect(screen.getByText('5 stuck')).toBeTruthy();
    expect(screen.getByText('3 gone')).toBeTruthy();
    expect(screen.getAllByText('2 in window').length).toBe(2);
  });

  it('draws skip edges distinctly', () => {
    render(<JourneyFlowChart nodes={DATA.nodes} edges={DATA.edges} bands={DATA.bands} />);
    expect(screen.getAllByTestId('journey-edge-skip').length).toBe(1);
    expect(screen.getAllByTestId('journey-edge').length).toBe(1);
  });

  it('shows "no data" instead of 0, partial badge and client-beacon note', () => {
    render(<JourneyFlowChart nodes={DATA.nodes} edges={DATA.edges} bands={DATA.bands} />);
    expect(screen.getByText('no data')).toBeTruthy();
    expect(screen.getByText('data from 2026-09-15')).toBeTruthy();
    expect(screen.getByText('client beacon')).toBeTruthy();
  });

  it('renders k / n, not a percentage, when judged < 20', () => {
    render(<JourneyFlowChart nodes={DATA.nodes} edges={DATA.edges} bands={DATA.bands} />);
    expect(screen.getByText('10 / 18 go on')).toBeTruthy();
    expect(screen.queryByText('10 / 18 go on').textContent).not.toMatch(/%/);
  });

  it('renders a percentage when judged >= 20', () => {
    const big = [node('a', 'A', 'get', { reached: 40, continued: 20, stuck: 5, gone: 5 })];
    render(<JourneyFlowChart nodes={big} edges={[]} bands={DATA.bands} />);
    expect(screen.getByText('67% go on')).toBeTruthy();
  });
});

describe('JourneyView / loss ranking (T14010)', () => {
  it('lists stages by loss with "still visiting" beside the total and shows thresholds', () => {
    render(<JourneyView data={DATA} />);
    const items = screen.getByTestId('journey-loss').querySelectorAll('li');
    expect(items[0].textContent).toContain('Started');
    expect(items[0].textContent).toContain('8 lost');
    expect(items[0].textContent).toContain('5 still visiting');
    expect(screen.getByText(/Window 14 d, inactive after 14 d/)).toBeTruthy();
  });

  it('click on a node shows its counts', () => {
    render(<JourneyView data={DATA} />);
    fireEvent.click(screen.getByTestId('journey-node-started'));
    expect(screen.getByTestId('journey-selected').textContent).toContain('reached 20');
  });
});

describe('JourneyTab controls (T14010)', () => {
  let fetchJourney;
  beforeEach(() => {
    fetchJourney = vi.fn();
    useAdminStore.setState({ fetchJourney, journeyData: DATA, journeyLoading: false, journeyError: null });
  });

  it('defaults to 14 d / 14 d and re-queries without reload when a control changes', () => {
    render(<JourneyTab />);
    expect(screen.getByLabelText('Conversion window').value).toBe('14');
    expect(screen.getByLabelText('Inactive after').value).toBe('14');
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ windowDays: 14, inactiveDays: 14, excludeTest: true, steps: 'compact' }));
    fireEvent.change(screen.getByLabelText('Conversion window'), { target: { value: '7' } });
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ windowDays: 7, inactiveDays: 14 }));
    fireEvent.change(screen.getByLabelText('Inactive after'), { target: { value: '30' } });
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ windowDays: 7, inactiveDays: 30 }));
  });

  it('sends filters together and the compact/full toggle', () => {
    render(<JourneyTab />);
    fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'paid' } });
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'ios' } });
    fireEvent.change(screen.getByLabelText('Build'), { target: { value: '42' } });
    fireEvent.click(screen.getByText('full'));
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining(
      { origin: 'paid', platform: 'ios', build: '42', steps: 'full' }));
  });
});
