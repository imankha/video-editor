import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAdminStore } from '../../stores/adminStore';
import { StepInspector, formatDuration } from './StepInspector';
import { JourneyView } from './JourneyTab';

const rate = (k, n) => (n >= 20 ? { pct: Math.round((100 * k) / n), k, n } : { pct: null, k, n });

const STEP = {
  stage: 'started', label: 'Started',
  counts: { reached: 61, continued: 38, in_window: 3, stuck: 8, gone: 12, judged: 58, continue_rate: rate(38, 58) },
  next: { stage: 'add_footage', continued: 41, timed: 39, n: 37, median_s: 660, p75_s: 200000, out_of_order: 2, skipped: 0,
    buckets: { lt_1h: 24, same_day: 6, d2_3: 4, d4_14: 2, gt_14d: 1 } },
  breakdown: [
    { key: 'pwa-mobile', reached: 30, continued: 10, stuck: 5, gone: 15, in_window: 0, judged: 30, rate: rate(10, 30), rate_lb: 19.2 },
    { key: 'pwa-desktop', reached: 4, continued: 2, stuck: 1, gone: 1, in_window: 0, judged: 4, rate: rate(2, 4), rate_lb: 15.0 },
  ],
  instead: [{ action: 'dialog_impression:file_too_large', lift: 3.1, n_dropped: 9, n_continued: 6, p_dropped: 0.45, p_continued: 0.15 }],
  instead_note: 'correlation, not cause',
  why: { failures: [{ event: 'game_upload_failed', reason: 'timeout', users: 6 }],
    impressions: [{ slug: 'dialog_impression:file_too_large', users: 5 }],
    retry_bursts: { sampled: 20, with_bursts: 3, by_action: { game_created: 3 } } },
  people: {
    stuck: [{ user_id: 'u1', email: 'a@x.com', platform: 'pwa-mobile', last_active_at: '2026-10-30T10:00:00Z' }],
    gone: [{ user_id: 'u2', email: 'b@x.com', platform: 'pwa-desktop', last_active_at: '2026-09-01T10:00:00Z' }],
    in_window: [],
  },
  left: {
    computed_at: '2026-10-31T10:00:00+00:00', run_id: 'r1', users_walked: 40, users_failed: 1,
    below_head_skipped: 2, exit_users: 20, partial: false,
    exit_screens: [{ screen: 'project-manager', users: 14, share: rate(14, 20) },
      { screen: 'annotate', users: 6, share: rate(6, 20) }],
    dwell: [{ screen: 'annotate', users: 6, buckets: { lt_10s: 2, s10_60: 0, m1_5: 4, m5_30: 0, gt_30m: 0 } }],
    retry_bursts: [{ action: 'game_created', users: 3 }],
    transitions_out: [{ to_stage: 'add_footage', users: 7, transitions: 8 }],
  },
};

const show = (props = {}) => render(
  <StepInspector step={STEP} by="platform" onChangeBy={() => {}} outcome="stuck"
                 onChangeOutcome={() => {}} onOpenUser={() => {}} {...props} />);

describe('StepInspector (T14020)', () => {
  it('shows counts, time to next with buckets and the out-of-order count', () => {
    show();
    expect(within(screen.getByTestId('step-counts')).getByText('61')).toBeTruthy();
    const next = screen.getByTestId('step-next');
    expect(next.textContent).toContain('median 11 min');
    expect(next.textContent).toContain('p75 2.31 d');
    expect(next.textContent).toContain('>14d');
    expect(screen.getByTestId('step-out-of-order').textContent).toContain('out of order: 2');
  });

  it('says how many continuing users have a timestamp for this stage', () => {
    show();
    expect(screen.getByTestId('step-next-timed').textContent)
      .toBe('39 of 41 users have a timestamp for this stage');
  });

  it('uses the singular for one continuing user', () => {
    const next = { ...STEP.next, continued: 1, timed: 1, n: 1, out_of_order: 0 };
    show({ step: { ...STEP, next } });
    expect(screen.getByTestId('step-next-timed').textContent)
      .toBe('1 of 1 user has a timestamp for this stage');
  });

  it('users who continued with no timestamp are not reported as nobody continued', () => {
    const next = { ...STEP.next, continued: 4, timed: 0, n: 0, out_of_order: 0, median_s: null, p75_s: null,
      buckets: { lt_1h: 0, same_day: 0, d2_3: 0, d4_14: 0, gt_14d: 0 } };
    show({ step: { ...STEP, next } });
    expect(screen.queryByText('Nobody continued from this stage yet.')).toBeNull();
    expect(screen.getByTestId('step-next-timed').textContent)
      .toBe('0 of 4 users have a timestamp for this stage');
    expect(screen.queryByTestId('step-next')).toBeNull();
  });

  it('says nobody continued only when nobody did', () => {
    const next = { ...STEP.next, continued: 0, timed: 0, n: 0, out_of_order: 0 };
    show({ step: { ...STEP, next } });
    expect(screen.getByText('Nobody continued from this stage yet.')).toBeTruthy();
  });

  it('omits the out-of-order note when no delta is negative', () => {
    show({ step: { ...STEP, next: { ...STEP.next, out_of_order: 0 } } });
    expect(screen.queryByTestId('step-out-of-order')).toBeNull();
  });

  it('breakdown shows k / n below 20 judged and the Wilson lower bound beside every rate', () => {
    show();
    const rows = within(screen.getByTestId('step-breakdown')).getAllByRole('row');
    expect(rows[1].textContent).toContain('33.00%');
    expect(rows[1].textContent).toContain('19.20%');
    expect(rows[2].textContent).toContain('2 / 4');
  });

  it('breakdown tabs report the chosen dimension', () => {
    const onChangeBy = vi.fn();
    show({ onChangeBy });
    fireEvent.click(screen.getByRole('button', { name: 'Signup month' }));
    expect(onChangeBy).toHaveBeenCalledWith('cohort_month');
  });

  it('offers a Country breakdown tab (T15100)', () => {
    const onChangeBy = vi.fn();
    show({ onChangeBy });
    fireEvent.click(screen.getByRole('button', { name: 'Country' }));
    expect(onChangeBy).toHaveBeenCalledWith('country');
  });

  it('instead carries the correlation label; why lists failures, impressions, bursts', () => {
    show();
    expect(screen.getByTestId('step-instead').textContent).toContain('correlation, not cause');
    expect(screen.getByTestId('step-instead').textContent).toContain('3.10x');
    const why = screen.getByTestId('step-why').textContent;
    expect(why).toContain('game_upload_failed');
    expect(why).toContain('timeout');
    expect(why).toContain('dialog_impression:file_too_large');
    expect(screen.getByTestId('step-retry-bursts').textContent).toContain('3 of 20');
  });

  it('empty instead shows the threshold hint', () => {
    show({ step: { ...STEP, instead: [] } });
    expect(screen.getByTestId('step-instead').textContent).toContain('No side action clears the bar');
  });

  it('Where they left (T14030): last-screen shares, dwell buckets, computed-at stamp', () => {
    show();
    const left = screen.getByTestId('step-where-left');
    expect(left.className).not.toContain('opacity-40');
    expect(screen.getByTestId('step-left-stamp').textContent).toContain('2026-10-31 10:00');
    expect(screen.getByTestId('step-left-stamp').textContent).toContain('40 users');
    expect(screen.getByTestId('step-left-stamp').textContent).toContain('2 below head');
    const exits = within(screen.getByTestId('step-left-exits')).getAllByRole('listitem');
    expect(exits[0].textContent).toContain('project-manager');
    expect(exits[0].textContent).toContain('14 / 20');
    const dwell = screen.getByTestId('step-left-dwell').textContent;
    expect(dwell).toContain('annotate');
    expect(dwell).toContain('1-5 min');
    expect(left.textContent).toContain('game_created');
    expect(left.textContent).toContain('add_footage');
  });

  it('Where they left before any rollup: says so; the run button reports the click', () => {
    const onRunRollup = vi.fn();
    show({ step: { ...STEP, left: { computed_at: null, partial: false } }, onRunRollup });
    expect(screen.getByTestId('step-where-left').textContent).toContain('No rollup yet');
    fireEvent.click(screen.getByRole('button', { name: 'Run rollup' }));
    expect(onRunRollup).toHaveBeenCalledTimes(1);
  });

  it('Where they left shows a running state and the last rollup error', () => {
    show({ rollup: { running: true, error: null } });
    expect(screen.getByRole('button', { name: 'Running...' }).disabled).toBe(true);
    show({ rollup: { running: false, error: 'HTTP 503' } });
    expect(screen.getByTestId('step-left-error').textContent).toContain('HTTP 503');
  });

  it('people list opens the user detail for the clicked person; outcome tab switches', () => {
    const onOpenUser = vi.fn();
    const onChangeOutcome = vi.fn();
    show({ onOpenUser, onChangeOutcome });
    fireEvent.click(screen.getByTestId('step-person-u1'));
    expect(onOpenUser).toHaveBeenCalledWith('u1');
    fireEvent.click(screen.getByRole('button', { name: 'gone 1' }));
    expect(onChangeOutcome).toHaveBeenCalledWith('gone');
  });

  it('formatDuration', () => {
    expect(formatDuration(null)).toBe('--');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(660)).toBe('11 min');
  });
});

const node = (key, label, o = {}) => ({ key, label, band: 'get', major: false, client_beacon: false,
  reached: 0, continued: 0, in_window: 0, stuck: 0, gone: 0, judged: 0, partial_from: null, no_data: false,
  continue_rate: rate(0, 0), ...o });
const DATA = {
  nodes: [
    node('signed_up', 'Signed up', { major: true, reached: 10, continued: 6, stuck: 3, gone: 1, judged: 10 }),
    node('started', 'Started', { reached: 6, continued: 5, stuck: 1, judged: 6 }),
    node('took_away', 'Took it away', { major: true, reached: 5 }),
  ],
  edges: [
    { from: 'signed_up', to: 'started', users: 6, skip: false },
    { from: 'started', to: 'took_away', users: 5, skip: true },
  ],
  bands: [{ key: 'get', label: 'Get footage in' }], loss: [], money: { nodes: [], edges: [] },
  meta: { window_days: 14, inactive_days: 14 },
};
const FILTERS = { windowDays: 14, inactiveDays: 14 };

describe('JourneyView inspector wiring (T14020)', () => {
  const fetchJourneyStep = vi.fn();
  const fetchUserDetail = vi.fn();
  beforeEach(() => {
    fetchJourneyStep.mockReset();
    useAdminStore.setState({ fetchJourneyStep, fetchUserDetail, journeyStep: STEP,
      journeyStepLoading: false, journeyStepError: null });
  });

  it('clicking a node queries the inspector for that stage with the default tab', () => {
    render(<JourneyView data={DATA} filters={FILTERS} />);
    expect(screen.queryByTestId('step-inspector')).toBeNull();
    fireEvent.click(screen.getByTestId('journey-node-signed_up').querySelector('rect'));
    expect(fetchJourneyStep).toHaveBeenCalledWith('signed_up', 'platform', FILTERS);
  });

  it('changing the breakdown tab re-queries only the inspector', () => {
    useAdminStore.setState({ journeyStep: { ...STEP, stage: 'signed_up' } });
    render(<JourneyView data={DATA} filters={FILTERS} />);
    fireEvent.click(screen.getByTestId('journey-node-signed_up').querySelector('rect'));
    fireEvent.click(screen.getByRole('button', { name: 'Origin' }));
    expect(fetchJourneyStep).toHaveBeenLastCalledWith('signed_up', 'origin', FILTERS);
  });

  it('clicking a stuck ribbon opens the stage with stuck pre-selected; gone pre-selects gone', () => {
    useAdminStore.setState({ journeyStep: { ...STEP, stage: 'signed_up' } });
    render(<JourneyView data={DATA} filters={FILTERS} />);
    fireEvent.click(screen.getByTestId('journey-drop-signed_up-gone'));
    expect(fetchJourneyStep).toHaveBeenCalledWith('signed_up', 'platform', FILTERS);
    expect(screen.getByRole('button', { name: /^gone/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('journey-drop-signed_up-stuck'));
    expect(screen.getByRole('button', { name: /^stuck/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('Run rollup triggers the store action, then re-queries the open stage', async () => {
    const runJourneyRollup = vi.fn().mockResolvedValue({ run_id: 'r2' });
    useAdminStore.setState({ runJourneyRollup, journeyRollup: { running: false, error: null },
      journeyStep: { ...STEP, stage: 'signed_up' } });
    render(<JourneyView data={DATA} filters={FILTERS} />);
    fireEvent.click(screen.getByTestId('journey-node-signed_up').querySelector('rect'));
    fetchJourneyStep.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Run rollup' }));
    await vi.waitFor(() => expect(fetchJourneyStep).toHaveBeenCalledWith('signed_up', 'platform', FILTERS));
    expect(runJourneyRollup).toHaveBeenCalledTimes(1);
  });

  it('a person in the list opens the existing user detail', () => {
    useAdminStore.setState({ journeyStep: { ...STEP, stage: 'signed_up' } });
    render(<JourneyView data={DATA} filters={FILTERS} />);
    fireEvent.click(screen.getByTestId('journey-node-signed_up').querySelector('rect'));
    fireEvent.click(screen.getByTestId('step-person-u1'));
    expect(fetchUserDetail).toHaveBeenCalledWith('u1');
  });
});
