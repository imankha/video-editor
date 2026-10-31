import { render, screen, fireEvent, act, within } from '@testing-library/react';
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
    node('watched', 'Watched result', 'take', { reached: 0, no_data: true, client_beacon: true, partial_from: '2026-09-15' }),
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

const chart = () => render(<JourneyFlowChart nodes={DATA.nodes} edges={DATA.edges} bands={DATA.bands} />);
const bar = key => screen.getByTestId(`journey-node-${key}`).querySelector('rect');

describe('JourneyFlowChart (T14010, approved mock geometry)', () => {
  it('renders every node, and the fixture conserves (reached = continued + drops)', () => {
    chart();
    for (const n of DATA.nodes) {
      expect(screen.getByTestId(`journey-node-${n.key}`)).toBeTruthy();
      expect(n.reached).toBe(n.continued + n.in_window + n.stuck + n.gone);
    }
  });

  it('lays every stage out in ONE row of vertical bars, height proportional to reached', () => {
    chart();
    const ys = DATA.nodes.map(n => bar(n.key).getAttribute('y'));
    expect(new Set(ys).size).toBe(1);
    const xs = DATA.nodes.map(n => Number(bar(n.key).getAttribute('x')));
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    const h = key => Number(bar(key).getAttribute('height'));
    expect(h('signed_up') / h('started')).toBeCloseTo(30 / 20, 5);
    expect(h('started') / h('frame_opened')).toBeCloseTo(20 / 10, 5);
  });

  it('peels drops off as ribbons with a text label per kind (colour is not the only encoding)', () => {
    chart();
    for (const kind of ['in_window', 'stuck', 'gone']) {
      expect(screen.getByTestId(`journey-drop-started-${kind}`).tagName.toLowerCase()).toBe('path');
    }
    expect(screen.getByText('5 stuck')).toBeTruthy();
    expect(screen.getByText('3 gone')).toBeTruthy();
    expect(screen.getAllByText('2 in window').length).toBe(2);
    expect(screen.getByTestId('journey-drop-started-in_window').getAttribute('fill')).toBe('url(#journey-hatch)');
  });

  it('draws continued ribbons purple and skip edges fainter and dashed', () => {
    chart();
    const cont = screen.getByTestId('journey-edge');
    const skip = screen.getByTestId('journey-edge-skip');
    expect(cont.getAttribute('fill')).toBe('url(#journey-flow-grad)');
    expect(skip.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(Number(skip.getAttribute('opacity'))).toBeLessThan(Number(cont.getAttribute('opacity')));
  });

  it('puts band labels above their node groups', () => {
    chart();
    const band = screen.getByTestId('journey-band-get');
    expect(band.textContent).toBe('GET FOOTAGE IN');
    const labelY = Number(band.querySelector('text').getAttribute('y'));
    expect(labelY).toBeLessThan(Number(bar('signed_up').getAttribute('y')));
  });

  it('draws the last stage as "reached the end", never as a drop (nothing left to lose)', () => {
    const done = [...DATA.nodes.slice(0, -1),
      node('took_away', 'Took it away', 'take', { reached: 2, continued: 0, stuck: 2 })];
    render(<JourneyFlowChart nodes={done} edges={DATA.edges} bands={DATA.bands} />);
    expect(screen.getByText('2 reached the end')).toBeTruthy();
    // Booleans, not toBeNull(): Vitest's formatter crashes printing an SVG <path>.
    expect(screen.queryByTestId('journey-drop-took_away-stuck') !== null).toBe(false);
    expect(screen.queryByText('2 stuck') !== null).toBe(false);
  });

  it('stacks badges on Watched result on separate lines (no overlap), "no data" instead of 0', () => {
    chart();
    const ys = [...screen.getByTestId('journey-node-watched').querySelectorAll('tspan')]
      .map(t => Number(t.getAttribute('y')));
    expect(ys.length).toBe(4); // no data / data from / 2026-09-15 / client beacon
    expect(new Set(ys).size).toBe(ys.length);
    expect(screen.getByTestId('journey-badge-watched-no-data').textContent).toBe('no data');
    expect(screen.getByTestId('journey-badge-watched-partial').textContent).toBe('data from2026-09-15');
    expect(screen.getByTestId('journey-badge-watched-beacon').textContent).toBe('client beacon');
    expect(screen.getByTestId('journey-node-watched').textContent).not.toMatch(/(^|\D)0(\D|$)/);
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
    fireEvent.click(bar('started'));
    expect(screen.getByTestId('journey-selected').textContent).toContain('reached 20');
  });

  it('shows k / n, never a percentage, when judged < 20; a percentage when judged >= 20', () => {
    const big = { ...DATA, nodes: [...DATA.nodes, node('took_away', 'Took it away', 'take',
      { reached: 40, continued: 20, stuck: 5, gone: 5, in_window: 10 })] };
    render(<JourneyView data={big} />);
    fireEvent.click(bar('started'));
    expect(screen.getByTestId('journey-selected').textContent).toContain('(10 / 18)');
    expect(screen.getByTestId('journey-selected').textContent).not.toMatch(/%/);
    fireEvent.click(bar('took_away'));
    expect(screen.getByTestId('journey-selected').textContent).toContain('(67%)');
  });
});

describe('JourneyTab controls (T14010)', () => {
  let fetchJourney;
  beforeEach(() => {
    fetchJourney = vi.fn();
    useAdminStore.setState({
      fetchJourney, journeyData: DATA, journeyLoading: false, journeyError: null,
      segmentOrigin: null, segmentFrom: null, segmentTo: null, segmentBuild: null, excludeTest: true,
    });
  });

  const pill = (group, name) => within(screen.getByRole('group', { name: group })).getByRole('button', { name });
  const pressed = group => within(screen.getByRole('group', { name: group }))
    .getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent);

  it('renders window / inactivity / platform as pill groups, defaults 14d / 14d / all', () => {
    render(<JourneyTab />);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(within(screen.getByRole('group', { name: 'Conversion window' })).getAllByRole('button')
      .map(b => b.textContent)).toEqual(['7d', '14d', '30d']);
    expect(within(screen.getByRole('group', { name: 'Platform' })).getAllByRole('button')
      .map(b => b.textContent)).toEqual(['all', 'mobile', 'desktop']);
    expect(pressed('Conversion window')).toEqual(['14d']);
    expect(pressed('Inactive after')).toEqual(['14d']);
    expect(pressed('Platform')).toEqual(['all']);
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ windowDays: 14, inactiveDays: 14, excludeTest: true, steps: 'compact' }));
  });

  it('re-queries without reload when a pill is clicked; the clicked pill becomes the pressed one', () => {
    render(<JourneyTab />);
    fireEvent.click(pill('Conversion window', '7d'));
    expect(pressed('Conversion window')).toEqual(['7d']);
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ windowDays: 7, inactiveDays: 14 }));
    fireEvent.click(pill('Inactive after', '30d'));
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ windowDays: 7, inactiveDays: 30 }));
    fireEvent.click(pill('Platform', 'mobile'));
    expect(pressed('Platform')).toEqual(['mobile']);
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ platform: 'mobile' }));
    fireEvent.click(pill('Platform', 'all'));
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ platform: undefined }));
    fireEvent.click(pill('Steps', 'full'));
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ steps: 'full' }));
  });

  it('pills are keyboard-focusable buttons', () => {
    render(<JourneyTab />);
    const b = pill('Conversion window', '30d');
    expect(b.tagName).toBe('BUTTON');
    b.focus();
    expect(document.activeElement).toBe(b);
  });

  it('keeps the "follow the filters above" note at the end of the control row', () => {
    render(<JourneyTab />);
    const note = screen.getByText(/follow the filters above/);
    expect(note.parentElement.lastElementChild).toBe(note);
  });

  it('has no local Signups / Origin / Build / exclude-test controls', () => {
    render(<JourneyTab />);
    for (const label of ['Signups', 'Origin', 'Build']) expect(screen.queryByLabelText(label)).toBeNull();
    expect(screen.queryByText('exclude test')).toBeNull();
  });

  it('reads the AdminScreen global filters from the store and re-queries when they change', () => {
    useAdminStore.setState({ segmentOrigin: 'abc123', segmentFrom: '2026-09-01', segmentTo: '2026-09-30', segmentBuild: 4812 });
    render(<JourneyTab />);
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining(
      { origin: 'abc123', from: '2026-09-01', to: '2026-09-30', build: 4812, excludeTest: true }));
    act(() => { useAdminStore.setState({ excludeTest: false, segmentBuild: null }); });
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ excludeTest: false, build: undefined }));
    act(() => { useAdminStore.setState({ segmentOrigin: null, segmentFrom: null, segmentTo: null }); });
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining(
      { origin: undefined, from: undefined, to: undefined }));
  });
});
