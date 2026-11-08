import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAdminStore } from '../../stores/adminStore';
import { JourneyTab, JourneyView } from './JourneyTab';
import { JourneyFlowChart, formatRate } from './JourneyFlowChart';

const rate = (k, n) => (n >= 20 ? { pct: Math.round((100 * k) / n), k, n } : { pct: null, k, n });

function node(key, label, band, o = {}) {
  const base = { key, label, band, major: false, client_beacon: false, reached: 0, continued: 0,
    in_window: 0, stuck: 0, gone: 0, judged: 0, partial_from: null, no_data: false };
  const n = { ...base, ...o };
  n.judged = n.continued + n.stuck + n.gone;
  n.continue_rate = rate(n.continued, n.judged);
  return n;
}

// Conserving fixture (reached = continued + drops; reached = inflow; continued = outflow).
// Majors: signed_up, clipped, took_away. Groups: signed_up..clipped [started],
// clipped..took_away [frame_opened, watched]. Watched has no data: its count is implied by
// took_away, so it is hidden behind the badge while its ribbons still carry the users.
const DATA = {
  nodes: [
    node('signed_up', 'Signed up', 'get', { major: true, reached: 30, continued: 20, stuck: 4, gone: 4, in_window: 2 }),
    node('started', 'Started', 'get', { reached: 20, continued: 10, stuck: 5, gone: 3, in_window: 2 }),
    node('clipped', 'First play', 'get', { major: true, reached: 10, continued: 9, stuck: 1 }),
    node('frame_opened', 'Opened Frame', 'make', { reached: 9, continued: 6, stuck: 2, gone: 1, partial_from: '2026-09-15' }),
    node('watched', 'Watched highlight', 'take', { reached: 6, continued: 6, no_data: true, client_beacon: true, partial_from: '2026-09-15' }),
    node('took_away', 'Took it away', 'take', { major: true, reached: 6, continued: 0, stuck: 6 }),
  ],
  edges: [
    { from: 'signed_up', to: 'started', users: 20 },
    { from: 'started', to: 'clipped', users: 10 },
    { from: 'clipped', to: 'frame_opened', users: 9 },
    { from: 'frame_opened', to: 'watched', users: 6 },
    { from: 'watched', to: 'took_away', users: 6 },
  ],
  bands: [{ key: 'get', label: 'Get footage in' }, { key: 'make', label: 'Make the highlight' },
    { key: 'take', label: 'Take it away' }],
  loss: [
    { stage: 'signed_up', label: 'Signed up', lost: 8, stuck: 4, gone: 4, still_visiting: 4, judged: 28 },
    { stage: 'started', label: 'Started', lost: 8, stuck: 5, gone: 3, still_visiting: 5, judged: 13 },
    { stage: 'frame_opened', label: 'Opened Frame', lost: 3, stuck: 2, gone: 1, still_visiting: 2, judged: 9 },
  ],
  money: { nodes: [], edges: [] },
  meta: { window_days: 14, inactive_days: 14 },
};
const ALL_OPEN = new Set(['signed_up..clipped', 'clipped..took_away']);

const chart = (expanded = ALL_OPEN, props = {}) => render(
  <JourneyFlowChart nodes={DATA.nodes} edges={DATA.edges} bands={DATA.bands} expanded={expanded} {...props} />);
const bar = key => screen.getByTestId(`journey-node-${key}`).querySelector('rect');
const shown = key => screen.queryByTestId(`journey-node-${key}`) !== null;
// The chip's visible label (its <title> tooltip is separate).
const chipText = groupKey => screen.getByTestId(`journey-chip-${groupKey}`).querySelector('text').textContent;

describe('JourneyFlowChart (T14010, approved mock geometry, fully expanded)', () => {
  it('renders every stage, and the fixture conserves (reached = continued + drops)', () => {
    chart();
    for (const n of DATA.nodes) {
      expect(screen.getByTestId(`journey-node-${n.key}`)).toBeTruthy();
      expect(n.reached).toBe(n.continued + n.in_window + n.stuck + n.gone);
    }
  });

  it('lays every stage out in ONE row of vertical bars, height proportional to reached', () => {
    chart();
    const shownNodes = DATA.nodes.filter(n => !n.no_data);
    expect(new Set(shownNodes.map(n => bar(n.key).getAttribute('y'))).size).toBe(1);
    const xs = DATA.nodes.map(n => Number(bar(n.key).getAttribute('x')));
    expect(xs).toEqual([...xs].sort((p, q) => p - q));
    const h = key => Number(bar(key).getAttribute('height'));
    expect(h('signed_up') / h('started')).toBeCloseTo(30 / 20, 5);
    expect(h('clipped') / h('frame_opened')).toBeCloseTo(10 / 9, 5);
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

  it('draws every ribbon the same solid purple', () => {
    chart();
    const ribbons = screen.getAllByTestId('journey-edge');
    expect(ribbons).toHaveLength(DATA.edges.length);
    for (const ribbon of ribbons) {
      expect(ribbon.getAttribute('fill')).toBe('url(#journey-flow-grad)');
      expect(ribbon.getAttribute('stroke-dasharray') === null).toBe(true);
    }
  });

  it('has no dashed skip rendering left, even for an edge that jumps a stage', () => {
    const jump = [...DATA.edges, { from: 'signed_up', to: 'clipped', users: 1 }];
    render(<JourneyFlowChart nodes={DATA.nodes} edges={jump} bands={DATA.bands} expanded={ALL_OPEN} />);
    expect(screen.queryAllByTestId('journey-edge-skip')).toHaveLength(0);
    expect(screen.getAllByTestId('journey-edge')).toHaveLength(jump.length);
  });

  it('says 1 user, not 1 users, on a ribbon tooltip', () => {
    const one = DATA.edges.map(e => (e.from === 'clipped' ? { ...e, users: 1 } : e));
    render(<JourneyFlowChart nodes={DATA.nodes} edges={one} bands={DATA.bands} expanded={ALL_OPEN} />);
    const titles = screen.getAllByTestId('journey-edge').map(r => r.querySelector('title').textContent);
    expect(titles).toContain('First play to Opened Frame: 1 user');
  });

  it('puts band labels above their node groups', () => {
    chart();
    const band = screen.getByTestId('journey-band-get');
    expect(band.textContent).toBe('GET FOOTAGE IN');
    expect(Number(band.querySelector('text').getAttribute('y'))).toBeLessThan(Number(bar('signed_up').getAttribute('y')));
  });

  it('draws the last stage as "reached the end", never as a drop (nothing left to lose)', () => {
    chart();
    expect(screen.getByText('6 reached the end')).toBeTruthy();
    // Booleans, not toBeNull(): Vitest's formatter crashes printing an SVG <path>.
    expect(screen.queryByTestId('journey-drop-took_away-stuck') !== null).toBe(false);
    expect(screen.queryByText('6 stuck') !== null).toBe(false);
  });

  it('stacks badges on Watched highlight on separate lines (no overlap), "no data" instead of 0', () => {
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

describe('JourneyFlowChart progressive disclosure (T14010)', () => {
  it('default view shows only the major stages, with a "+N stages" chip on each gap', () => {
    chart(new Set());
    expect(['signed_up', 'clipped', 'took_away'].every(shown)).toBe(true);
    expect(['started', 'frame_opened', 'watched'].some(shown)).toBe(false);
    expect(chipText('signed_up..clipped')).toBe('+1 stage');
    expect(chipText('clipped..took_away')).toBe('+2 stages');
  });

  it('a collapsed gap carries the summed drops of its hidden stages', () => {
    chart(new Set());
    // clipped..took_away hides frame_opened (stuck 2, gone 1) and watched (none).
    expect(screen.getByTestId('journey-drop-group:clipped..took_away-stuck')).toBeTruthy();
    expect(screen.getByText('2 stuck')).toBeTruthy();
    expect(screen.getByText('1 gone')).toBeTruthy();
  });

  it('clicking a chip or its gap asks to toggle that group', () => {
    const onToggleGroup = vi.fn();
    chart(new Set(), { onToggleGroup });
    fireEvent.click(screen.getByTestId('journey-chip-clipped..took_away'));
    expect(onToggleGroup).toHaveBeenLastCalledWith('clipped..took_away');
    fireEvent.click(screen.getByTestId('journey-gap-signed_up..clipped'));
    expect(onToggleGroup).toHaveBeenLastCalledWith('signed_up..clipped');
    expect(onToggleGroup).toHaveBeenCalledTimes(2);
  });

  it('an expanded group shows a collapse chip that toggles it back', () => {
    const onToggleGroup = vi.fn();
    chart(new Set(['clipped..took_away']), { onToggleGroup });
    expect(chipText('clipped..took_away')).toBe('\u2212 2 stages');
    fireEvent.click(screen.getByTestId('journey-chip-clipped..took_away'));
    expect(onToggleGroup).toHaveBeenCalledWith('clipped..took_away');
  });
});

describe('JourneyView / opened from a spend gate (T14910)', () => {
  it('opens the inspector on the requested stage', () => {
    const stage = DATA.nodes[DATA.nodes.length - 1];
    render(<JourneyView data={DATA} inspectRequest={{ stage: stage.key }} />);
    expect(screen.getByTestId('journey-selected').textContent).toContain(stage.label);
  });

  it('scrolls once per request, not when the same stage is reselected later', () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    const stage = DATA.nodes[DATA.nodes.length - 1];
    const other = DATA.nodes[0];
    const request = { stage: stage.key };
    const { rerender } = render(<JourneyView data={DATA} inspectRequest={request} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(<JourneyView data={{ ...DATA }} inspectRequest={request} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    rerender(<JourneyView data={DATA} inspectRequest={{ stage: other.key }} />);
    rerender(<JourneyView data={DATA} inspectRequest={request} />);
    expect(scroll).toHaveBeenCalledTimes(2); // the same object again is not a new click
    Element.prototype.scrollIntoView = original;
  });
});

describe('JourneyView / loss ranking and expansion (T14010)', () => {
  it('lists stages by loss with "still visiting" beside the total and shows thresholds', () => {
    render(<JourneyView data={DATA} />);
    const items = screen.getByTestId('journey-loss').querySelectorAll('li');
    expect(items[1].textContent).toContain('Started');
    expect(items[1].textContent).toContain('8 lost');
    expect(items[1].textContent).toContain('5 still visiting');
    expect(screen.getByText(/Window 14 d, inactive after 14 d/)).toBeTruthy();
  });

  it('the footer no longer mentions dashed ribbons', () => {
    render(<JourneyView data={DATA} />);
    expect(screen.getByText(/Window 14 d, inactive after 14 d/).textContent).not.toMatch(/dashed|skip/i);
  });

  it('chip click expands the group inline, clicking again collapses it; several may be open', () => {
    render(<JourneyView data={DATA} />);
    expect(shown('started')).toBe(false);
    fireEvent.click(screen.getByTestId('journey-chip-signed_up..clipped'));
    expect(shown('started')).toBe(true);
    expect(shown('frame_opened')).toBe(false);
    fireEvent.click(screen.getByTestId('journey-gap-clipped..took_away'));
    expect(shown('started') && shown('frame_opened') && shown('watched')).toBe(true);
    fireEvent.click(screen.getByTestId('journey-chip-signed_up..clipped'));
    expect(shown('started')).toBe(false);
    expect(shown('frame_opened')).toBe(true);
  });

  it('a loss card expands the group that hides its stage and selects that stage', () => {
    render(<JourneyView data={DATA} />);
    fireEvent.click(screen.getByTestId('journey-loss-frame_opened'));
    expect(shown('frame_opened')).toBe(true);
    expect(shown('started')).toBe(false);
    expect(screen.getByTestId('journey-selected').textContent).toContain('Opened Frame');
    expect(bar('frame_opened').getAttribute('fill')).toBe('#ede9fe');
  });

  it('click on a node shows its counts; k / n, never a percentage, when judged < 20', () => {
    render(<JourneyView data={DATA} />);
    fireEvent.click(bar('clipped'));
    const panel = screen.getByTestId('journey-selected').textContent;
    expect(panel).toContain('reached 10');
    expect(panel).toContain('(9 / 10)');
    expect(panel).not.toMatch(/%/);
  });

  it('formats a percentage only when judged >= 20', () => {
    expect(formatRate(rate(20, 30))).toBe('67.00%');
    expect(formatRate(rate(9, 19))).toBe('9 / 19');
  });
});

describe('JourneyView head node (T14960)', () => {
  const head = {
    key: 'visited', label: 'Visited', aggregate: true, badge: 'aggregate, anonymous: visits are counts, not people',
    visits: 3450, signups: 174, ratio: { pct: 5.04, k: 174, n: 3450 }, not_instrumented: false, partial_from: null,
  };

  it('shows visits and the visit -> sign-up ratio with both counts, badged aggregate', () => {
    render(<JourneyView data={{ ...DATA, head }} />);
    const card = screen.getByTestId('journey-head-visited');
    expect(card.textContent).toContain('3450 visits');
    expect(card.textContent).toContain('174 signed up');
    expect(card.textContent).toContain('5.04%');
    expect(card.textContent).toContain('aggregate, anonymous');
  });

  it('reads "not instrumented", never a 0%, before the beacon\'s first day', () => {
    render(<JourneyView data={{ ...DATA, head: { ...head, not_instrumented: true, visits: null, ratio: null } }} />);
    const card = screen.getByTestId('journey-head-visited');
    expect(card.textContent).toContain('not instrumented');
    expect(card.textContent).not.toMatch(/0 ?%/);
  });

  it('shows the partial-from badge when the window straddles the beacon\'s first day', () => {
    render(<JourneyView data={{ ...DATA, head: { ...head, partial_from: '2026-11-08' } }} />);
    expect(screen.getByTestId('journey-head-visited').textContent).toContain('data from 2026-11-08');
  });

  it('renders nothing when the map has no head node (older payload shape)', () => {
    render(<JourneyView data={DATA} />);
    expect(screen.queryByTestId('journey-head-visited')).toBeNull();
  });
});

describe('JourneyTab controls (T14010)', () => {
  let fetchJourney;
  let fetchSpendReadiness;
  let fetchRoadmap;
  beforeEach(() => {
    fetchJourney = vi.fn();
    fetchSpendReadiness = vi.fn();
    fetchRoadmap = vi.fn();
    useAdminStore.setState({
      fetchJourney, journeyData: DATA, journeyLoading: false, journeyError: null,
      fetchSpendReadiness, spendReadiness: null, spendReadinessLoading: false, spendReadinessError: null,
      fetchRoadmap, roadmap: null, roadmapLoading: false, roadmapError: null,
      segmentOrigin: null, segmentFrom: null, segmentTo: null, segmentBuild: null, excludeTest: true,
    });
  });

  // T14920: the Next Step panel sits above Spend readiness and reads the roadmap export once
  // on mount; no filter or control re-reads it (Refresh is the only other read).
  it('mounts the Next Step panel above the Spend readiness panel and reads the roadmap once', () => {
    render(<JourneyTab />);
    expect(fetchRoadmap).toHaveBeenCalledTimes(1);
    const next = screen.getByTestId('next-step');
    const spend = screen.getByTestId('spend-readiness');
    expect(screen.getByTestId('journey-root').compareDocumentPosition(next) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
    expect(next.compareDocumentPosition(spend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Platform' })).getByRole('button', { name: 'mobile' }));
    act(() => useAdminStore.setState({ excludeTest: false }));
    expect(fetchRoadmap).toHaveBeenCalledTimes(1);
  });

  // T14910: the Spend readiness panel sits at the top of the tab and reads once on mount
  // (and again when the Real pill changes); the map's filters never re-read it.
  it('mounts the Spend readiness panel above the map and reads it once on mount', () => {
    render(<JourneyTab />);
    expect(fetchSpendReadiness).toHaveBeenCalledTimes(1);
    const root = screen.getByTestId('journey-root');
    const panel = screen.getByTestId('spend-readiness');
    const loss = screen.getByTestId('journey-loss');
    expect(root.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
    expect(panel.compareDocumentPosition(loss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: 'Platform' })).getByRole('button', { name: 'mobile' }));
    expect(fetchSpendReadiness).toHaveBeenCalledTimes(1);
    act(() => useAdminStore.setState({ excludeTest: false }));
    expect(fetchSpendReadiness).toHaveBeenCalledTimes(2);
  });

  const pill = (group, name) => within(screen.getByRole('group', { name: group })).getByRole('button', { name });
  const pressed = group => within(screen.getByRole('group', { name: group }))
    .getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent);

  it('renders window / inactivity / platform as pill groups, defaults 14d / 14d / all; no compact/full', () => {
    render(<JourneyTab />);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Steps' })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Conversion window' })).getAllByRole('button')
      .map(b => b.textContent)).toEqual(['7d', '14d', '30d']);
    expect(within(screen.getByRole('group', { name: 'Platform' })).getAllByRole('button')
      .map(b => b.textContent)).toEqual(['all', 'mobile', 'desktop']);
    expect(pressed('Conversion window')).toEqual(['14d']);
    expect(pressed('Inactive after')).toEqual(['14d']);
    expect(pressed('Platform')).toEqual(['all']);
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ windowDays: 14, inactiveDays: 14, excludeTest: true }));
    expect(fetchJourney.mock.calls[0][0]).not.toHaveProperty('steps');
    act(() => useAdminStore.setState({ segmentCountry: 'DE' }));
    expect(fetchJourney).toHaveBeenLastCalledWith(expect.objectContaining({ country: 'DE' }));
    act(() => useAdminStore.setState({ segmentCountry: null }));
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

  it('expanding a group is view state only: no re-query, no storage write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<JourneyTab />);
    const calls = fetchJourney.mock.calls.length;
    fireEvent.click(screen.getByTestId('journey-chip-clipped..took_away'));
    expect(shown('frame_opened')).toBe(true);
    expect(fetchJourney.mock.calls.length).toBe(calls);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
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

describe('Journey map fit mode (T14730)', () => {
  const svg = () => screen.getByTestId('journey-flow');

  it('keeps the fixed pixel size by default', () => {
    chart();
    expect(svg().getAttribute('width')).toBe(String(44 + 6 * 122 + 60));
    expect(svg().getAttribute('height')).not.toBeNull();
    expect(svg().style.minWidth).toBe('');
  });

  it('scales to the container in fit mode, and stops shrinking at 90px per column', () => {
    chart(ALL_OPEN, { fit: true });
    expect(svg().getAttribute('width')).toBe('100%');
    // No fixed height: a fixed one would letterbox the scaled map instead of following it.
    expect(svg().getAttribute('height')).toBeNull();
    expect(svg().getAttribute('viewBox')).toMatch(/^0 0 836 /);
    expect(svg().style.minWidth).toBe(`${Math.round((836 * 90) / 122)}px`);
  });

  it('14 stages fit a 1440px screen: the minimum width leaves room for padding and a scrollbar', () => {
    const nodes = LADDER_KEYS.map((key, i) => node(key, `Stage ${i}`, 'get', { major: true, reached: 14 - i }));
    render(<JourneyFlowChart nodes={nodes} edges={[]} bands={DATA.bands} fit />);
    expect(parseInt(svg().style.minWidth, 10)).toBeLessThanOrEqual(1440 - 2 * 24 - 17);
  });
});

describe('Journey full screen (T14730)', () => {
  let fullscreenElement;
  const define = (name, value) => Object.defineProperty(document, name, { configurable: true, ...value });
  const leave = () => {
    fullscreenElement = null;
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
  };
  const button = name => screen.getByRole('button', { name });

  beforeEach(() => {
    fullscreenElement = null;
    define('fullscreenEnabled', { value: true });
    define('fullscreenElement', { get: () => fullscreenElement });
    document.exitFullscreen = vi.fn(async () => leave());
    Element.prototype.requestFullscreen = vi.fn(async function enter() {
      fullscreenElement = this;
      act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    });
    useAdminStore.setState({
      fetchJourney: vi.fn(), journeyData: DATA, journeyLoading: false, journeyError: null,
      fetchSpendReadiness: vi.fn(), spendReadiness: null, spendReadinessLoading: false, spendReadinessError: null,
      fetchRoadmap: vi.fn(), roadmap: null, roadmapLoading: false, roadmapError: null,
      fetchJourneyStep: vi.fn(), journeyStep: null,
      segmentOrigin: null, segmentFrom: null, segmentTo: null, segmentBuild: null, excludeTest: true,
    });
  });

  afterEach(() => {
    delete document.fullscreenEnabled;
    delete document.fullscreenElement;
    delete document.exitFullscreen;
    delete Element.prototype.requestFullscreen;
  });

  it('puts the controls, the map and the inspector in the element that goes full screen', () => {
    render(<JourneyTab />);
    fireEvent.click(button('Full screen'));
    expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreenElement.contains(screen.getByRole('group', { name: 'Conversion window' }))).toBe(true);
    expect(fullscreenElement.contains(screen.getByTestId('journey-flow'))).toBe(true);
    expect(fullscreenElement.contains(screen.getByTestId('journey-loss'))).toBe(true);
    fireEvent.click(bar('signed_up'));
    expect(fullscreenElement.contains(screen.getByTestId('journey-selected'))).toBe(true);
  });

  it('shows Exit full screen once in, and the Exit button leaves through exitFullscreen', async () => {
    render(<JourneyTab />);
    fireEvent.click(button('Full screen'));
    fireEvent.click(await screen.findByRole('button', { name: 'Exit full screen' }));
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Full screen' })).toBeTruthy();
    expect(Element.prototype.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('puts the label back when the browser leaves full screen by itself (Esc)', async () => {
    render(<JourneyTab />);
    fireEvent.click(button('Full screen'));
    await screen.findByRole('button', { name: 'Exit full screen' });
    leave();
    expect(button('Full screen')).toBeTruthy();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
  });

  it('has the admin background and scrolls only while full screen', async () => {
    render(<JourneyTab />);
    const before = screen.getByTestId('journey-root');
    expect(before.className).not.toContain('overflow-auto');
    fireEvent.click(button('Full screen'));
    await screen.findByRole('button', { name: 'Exit full screen' });
    expect(fullscreenElement).toBe(before);
    for (const c of ['overflow-auto', 'bg-gradient-to-br', 'from-gray-900', 'via-purple-900', 'to-gray-900']) {
      expect(fullscreenElement.className).toContain(c);
    }
    leave();
    expect(before.className).not.toContain('overflow-auto');
  });

  it('opts out of the global centred-video :fullscreen layout, which clips wide content', () => {
    render(<JourneyTab />);
    expect(screen.getByTestId('journey-root').className).toContain('journey-fullscreen');
    // Read from disk: Vitest turns CSS imports, ?raw included, into an empty string.
    const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(indexCss).toMatch(/:fullscreen\s*{[^}]*display:\s*flex\s*!important/);
    expect(indexCss).toMatch(/\.journey-fullscreen:fullscreen\s*{[^}]*display:\s*block\s*!important/);
  });

  it('fits the map only while full screen', async () => {
    render(<JourneyTab />);
    const width = () => screen.getByTestId('journey-flow').getAttribute('width');
    expect(width()).not.toBe('100%');
    fireEvent.click(button('Full screen'));
    await screen.findByRole('button', { name: 'Exit full screen' });
    expect(width()).toBe('100%');
    leave();
    expect(width()).not.toBe('100%');
  });

  it('keeps stage clicks and drop ribbons working in full screen', async () => {
    render(<JourneyTab />);
    fireEvent.click(button('Full screen'));
    await screen.findByRole('button', { name: 'Exit full screen' });
    fireEvent.click(screen.getByTestId('journey-chip-signed_up..clipped'));
    fireEvent.click(screen.getByTestId('journey-drop-started-gone'));
    expect(screen.getByTestId('journey-selected').textContent).toContain('Started');
    expect(useAdminStore.getState().fetchJourneyStep).toHaveBeenCalledWith('started', 'platform', expect.anything());
  });

  it('hides the button when the browser cannot go full screen', () => {
    define('fullscreenEnabled', { value: false });
    render(<JourneyTab />);
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull();
  });

  it('logs a refused request and stays out of full screen', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    Element.prototype.requestFullscreen = vi.fn(() => Promise.reject(new Error('denied')));
    render(<JourneyTab />);
    fireEvent.click(button('Full screen'));
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(button('Full screen')).toBeTruthy();
    error.mockRestore();
  });
});

// T14900: a full 14-stage ladder, so every target transition has both its ends.
const LADDER_KEYS = ['signed_up', 'started', 'add_footage', 'footage_landed', 'clipped', 'frame_opened', 'framed',
  'export_pressed', 'exported', 'spotlight_opened', 'spotlight_added', 'finished', 'watched', 'took_away'];
const MAJORS = ['signed_up', 'clipped', 'exported', 'finished', 'took_away'];
function ladder(start, lost = {}, overrides = {}) {
  let reached = start;
  const nodes = LADDER_KEYS.map((key, i) => {
    const last = i === LADDER_KEYS.length - 1;
    const stuck = last ? 0 : (lost[key] || 0);
    const n = node(key, key, 'get', { major: MAJORS.includes(key), reached, continued: last ? 0 : reached - stuck, stuck, ...overrides[key] });
    reached = n.continued;
    return n;
  });
  const edges = nodes.slice(0, -1).map((n, i) => ({ from: n.key, to: nodes[i + 1].key, users: n.continued }));
  return { nodes, edges };
}
const OPEN_ALL = new Set(['signed_up..clipped', 'clipped..exported', 'exported..finished', 'finished..took_away']);
const mapOf = (payload, expanded) => render(
  <JourneyFlowChart nodes={payload.nodes} edges={payload.edges} bands={DATA.bands} expanded={expanded} />);
const rateMark = key => screen.getByTestId(`journey-rate-${key}`);
const underline = mark => mark.querySelector('line');

describe('Journey transition colours (T14900)', () => {
  it('marks all nine transitions with a colour when every stage is expanded', () => {
    mapOf(ladder(1000, { signed_up: 100, clipped: 500 }), OPEN_ALL);
    for (const k of ['signed_up->started', 'started->add_footage', 'add_footage->footage_landed',
      'footage_landed->clipped', 'clipped->frame_opened', 'frame_opened->framed', 'framed->exported',
      'exported->finished', 'finished->took_away']) {
      expect(rateMark(k).getAttribute('data-rag')).toMatch(/^(green|yellow|red)$/);
    }
    expect(screen.getAllByTestId(/^journey-rate-/).length).toBe(9);
  });

  it('pairs the colour with a solid 2px underline, not colour alone', () => {
    mapOf(ladder(100, { clipped: 50 }), OPEN_ALL);
    const mark = rateMark('clipped->frame_opened');
    expect(mark.getAttribute('data-rag')).toBe('red');
    expect(mark.querySelector('text').textContent).toBe('50.00%');
    expect(underline(mark).getAttribute('stroke-width')).toBe('2');
    expect(underline(mark).getAttribute('stroke')).toBe(mark.querySelector('text').getAttribute('fill'));
    expect(underline(mark).getAttribute('stroke-dasharray')).toBeNull();
  });

  it('shows a grey n < 20 mark on a small stage, never a percentage', () => {
    mapOf(ladder(15), OPEN_ALL);
    const mark = rateMark('signed_up->started');
    expect(mark.getAttribute('data-rag')).toBe('grey');
    expect(mark.querySelector('text').textContent).toBe('n < 20');
  });

  it('badges a partial transition instead of colouring it', () => {
    mapOf(ladder(1000, {}, { exported: { partial_from: '2026-11-04' } }), OPEN_ALL);
    const mark = rateMark('framed->exported');
    expect(mark.getAttribute('data-rag')).toBe('partial');
    expect(mark.querySelector('text').textContent).toBe('partial');
    expect(mark.textContent).toContain('2026-11-04');
  });

  it('rolls a collapsed group up to its worst transition, naming each one in the tooltip', () => {
    mapOf(ladder(1000, { clipped: 500 }), new Set());
    const mark = screen.getByTestId('journey-rate-group-clipped..exported');
    expect(mark.getAttribute('data-rag')).toBe('red');
    expect(mark.querySelector('text').textContent).toBe('worst 50.00%');
    expect(mark.querySelector('title').textContent).toContain('clipped to frame_opened');
    expect(mark.querySelector('title').textContent).toContain('framed to exported');
  });

  it('a collapsed group never reads green over a partial edge', () => {
    mapOf(ladder(1000, {}, { exported: { partial_from: '2026-11-04' } }), new Set());
    const mark = screen.getByTestId('journey-rate-group-clipped..exported');
    expect(mark.getAttribute('data-rag')).toBe('partial');
    expect(mark.querySelector('text').textContent).toMatch(/^partial, worst /);
  });

  it('keeps an exact mark on a transition whose two ends stay visible when collapsed', () => {
    mapOf(ladder(1000), new Set());
    expect(rateMark('exported->finished').getAttribute('data-rag')).toBe('green');
    expect(rateMark('finished->took_away').getAttribute('data-rag')).toBe('green');
    expect(screen.getAllByTestId(/^journey-rate-/).length).toBe(4);
  });

  it('draws the legend and the end-to-end chip in the view', () => {
    const { nodes, edges } = ladder(1000, { signed_up: 900 });
    render(<JourneyView data={{ ...DATA, nodes, edges }} />);
    const legend = screen.getByTestId('journey-rag-legend').textContent;
    for (const word of ['at target', 'improving', 'below 2026-11-03 baseline', 'too few users', 'partial data']) {
      expect(legend).toContain(word);
    }
    const chip = screen.getByTestId('journey-end-to-end');
    expect(chip.getAttribute('data-rag')).toBe('yellow');
    expect(chip.textContent).toBe('10.00% of 1000, target 18.00%');
  });

  it('puts the stage chip on the inspector heading, naming a span from an inner stage', async () => {
    const { nodes, edges } = ladder(1000, { framed: 400 });
    useAdminStore.setState({ fetchJourneyStep: vi.fn(), journeyStepLoading: false, journeyStepError: null,
      journeyStep: { stage: 'export_pressed', label: 'export_pressed', counts: { reached: 600, continued: 600, in_window: 0, stuck: 0, gone: 0, judged: 600, continue_rate: rate(600, 600) },
        next: { stage: 'exported', continued: 0, timed: 0, n: 0, median_s: null, p75_s: null, out_of_order: 0, skipped: 0, buckets: {} },
        breakdown: [], instead: [], instead_note: '', why: { failures: [], impressions: [], retry_bursts: null }, people: { stuck: [], gone: [], in_window: [] }, left: null } });
    render(<JourneyView data={{ ...DATA, nodes, edges }} filters={{}} />);
    fireEvent.click(screen.getByTestId('journey-chip-clipped..exported'));
    fireEvent.click(screen.getByTestId('journey-node-export_pressed').querySelector('rect'));
    const chip = await screen.findByTestId('step-rag-chip');
    expect(chip.getAttribute('data-rag')).toBe('yellow');
    expect(chip.textContent).toBe('framed to exported: 60.00% of 1000, target 65.00%');
  });
});
