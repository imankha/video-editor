import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { NextStepPanel, REPO_FILE_BASE } from './NextStepPanel';
import { JOURNEY_TARGETS, END_TO_END_KEY } from './journeyTargets';

// T14920: biggest leak, the tasks that move it, the spend verdict and the roadmap, all read
// from three payloads: the Journey map (T14900 colours), the spend-readiness payload
// (T14910) and the build-time roadmap export (public/roadmap.json).

const rate = (k, n) => (n >= 20 ? { pct: Math.round((100 * k) / n), k, n } : { pct: null, k, n });
function node(key, label, o = {}) {
  const base = { key, label, band: 'get', major: false, client_beacon: false, reached: 0, continued: 0,
    in_window: 0, stuck: 0, gone: 0, judged: 0, partial_from: null, no_data: false };
  const n = { ...base, ...o };
  n.judged = n.continued + n.stuck + n.gone;
  n.continue_rate = rate(n.continued, n.judged);
  return n;
}
const LADDER = [
  ['signed_up', 'Signed up'], ['started', 'Started'], ['add_footage', 'Opened upload'], ['footage_landed', 'Video uploaded'],
  ['clipped', 'First play'], ['frame_opened', 'Opened Frame'], ['framed', 'Moved the box'], ['export_pressed', 'Pressed Sharpen'],
  ['exported', 'Highlight made'], ['spotlight_opened', 'Opened Spotlight'], ['spotlight_added', 'Added Spotlight'],
  ['finished', 'Finished highlight'], ['watched', 'Watched highlight'], ['took_away', 'Took it away'],
];
// A conserving full ladder: `lost[key]` users leave after reaching `key`; nobody in window.
function ladder(start, lost = {}) {
  let reached = start;
  return LADDER.map(([key, label], i) => {
    const last = i === LADDER.length - 1;
    const gone = last ? 0 : (lost[key] || 0);
    const n = node(key, label, { reached, continued: last ? 0 : reached - gone, gone });
    reached = n.continued;
    return n;
  });
}
const journeyOf = nodes => ({ nodes, edges: [], bands: [], loss: [], money: { nodes: [], edges: [] }, meta: { window_days: 14, inactive_days: 14 } });
// 1000 sign-ups; every step at target except the upload step (350 of 950 lost: 63.16%, red,
// baseline 66) and the clipped step (150 of 580 lost: 74.14%, yellow, target 78): the upload
// step is the biggest leak by users.
const JOURNEY = journeyOf(ladder(1000, { signed_up: 20, started: 30, add_footage: 350, footage_landed: 20, clipped: 150 }));

const task = (id, title, status, kind, file = `docs/plans/tasks/${id}-x.md`, section = 'Journey map follow-ups') =>
  ({ id, title, status, kind, section, file });
const STEP_KEYS = Object.keys(JOURNEY_TARGETS).filter(k => k !== END_TO_END_KEY);
const ROADMAP = {
  generated_at: '2026-11-05T22:10:00Z', commit: '51f1f0db9', branch: 'feature/x',
  transitions: Object.fromEntries(STEP_KEYS.map(k => [k, []])),
  gates: { visit_to_signup: ['T7410', 'T14960'], upload_failure: ['T15130', 'T9000'], money_ladder_n: [] },
  tasks: {
    T15020: task('T15020', 'Two upload flows collide', 'STAGING', 'staging'),
    T15130: task('T15130', 'Liveness window shorter than save cadence', 'WIP', 'wip'),
    T14800: task('T14800', 'Split Add footage', 'TODO', 'todo', 'docs/plans/tasks/T14800-journey-add-footage-split.md'),
    T9000: task('T9000', 'Video Pre-Shrink', 'TODO', 'todo'),
    T13200: task('T13200', 'Veo import', 'DONE', 'done', 'docs/plans/tasks/T13200-veo.md', 'Veo Highlights Import'),
    T14770: task('T14770', 'One Make highlight button', 'TODO', 'todo'),
    T14510: task('T14510', 'Sign-in code email', 'STAGING', 'staging'),
    T7410: task('T7410', 'Visit beacon', 'TODO', 'todo'),
    T14960: task('T14960', 'Visited head node', 'BLOCKED', 'blocked'),
    T15150: task('T15150', 'Durable sync', 'WAITING ON USER (deferred)', 'waiting'),
    T14950: task('T14950', 'Superseded thing', 'SUPERSEDED', 'other'),
  },
};
ROADMAP.transitions['add_footage->footage_landed'] = ['T15020', 'T15130', 'T14800', 'T9000'];
ROADMAP.transitions['footage_landed->clipped'] = ['T13200'];
ROADMAP.transitions['clipped->frame_opened'] = ['T14770', 'T15150', 'T14950'];
ROADMAP.transitions['signed_up->started'] = ['T14510'];

const SPEND = {
  computed_at: '2026-11-05T19:12:00+00:00',
  focus: { tier: 'A', gate: 'visit_to_signup', label: 'Visit to sign-up', rag: 'grey', unblocked_by: 'shipping' },
  verdict: { headline: 'Not yet: fix the funnel.', all_green: false,
    line: 'Measurement flight blocked by 4 gate(s) (first: Visit to sign-up). Channels: Meta Reels NO.' },
  gates: [{ key: 'visit_to_signup', tier: 'A', label: 'Visit to sign-up', rag: 'grey', confidence: null,
    unblock: { kind: 'task', text: 'not instrumented: no visit beacon (T7410)', need: null } }],
};

function panel(props = {}) {
  const all = { roadmap: ROADMAP, roadmapLoading: false, roadmapError: null, journey: JOURNEY, spend: SPEND,
    spendLoading: false, spendError: null, onRefresh: vi.fn(), ...props };
  const utils = render(<NextStepPanel {...all} />);
  return { ...utils, ...all };
}
const ids = container => within(container).getAllByTestId(/^next-step-task-/).map(el => el.getAttribute('data-task'));

describe('NextStepPanel: biggest leak (T14920:C1)', () => {
  it('names the red or yellow transition with the most users lost, with its chip and loss count', () => {
    panel();
    const leak = screen.getByTestId('next-step-leak');
    expect(leak.getAttribute('data-key')).toBe('add_footage->footage_landed');
    expect(leak.textContent).toContain('Opened upload to Video uploaded');
    expect(leak.textContent).toContain('350 lost');
    const chip = screen.getByTestId('next-step-leak-chip');
    expect(chip.getAttribute('data-rag')).toBe('red');
    expect(chip.textContent).toBe('63.16% of 950, target 78.00%');
  });

  it('breaks a tie on users lost by funnel order, the earlier step first', () => {
    // 100 lost after started (started->add_footage, baseline 83) and 100 lost after clipped: both red.
    panel({ journey: journeyOf(ladder(400, { started: 100, clipped: 100 })) });
    expect(screen.getByTestId('next-step-leak').getAttribute('data-key')).toBe('started->add_footage');
  });

  it('ignores a grey step even when it lost more users than the red one', () => {
    // 30 sign-ups: 11 lost after Signed up (red, n 30); 14 lost after Started (n 19, under the
    // floor, grey). The grey step lost more users but has no colour, so the red step is the leak.
    panel({ journey: journeyOf(ladder(30, { signed_up: 11, started: 14 })) });
    expect(screen.getByTestId('next-step-leak').getAttribute('data-key')).toBe('signed_up->started');
    expect(screen.getByTestId('next-step-leak').textContent).toContain('11 lost');
  });

  it('says so when no judged step is red or yellow and still offers the first planned step', () => {
    panel({ journey: journeyOf(ladder(1000)) });
    const leak = screen.getByTestId('next-step-leak');
    expect(leak.hasAttribute('data-key')).toBe(false);
    expect(leak.textContent).toMatch(/No step below target/);
    const tasks = screen.getByTestId('next-step-tasks');
    expect(tasks.getAttribute('data-key')).toBe('signed_up->started');
    expect(tasks.textContent).toMatch(/first step with planned work/);
  });

  it('calls the leak measured and names what it could not judge', () => {
    panel({ journey: journeyOf(ladder(1000, { started: 300, clipped: 100 }).map(n => (
      n.key === 'footage_landed' ? { ...n, partial_from: '2026-08-26' } : n))) });
    expect(screen.getByText('Biggest judged leak')).toBeTruthy();
    expect(screen.queryByText('Biggest leak')).toBeNull();
    const leak = screen.getByTestId('next-step-leak');
    expect(leak.textContent).toMatch(/Not judged: .*partial data.*could be larger/);
  });

  it('keeps the plain label when every step was judged', () => {
    panel({ journey: journeyOf(ladder(1000, { started: 300 })) });
    expect(screen.getByText('Biggest leak')).toBeTruthy();
    expect(screen.getByTestId('next-step-leak').textContent).not.toMatch(/Not judged/);
  });

  it('does not report "below target" when nothing could be judged', () => {
    panel({ journey: journeyOf(ladder(1000).map(n => (
      n.key === 'signed_up' ? n : { ...n, partial_from: '2026-11-04' }))) });
    const leak = screen.getByTestId('next-step-leak');
    expect(leak.textContent).toMatch(/No step could be judged/);
    expect(leak.textContent).not.toMatch(/below target/);
    expect(screen.getByTestId('next-step-tasks').textContent).not.toMatch(/no step is below target/);
  });

  it('waits for the Journey payload without hiding the row', () => {
    panel({ journey: null });
    expect(screen.getByTestId('next-step-leak').textContent).toMatch(/Loading journey/);
  });
});

describe('NextStepPanel: do next (T14920:C1, C2)', () => {
  it('lists the mapped tasks in roadmap order with status chips and marks the first actionable one Next', () => {
    panel();
    const tasks = screen.getByTestId('next-step-tasks');
    expect(ids(tasks)).toEqual(['T15020', 'T15130', 'T14800', 'T9000']);
    expect(within(tasks).getByTestId('next-step-next').closest('[data-task]').getAttribute('data-task')).toBe('T15130');
    const chip = within(screen.getByTestId('next-step-task-T15020')).getByTestId('task-status-chip');
    expect(chip.getAttribute('data-kind')).toBe('staging');
    expect(chip.textContent).toBe('STAGING');
    expect(within(screen.getByTestId('next-step-task-T15130')).getByTestId('task-status-chip').textContent).toBe('WIP');
  });

  it('links each id to its task file on the repo default branch', () => {
    panel();
    const link = within(screen.getByTestId('next-step-task-T14800')).getByRole('link', { name: 'T14800' });
    expect(link.getAttribute('href')).toBe(`${REPO_FILE_BASE}docs/plans/tasks/T14800-journey-add-footage-split.md`);
    expect(REPO_FILE_BASE).toBe('https://github.com/imankha/video-editor/blob/master/');
  });

  it('skips staging, done and other statuses when choosing Next; waiting and blocked count', () => {
    const journey = journeyOf(ladder(1000, { clipped: 500 }));
    panel({ journey });
    expect(screen.getByTestId('next-step-tasks').getAttribute('data-key')).toBe('clipped->frame_opened');
    expect(within(screen.getByTestId('next-step-tasks')).getByTestId('next-step-next').closest('[data-task]').getAttribute('data-task')).toBe('T14770');
    const roadmap = { ...ROADMAP, transitions: { ...ROADMAP.transitions, 'clipped->frame_opened': ['T14950', 'T15150'] } };
    panel({ journey, roadmap });
    const second = screen.getAllByTestId('next-step-tasks').at(-1);
    expect(within(second).getByTestId('next-step-next').closest('[data-task]').getAttribute('data-task')).toBe('T15150');
  });

  it('says loudly when every mapped task is shipped or the list is empty', () => {
    panel({ journey: journeyOf(ladder(1000, { footage_landed: 500 })) });
    expect(screen.getByTestId('next-step-tasks').getAttribute('data-key')).toBe('footage_landed->clipped');
    expect(ids(screen.getByTestId('next-step-tasks'))).toEqual(['T13200']);
    const tasks = screen.getByTestId('next-step-tasks');
    expect(within(tasks).getByTestId('next-step-nothing-planned').textContent).toMatch(/nothing planned for this step/);
    expect(within(tasks).queryByTestId('next-step-next')).toBeNull();
  });

  it('refuses to hide a step the roadmap has no entry for', () => {
    const rest = Object.fromEntries(Object.entries(ROADMAP.transitions).filter(([k]) => k !== 'add_footage->footage_landed'));
    panel({ roadmap: { ...ROADMAP, transitions: rest } });
    const row = screen.getByTestId('next-step-no-entry');
    expect(row.textContent).toContain('add_footage->footage_landed');
    expect(row.textContent).toMatch(/roadmap has no entry/);
  });
});

describe('NextStepPanel: spend verdict (T14920:C1)', () => {
  it('prints the verdict line verbatim, the focus gate with its chip, and the tasks mapped to that gate', () => {
    panel();
    expect(screen.getByTestId('next-step-spend-line').textContent).toBe(SPEND.verdict.line);
    const focus = screen.getByTestId('next-step-focus');
    expect(focus.textContent).toContain('focus A');
    expect(focus.textContent).toContain('Visit to sign-up');
    expect(within(focus).getByTestId('next-step-focus-chip').getAttribute('data-rag')).toBe('grey');
    expect(ids(screen.getByTestId('next-step-focus-tasks'))).toEqual(['T7410', 'T14960']);
    expect(within(screen.getByTestId('next-step-focus-tasks')).getByTestId('next-step-next').closest('[data-task]').getAttribute('data-task')).toBe('T7410');
  });

  it('shows only the line when there is no focus, and the loading or error state otherwise', () => {
    panel({ spend: { ...SPEND, focus: null } });
    expect(screen.queryByTestId('next-step-focus')).toBeNull();
    panel({ spend: null, spendLoading: true });
    expect(screen.getAllByTestId('next-step-spend-line').at(-1).textContent).toMatch(/Loading spend readiness/);
    panel({ spend: null, spendError: 'HTTP 500' });
    expect(screen.getAllByTestId('next-step-spend-line').at(-1).textContent).toContain('HTTP 500');
  });

  it('says loudly when the focus gate has no task mapped', () => {
    panel({ spend: { ...SPEND, focus: { ...SPEND.focus, gate: 'money_ladder_n', label: 'Money ladder n', rag: 'red' } } });
    expect(within(screen.getByTestId('next-step-focus-tasks')).getByTestId('next-step-nothing-planned').textContent).toMatch(/nothing planned/);
  });
});

describe('NextStepPanel: roadmap (T14920:C1, C2)', () => {
  it('is collapsed by default and opens to every step in funnel order with its tasks', () => {
    panel();
    const toggle = screen.getByTestId('next-step-roadmap-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('next-step-roadmap')).toBeNull();
    expect(toggle.textContent).toContain('9 steps, 9 tasks');
    fireEvent.click(toggle);
    const steps = within(screen.getByTestId('next-step-roadmap')).getAllByTestId(/^next-step-roadmap-step-/);
    expect(steps.map(s => s.getAttribute('data-key'))).toEqual(STEP_KEYS);
    expect(ids(steps[2])).toEqual(['T15020', 'T15130', 'T14800', 'T9000']);
    expect(steps[7].textContent).toMatch(/nothing planned/);
  });

  it('prints the build time and commit of the export and refreshes on request', () => {
    const { onRefresh } = panel();
    const header = screen.getByTestId('next-step-asof');
    expect(header.textContent).toContain('2026-11-05 22:10 UTC');
    expect(header.textContent).toContain('51f1f0db9');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh roadmap' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('NextStepPanel: missing roadmap (T14920:C4)', () => {
  it('renders the loud row when the export is missing, never an empty panel', () => {
    panel({ roadmap: null, roadmapError: 'HTTP 404' });
    const row = screen.getByTestId('next-step-missing');
    expect(row.textContent).toMatch(/roadmap export missing/);
    expect(row.textContent).toContain('HTTP 404');
    expect(row.textContent).toContain('npm run roadmap');
    // The leak is still computed from the Journey payload.
    expect(screen.getByTestId('next-step-leak').getAttribute('data-key')).toBe('add_footage->footage_landed');
    expect(screen.queryByTestId('next-step-tasks')).toBeNull();
    expect(screen.queryByTestId('next-step-roadmap-toggle')).toBeNull();
  });

  it('says it is loading before the first read', () => {
    panel({ roadmap: null, roadmapLoading: true });
    expect(screen.getByTestId('next-step-missing').textContent).toMatch(/Loading roadmap/);
  });
});

describe('NextStepPanel: phone layout (T14920:C1)', () => {
  it('stacks to one column and wraps its chips', () => {
    panel();
    for (const row of screen.getAllByTestId('next-step-row')) {
      expect(row.className).toMatch(/\bgrid-cols-1\b/);
      expect(row.className).toMatch(/\bmd:grid-cols-\[/);
    }
    expect(screen.getByTestId('next-step-task-T15020').className).toMatch(/\bflex-wrap\b/);
  });
});
