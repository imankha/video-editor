import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAdminStore } from '../../stores/adminStore';
import { JourneyTab, LossRanking } from './JourneyTab';
import { JourneyFlowChart } from './JourneyFlowChart';
import { StepInspector } from './StepInspector';

// T14740: the drop-off numbers on the Journey map and loss ranking list those users in Users.

function node(key, label, o = {}) {
  return { key, label, band: 'get', major: false, client_beacon: false, reached: 0, continued: 0,
    in_window: 0, stuck: 0, gone: 0, judged: 0, partial_from: null, no_data: false,
    continue_rate: { pct: null, k: 0, n: 0 }, ...o };
}

const NODES = [
  node('signed_up', 'Signed up', { major: true, reached: 30, continued: 24, gone: 6 }),
  node('started', 'Started', { reached: 24, continued: 18, gone: 4, stuck: 2 }),
  node('add_footage', 'Opened upload', { reached: 18, continued: 15, gone: 2, in_window: 1 }),
  node('clipped', 'First play', { major: true, reached: 15, continued: 0, stuck: 15 }),
];
const EDGES = [
  { from: 'signed_up', to: 'started', users: 24 },
  { from: 'started', to: 'add_footage', users: 18 },
  { from: 'add_footage', to: 'clipped', users: 15 },
];
const BANDS = [{ key: 'get', label: 'Get footage in' }];
const OPEN = new Set(['signed_up..clipped']);
const LOSS = [{ stage: 'started', label: 'Started', lost: 6, stuck: 2, gone: 4, still_visiting: 2, judged: 24 }];
const DATA = { nodes: NODES, edges: EDGES, bands: BANDS, loss: LOSS, money: { nodes: [], edges: [] },
  meta: { window_days: 14, inactive_days: 14 } };

const label = (key, kind) => screen.getByTestId(`journey-drop-label-${key}-${kind}`);

describe('JourneyFlowChart drop counts (T14740)', () => {
  const chart = props => render(
    <JourneyFlowChart nodes={NODES} edges={EDGES} bands={BANDS} expanded={OPEN} {...props} />);

  it('a click on a count asks for those users, a click on the ribbon still inspects', () => {
    const onListDropUsers = vi.fn();
    const onSelectDrop = vi.fn();
    chart({ onListDropUsers, onSelectDrop });

    fireEvent.click(label('started', 'gone'));
    expect(onListDropUsers).toHaveBeenCalledWith({ stages: ['started'], label: 'Started', outcome: 'gone', count: 4 });
    expect(onSelectDrop).not.toHaveBeenCalled();

    onListDropUsers.mockClear();
    fireEvent.click(screen.getByTestId('journey-drop-started-gone'));
    expect(onSelectDrop).toHaveBeenCalledWith('started', 'gone');
    expect(onListDropUsers).not.toHaveBeenCalled();
  });

  it('shows the count text unchanged and answers the keyboard', () => {
    const onListDropUsers = vi.fn();
    chart({ onListDropUsers });
    expect(label('add_footage', 'in_window').textContent).toContain('1 in window');
    fireEvent.keyDown(label('started', 'stuck'), { key: 'Enter' });
    expect(onListDropUsers).toHaveBeenCalledWith({ stages: ['started'], label: 'Started', outcome: 'stuck', count: 2 });
  });

  it('a collapsed group count asks for every hidden stage it sums', () => {
    const onListDropUsers = vi.fn();
    chart({ onListDropUsers, expanded: new Set() });
    fireEvent.click(label('group:signed_up..clipped', 'gone'));
    expect(onListDropUsers).toHaveBeenCalledWith({
      stages: ['started', 'add_footage'], label: 'Started to Opened upload', outcome: 'gone', count: 6,
    });
  });
});

describe('LossRanking lost count (T14740)', () => {
  it('the number lists the lost users, the rest of the row selects the stage', () => {
    const onSelectStage = vi.fn();
    const onListUsers = vi.fn();
    render(<LossRanking loss={LOSS} onSelectStage={onSelectStage} onListUsers={onListUsers} />);

    fireEvent.click(screen.getByTestId('journey-loss-count-started'));
    expect(onListUsers).toHaveBeenCalledWith({ stages: ['started'], label: 'Started', outcome: 'lost', count: 6 });
    expect(onSelectStage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('journey-loss-started'));
    expect(onSelectStage).toHaveBeenCalledWith('started');
    fireEvent.click(screen.getByText('(2 still visiting)'));
    expect(onSelectStage).toHaveBeenCalledTimes(2);
  });
});

describe('JourneyTab listing users (T14740)', () => {
  let fetchUsers;
  beforeEach(() => {
    fetchUsers = vi.fn();
    useAdminStore.setState({
      journeyData: DATA, journeyLoading: false, journeyError: null, journeyUserFilter: null,
      fetchJourney: vi.fn(), fetchUsers,
    });
  });
  afterEach(() => {
    delete document.fullscreenElement;
    delete document.exitFullscreen;
  });

  it('carries the current journey controls into the filter, then shows Users', async () => {
    const onShowUsers = vi.fn();
    render(<JourneyTab onShowUsers={onShowUsers} />);
    fireEvent.click(screen.getByRole('group', { name: 'Platform' }).querySelectorAll('button')[1]);
    fireEvent.click(screen.getByRole('group', { name: 'Conversion window' }).querySelectorAll('button')[0]);

    await act(async () => { fireEvent.click(screen.getByTestId('journey-loss-count-started')); });

    expect(useAdminStore.getState().journeyUserFilter).toEqual({
      stages: ['started'], label: 'Started', outcome: 'lost', count: 6,
      platform: 'mobile', windowDays: 7, inactiveDays: 14,
    });
    expect(onShowUsers).toHaveBeenCalledTimes(1);
  });

  it('leaves full screen first, because Users is outside it', async () => {
    const order = [];
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body });
    document.exitFullscreen = vi.fn(async () => { order.push('exit'); });
    render(<JourneyTab onShowUsers={() => order.push('show')} />);

    await act(async () => { fireEvent.click(screen.getByTestId('journey-loss-count-started')); });

    expect(order).toEqual(['exit', 'show']);
  });

  it('does not touch full screen when it is not on', async () => {
    document.exitFullscreen = vi.fn(async () => {});
    render(<JourneyTab onShowUsers={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByTestId('journey-loss-count-started')); });
    expect(document.exitFullscreen).not.toHaveBeenCalled();
  });
});

describe('StepInspector People with a deleted account (T14740)', () => {
  it('renders a person with no last activity', () => {
    const step = {
      stage: 'started', label: 'Started',
      counts: { reached: 1, continued: 0, in_window: 0, stuck: 0, gone: 1, judged: 1,
        continue_rate: { pct: null, k: 0, n: 1 } },
      next: { continued: 0, timed: 0, n: 0, buckets: {}, out_of_order: 0, skipped: 0 },
      breakdown: [], by: 'platform', instead: [], instead_note: '',
      why: { failures: [], impressions: [], retry_bursts: { stuck: 0, gone: 0 } },
      left: { rows: [], partial: false, computed_at: null },
      people: { in_window: [], stuck: [], gone: [
        { user_id: 'deleted-1', email: null, platform: 'unknown', last_active_at: null }] },
      meta: { window_days: 14, inactive_days: 14 },
    };
    render(<StepInspector step={step} loading={false} error={null} by="platform" onChangeBy={() => {}}
                          outcome="gone" onChangeOutcome={() => {}} onOpenUser={() => {}}
                          rollup={{ running: false, error: null, result: null }} onRunRollup={() => {}} />);
    expect(screen.getByText('deleted-1')).toBeTruthy();
  });
});
