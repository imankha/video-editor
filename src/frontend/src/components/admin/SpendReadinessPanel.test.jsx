import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SpendReadinessPanel } from './SpendReadinessPanel';
import { JOURNEY_TARGETS } from './journeyTargets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// T14910: a payload in the shape of GET /api/admin/analytics/spend-readiness on 2026-11-05.
const CAVEAT = 'Frame export records no event (exports_started = 0 over 30 d); this is an undercount until the export event is live.';
const AT = '2026-11-05T19:12:00+00:00';
const NONE = { kind: 'none', text: '', need: null };

function gate(key, tier, label, o = {}) {
  const g = {
    key, tier, label, kind: 'proportion', unit: 'pct', label_kind: 'M', value: null, n: 0, k: 0,
    interval: null, confidence: null, settle: null, recent: null,
    target: { green: 25, yellow: 15, direction: 'higher', text: '>= 25%' },
    why: `why ${key}`, caveats: [], reference: null, rag: 'grey', unblock: NONE, computed_at: AT, ...o,
  };
  // The backend decides which gates have a Diagnose drawer (review follow-up 2026-11-06): Tier A,
  // kind none and repeat purchase have none.
  return { diagnosable: g.tier !== 'A' && g.kind !== 'none' && key !== 'repeat_purchase', ...g };
}

const GATES = [
  gate('visit_to_signup', 'A', 'Visit to sign-up', {
    target: { green: 5, yellow: 2, direction: 'higher', text: '>= 5%' },
    unblock: { kind: 'task', text: 'not instrumented: no visit beacon (visit_daily missing, T7410)', need: null },
  }),
  gate('signup_to_export_14d', 'B', 'Sign-up to export in 14 d', {
    value: 12.5, n: 321, k: 40, interval: [9.1, 16.6], rag: 'red', confidence: 'provisional',
    settle: { crosses: 15, crosses_rag: 'yellow', n_needed: 500, more: 179, eta_days: 50, text: 'crosses 15% (yellow); 179 more to settle, about 50 days (A)' },
    recent: { value: 16, n: 100, k: 16, interval: [10.1, 24.4], rag: 'yellow', confidence: 'provisional' },
    caveats: [CAVEAT],
  }),
  gate('upload_failure', 'B', 'Upload failure', {
    value: 28.7, n: 286, k: 82, interval: [23.7, 34.2], rag: 'red', confidence: 'settled',
    target: { green: 10, yellow: 20, direction: 'lower', text: '< 10%' },
    reference: { value: 23.4, n: 900, k: 211, text: 'all accounts incl. test accounts, daily_counters 90 d' },
    span: { since: '2026-11-04', days: 2 },
    recent: { value: null, n: 10, k: 4, interval: null, rag: 'grey', confidence: null },
  }),
  gate('finished_to_took_away', 'B', 'Finished to took away', {
    n: 19, k: 8, target: { green: 80, yellow: 60, direction: 'higher', text: '>= 80%' },
    unblock: { kind: 'volume', text: '1 more finished highlights to the floor of 20, about 5 days at 0.21 a day (A)',
      need: { have: 19, floor: 20, unit: 'finished highlights', eta_days: 4.7, rate_per_day: 0.21 } },
    caveats: [CAVEAT],
  }),
  gate('money_ladder_n', 'A', 'Money ladder n', {
    kind: 'counts', unit: 'counts', value: { paywall_users: 1, buyers: 0 }, n: 1, k: 0, rag: 'red',
    target: { green: [20, 5], yellow: [10, 2], direction: 'higher', text: '>= 20 paywall users and >= 5 buyers' },
    unblock: { kind: 'volume', text: '19 more paywall users to the floor of 20, about 270 days at 0.07 a day (A)',
      need: { have: 1, floor: 20, unit: 'paywall users', eta_days: 270, rate_per_day: 0.07 } },
  }),
  gate('payers_per_100', 'C', 'Payers per 100 sign-ups', {
    unit: 'per100', value: 1.07, n: 375, k: 4, interval: [0.4, 2.7], rag: 'red', confidence: 'provisional',
    target: { green: 5, yellow: 2, direction: 'higher', text: '>= 5 per 100' },
    settle: { crosses: 2, crosses_rag: 'yellow', n_needed: 900, more: 525, eta_days: 126, text: 'crosses 2 per 100 (yellow); 525 more to settle, about 126 days (A)' },
    recent: { value: 0, n: 152, k: 0, interval: [0, 2.4], rag: 'red', confidence: 'provisional' },
  }),
  gate('revenue_per_payer', 'C', 'Revenue per payer', {
    kind: 'mean', unit: 'cents', value: 1899, n: 4, interval: [782.5, 3015.5], interval_label_kind: 'A',
    target: { green: 3500, yellow: 2000, direction: 'higher', text: '>= $35.00' },
    unblock: { kind: 'volume', text: '16 more payers to the floor of 20, about 364 days at 0.04 a day (A)',
      need: { have: 4, floor: 20, unit: 'payers', eta_days: 364, rate_per_day: 0.044 } },
  }),
  gate('repeat_purchase', 'C', 'Repeat purchase', {
    n: 0, k: 0, unblock: { kind: 'time', text: '0 of 20 eligible; next payer eligible 2027-03-18',
      need: { have: 0, floor: 20, unit: 'eligible payers', eta_days: null, rate_per_day: null } },
  }),
  gate('k_factor', 'C', 'K-factor', {
    unit: 'ratio', value: 0.008, n: 379, k: 3, interval: [0.003, 0.023], rag: 'red', confidence: 'settled',
    target: { green: 0.05, yellow: 0.02, direction: 'higher', text: '>= 0.05' },
    recent: { value: 0, n: 152, k: 0, interval: [0, 0.024], rag: 'red', confidence: 'provisional' },
  }),
  gate('attribution_coverage', 'A', 'Attribution coverage', {
    kind: 'none', target: { green: 95, yellow: 85, direction: 'higher', text: '>= 95%' },
    unblock: { kind: 'none', text: 'no paid campaign yet; registry columns arrive with T15200', need: null },
  }),
  gate('kickback_payers_per_100', 'C', 'Kickback cohort payers', {
    kind: 'none', unit: 'per100', target: { green: 5, yellow: 2, direction: 'higher', text: '>= 5 per 100' },
    unblock: { kind: 'volume', text: 'registry columns arrive with T15200; 100 attributed sign-ups',
      need: { have: 0, floor: 100, unit: 'attributed sign-ups', eta_days: null, rate_per_day: null } },
  }),
];

const channel = (key, label, cost_cents, state, confidence, reason) => ({
  key, label, platform: key.split('_')[0], label_kind: 'B', note: 'benchmark', n: null, cost_cents, state, confidence, reason,
});

const DATA = {
  computed_at: AT,
  meta: { small_n_floor: 20, cohort_days: 90, recent_days: 30, mature_days: 14, revenue_days: 180,
    reprice_date: '2026-10-24', export_event_live: false,
    tiers: { A: { label: 'Can we read a test?', unblocked_by: 'shipping' }, B: { label: 'Is the funnel clean?', unblocked_by: 'fixing' },
      C: { label: 'Do the economics work?', unblocked_by: 'volume' } } },
  focus: { tier: 'B', gate: 'signup_to_export_14d', label: 'Sign-up to export in 14 d', rag: 'red', unblocked_by: 'fixing' },
  measurement_test: { allowed: false, blocking: ['visit_to_signup', 'signup_to_export_14d', 'upload_failure', 'money_ladder_n'] },
  verdict: { headline: 'Not yet: fix the funnel.', all_green: false,
    line: 'Sign-up to export in 14 d 12.50% red, provisional; Upload failure 28.70% red, settled. Measurement flight blocked by 4 gate(s) (first: Visit to sign-up). Channels: Coach codes, credits NO (provisional), Meta Reels NO. Break-even today $0.12, at most $0.77 (A).' },
  gates: GATES,
  break_even: { point_cents: 12, lower_cents: 0, upper_cents: 77, readable: false, label_kind: 'M', upper_label_kind: 'A',
    binding_input: null, binding_text: null,
    inputs: { payers_per_signup: 0.0107, revenue_per_payer_cents: 1899, export_rate: 0.125, plays_per_exporter: 3.8,
      games_per_signup: 0.97, purchases_per_payer: 1, variable_cents: 7.1, signups: 375 },
    text: '1.07% payers x $18.99 - $0.07 variable (0.125 export x 3.8 plays x $0.03 + 0.97 games x $0.05 + Stripe)' },
  channels: [
    channel('coach_credits', 'Coach codes, credits', 72, 'NO', 'provisional', 'GO at the upper bound $0.77; 16 more payers to settle (A)'),
    channel('coach_gift_cards', 'Coach codes, gift cards', 129, 'NO', 'provisional', 'TEST at the upper bound $0.77; 9 more payers to settle (A)'),
    channel('reddit_cheapest', 'Reddit, cheapest', 167, 'NO', 'settled', 'NO even at the upper bound $0.77 (half the cost is $0.84)'),
    channel('reddit_central', 'Reddit, central', 600, 'NO', 'settled', 'NO even at the upper bound $0.77 (half the cost is $3.00)'),
    channel('meta_reels', 'Meta Reels', 1200, 'NO', 'settled', 'NO even at the upper bound $0.77 (half the cost is $6.00)'),
    { ...channel('club_placement', 'Club placement', null, 'grey', null, '20 attributed sign-ups needed (0 so far)'), n: 0 },
  ],
  signups_by_country: [{ country: 'US', n: 230, pct: 61.33 }, { country: 'CA', n: 34, pct: 9.07 }, { country: 'unknown', n: 68, pct: 18.13 }],
};

function panel(props = {}) {
  const all = { data: DATA, loading: false, error: null, onRefresh: vi.fn(), onListUsers: vi.fn(),
    onShowUploadFailures: vi.fn(), diagnosis: {}, onDiagnose: vi.fn(), ...props };
  const utils = render(<SpendReadinessPanel {...all} />);
  return { ...utils, ...all };
}
const expand = () => fireEvent.click(screen.getByTestId('spend-toggle'));
const chip = key => screen.getByTestId(`spend-chip-${key}`);

describe('SpendReadinessPanel (T14910)', () => {
  it('is collapsed by default with the verdict headline always visible', () => {
    panel();
    expect(screen.getByTestId('spend-headline').textContent).toBe('Not yet: fix the funnel.');
    expect(screen.getByTestId('spend-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('spend-gate-upload_failure')).toBeNull();
    // The collapsed line names the red gates and both answers.
    const line = screen.getByTestId('spend-verdict-line').textContent;
    expect(line).toContain('Upload failure 28.70%');
    expect(line).toContain('blocked by 4 gate');
    expect(line).toContain('Meta Reels NO');
    expand();
    expect(screen.getByTestId('spend-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('spend-gate-upload_failure')).toBeTruthy();
  });

  it('groups the gates into three tiers in gate order and marks the focus tier and gate', () => {
    panel();
    expand();
    const tier = t => within(screen.getByTestId(`spend-tier-${t}`));
    expect(tier('A').getAllByTestId(/^spend-gate-/).map(el => el.dataset.gate))
      .toEqual(['visit_to_signup', 'money_ladder_n', 'attribution_coverage']);
    expect(tier('B').getAllByTestId(/^spend-gate-/).map(el => el.dataset.gate))
      .toEqual(['signup_to_export_14d', 'upload_failure', 'finished_to_took_away']);
    expect(screen.getByTestId('spend-tier-B').dataset.focus).toBe('true');
    expect(screen.getByTestId('spend-tier-A').dataset.focus).toBeUndefined();
    expect(screen.getByTestId('spend-tier-B').textContent).toMatch(/focus/i);
    expect(screen.getByTestId('spend-gate-signup_to_export_14d').dataset.focus).toBe('true');
    expect(screen.getByTestId('spend-tier-B').textContent).toContain('Is the funnel clean?');
  });

  it('a grey gate shows progress to the floor and the A-labelled date, never a bare colour', () => {
    panel();
    expand();
    expect(chip('finished_to_took_away').dataset.rag).toBe('grey');
    expect(chip('finished_to_took_away').textContent).toBe('8 of 19');
    expect(screen.getByTestId('spend-unblock-finished_to_took_away').textContent).toContain('1 more finished highlights');
    expect(screen.getByTestId('spend-unblock-finished_to_took_away').textContent).toContain('(A)');
    expect(screen.getByTestId('spend-unblock-visit_to_signup').textContent).toContain('not instrumented');
  });

  it('renders the data-derived caveat on gates 2 and 4 and the reference beside gate 3', () => {
    panel();
    expand();
    expect(screen.getByTestId('spend-caveat-signup_to_export_14d').textContent).toContain('Frame export records no event');
    expect(screen.getByTestId('spend-caveat-finished_to_took_away')).toBeTruthy();
    expect(screen.queryByTestId('spend-caveat-upload_failure')).toBeNull();
    const g3 = screen.getByTestId('spend-gate-upload_failure').textContent;
    expect(g3).toContain('since 2026-11-04');
    expect(g3).toContain('23.40%');
    expect(g3).toContain('incl. test accounts');
  });

  it('provisional figures are italic with data-confidence; settled ones are not', () => {
    panel();
    expand();
    const provisional = chip('signup_to_export_14d');
    expect(provisional.dataset.confidence).toBe('provisional');
    expect(provisional.className).toContain('italic');
    expect(provisional.title).toContain('9.10%');
    expect(provisional.title).toContain('16.60%');
    expect(provisional.title).toContain('crosses 15%');
    const settled = chip('upload_failure');
    expect(settled.dataset.confidence).toBe('settled');
    expect(settled.className).not.toContain('italic');
    expect(settled.textContent).toBe('28.70%');
    expect(screen.getByTestId('spend-legend').textContent).toMatch(/settled/);
    expect(screen.getByTestId('spend-legend').textContent).toMatch(/provisional/);
  });

  it('every chip carries data-rag from the shared RagChip and prints 2-decimal values', () => {
    panel();
    expand();
    fireEvent.click(screen.getByTestId('spend-tier-C-toggle'));
    for (const g of GATES) {
      expect(['green', 'yellow', 'red', 'grey']).toContain(chip(g.key).dataset.rag);
    }
    expect(chip('payers_per_100').textContent).toBe('1.07 per 100');
    expect(chip('revenue_per_payer').textContent).toBe('$18.99');
    expect(chip('k_factor').textContent).toBe('0.80 per 100');
    expect(chip('money_ladder_n').textContent).toBe('1 paywall, 0 bought');
  });

  it('Tier C and the ladder are one line each by default, expandable', () => {
    panel();
    expand();
    expect(screen.getByTestId('spend-tier-C-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('spend-gate-payers_per_100')).toBeNull();
    const line = screen.getByTestId('spend-economics-line').textContent;
    expect(line).toContain('not readable');
    expect(line).toContain('4 of 20 payers');
    fireEvent.click(screen.getByTestId('spend-tier-C-toggle'));
    expect(screen.getByTestId('spend-gate-payers_per_100')).toBeTruthy();
    expect(screen.getByTestId('spend-break-even').textContent).toContain('$0.12');
    expect(screen.getByTestId('spend-break-even').textContent).toContain('$0.77');
    fireEvent.click(screen.getByTestId('spend-break-even-inputs'));
    expect(screen.getByTestId('spend-break-even').textContent).toContain('1.07% payers x $18.99');
    expect(screen.getByTestId('spend-channels-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('spend-channels-line').textContent).toContain('Meta Reels NO');
    fireEvent.click(screen.getByTestId('spend-channels-toggle'));
    const meta = screen.getByTestId('spend-channel-meta_reels');
    expect(meta.textContent).toContain('$12.00');
    expect(within(meta).getByTestId('spend-channel-chip-meta_reels').dataset.rag).toBe('red');
    const coach = within(screen.getByTestId('spend-channel-coach_credits')).getByTestId('spend-channel-chip-coach_credits');
    expect(coach.dataset.confidence).toBe('provisional');
    expect(screen.getByTestId('spend-channel-club_placement').textContent).toContain('20 attributed sign-ups');
    expect(screen.getByTestId('spend-countries').textContent).toContain('US 61.33%');
  });

  it('the Diagnose drawer loads on open and never on mount; Tier A has no drawer', () => {
    const { onDiagnose } = panel();
    expand();
    expect(onDiagnose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('spend-diagnose-visit_to_signup')).toBeNull();
    const btn = screen.getByTestId('spend-diagnose-upload_failure');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(onDiagnose).toHaveBeenCalledTimes(1);
    expect(onDiagnose).toHaveBeenCalledWith('upload_failure');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('spend-diagnosis-upload_failure').textContent).toMatch(/loading/i);
  });

  it('renders the cuts with counts under the floor and drill links that carry the filter', () => {
    const diagnosis = {
      signup_to_export_14d: { loading: false, error: null, data: { key: 'signup_to_export_14d', tier: 'B', cuts: {
        weekly: [
          { group: '2026-08-17', n: 30, k: 3, value: 10, interval: [3.5, 25.6], rag: 'red', confidence: 'provisional', text: '10.00%' },
          { group: '2026-08-24', n: 5, k: 1, value: null, interval: null, rag: 'grey', confidence: null, text: '1 of 5' },
        ],
        by_build: [{ group: 4812, n: 40, k: 4, value: 10, interval: [4, 23.1], rag: 'red', confidence: 'provisional', text: '10.00%' }],
        by_platform: [{ group: 'mobile', n: 12, k: 1, value: null, interval: null, rag: 'grey', confidence: null, text: '1 of 12' }],
        by_country: [{ group: 'US', n: 25, k: 5, value: 20, interval: [8.9, 39.1], rag: 'yellow', confidence: 'provisional', text: '20.00%' },
          { group: 'unknown', n: 3, k: 0, value: null, interval: null, rag: 'grey', confidence: null, text: '0 of 3' }],
      } } },
    };
    const { onListUsers, onShowUploadFailures } = panel({ diagnosis });
    expand();
    fireEvent.click(screen.getByTestId('spend-diagnose-signup_to_export_14d'));
    const drawer = screen.getByTestId('spend-diagnosis-signup_to_export_14d');
    expect(within(drawer).getByTestId('spend-cut-weekly').textContent).toContain('1 of 5');
    expect(within(drawer).getByTestId('spend-cut-weekly').querySelector('svg')).toBeTruthy();
    expect(within(drawer).getByTestId('spend-cut-by_build').textContent).toContain('4812');
    expect(within(drawer).getByTestId('spend-cut-by_platform').textContent).toContain('1 of 12');
    expect(within(drawer).getByTestId('spend-cut-by_country').textContent).toContain('unknown');
    const cutChip = within(drawer).getAllByTestId(/^spend-cut-chip-/)[0];
    expect(cutChip.dataset.rag).toBe('red');
    expect(cutChip.dataset.confidence).toBe('provisional');
    fireEvent.click(within(drawer).getByTestId('spend-drill-signup_to_export_14d'));
    expect(onListUsers).toHaveBeenCalledTimes(1);
    const pick = onListUsers.mock.calls[0][0];
    expect(pick.outcome).toBe('lost');
    expect(pick.stages).toContain('signed_up');
    expect(pick.stages).toContain('export_pressed');
    expect(pick.stages).not.toContain('exported');
    expect(pick).not.toHaveProperty('count'); // the gate's n - k is not the list's definition (review follow-up 2026-11-06)
    fireEvent.click(screen.getByTestId('spend-diagnose-upload_failure'));
    fireEvent.click(screen.getByTestId('spend-drill-upload_failure'));
    expect(onShowUploadFailures).toHaveBeenCalledTimes(1);
  });

  it('an open drawer refetches when a refresh clears the diagnosis cache', () => {
    // Review follow-up 2026-11-06: after Refresh or a Real toggle the store empties the cache;
    // a drawer that is already open must read again instead of showing old cuts beside new numbers.
    const loaded = { upload_failure: { loading: false, error: null,
      data: { key: 'upload_failure', tier: 'B', cuts: { weekly: [], by_build: [], by_platform: [], by_country: [] } } } };
    const r = panel({ diagnosis: loaded });
    expand();
    fireEvent.click(screen.getByTestId('spend-diagnose-upload_failure'));
    expect(r.onDiagnose).not.toHaveBeenCalled();
    expect(screen.getByTestId('spend-diagnosis-upload_failure').textContent).not.toMatch(/loading/i);
    r.rerender(<SpendReadinessPanel data={r.data} loading={r.loading} error={r.error} onRefresh={r.onRefresh}
                                    onListUsers={r.onListUsers} onShowUploadFailures={r.onShowUploadFailures}
                                    onDiagnose={r.onDiagnose} diagnosis={{}} />);
    expect(r.onDiagnose).toHaveBeenCalledTimes(1);
    expect(r.onDiagnose).toHaveBeenCalledWith('upload_failure');
    expect(screen.getByTestId('spend-diagnose-upload_failure').getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the Diagnose toggle only where the backend marks the gate diagnosable; repeat purchase has none', () => {
    panel();
    expand();
    fireEvent.click(screen.getByTestId('spend-tier-C-toggle'));
    expect(screen.getByTestId('spend-gate-repeat_purchase')).toBeTruthy();
    expect(screen.queryByTestId('spend-diagnose-repeat_purchase')).toBeNull();
    expect(screen.getByTestId('spend-diagnose-payers_per_100')).toBeTruthy();
    expect(screen.queryByTestId('spend-diagnose-kickback_payers_per_100')).toBeNull();
    expect(screen.queryByTestId('spend-diagnose-money_ladder_n')).toBeNull();
  });

  it('with no payers the ladder is grey and the break-even row says no estimate yet, never $0.00', () => {
    // T14910 follow-up (2026-11-06): the backend sends null bounds and `no_estimate` when a
    // factor has no measurement; the panel must not print them as money.
    const missing = '0 payers in 180 d';
    const noData = {
      ...DATA,
      verdict: { headline: 'Not yet: fix the funnel.', all_green: false,
        line: 'Money ladder n 0 paywall, 0 bought red. Measurement flight blocked by 4 gate(s) (first: Visit to sign-up). '
          + 'Channels: Coach codes, credits grey, Meta Reels grey, Club placement grey. Break-even: no estimate yet (0 payers in 180 d).' },
      break_even: { ...DATA.break_even, point_cents: null, lower_cents: null, upper_cents: null, readable: false,
        no_estimate: missing, text: `no break-even yet: ${missing}`,
        inputs: { ...DATA.break_even.inputs, payers_per_signup: 0, revenue_per_payer_cents: null, variable_cents: null, signups: 40 } },
      channels: DATA.channels.map(c => (c.key === 'club_placement' ? c
        : { ...c, state: 'grey', confidence: null, reason: `no break-even yet: ${missing}` })),
    };
    panel({ data: noData });
    expect(screen.getByTestId('spend-verdict-line').textContent).not.toContain('$0.00');
    expand();
    fireEvent.click(screen.getByTestId('spend-tier-C-toggle'));
    const row = screen.getByTestId('spend-break-even').textContent;
    expect(row).toContain('no estimate yet');
    expect(row).toContain(missing);
    expect(row).not.toMatch(/\$0\.00|\$NaN|null/);
    fireEvent.click(screen.getByTestId('spend-channels-toggle'));
    for (const key of ['coach_credits', 'meta_reels']) {
      const c = screen.getByTestId(`spend-channel-chip-${key}`);
      expect(c.dataset.rag).toBe('grey');
      expect(c.hasAttribute('data-confidence')).toBe(false);
      expect(c.getAttribute('title')).toContain(missing);
    }
    expect(screen.getByTestId('spend-channels-line').textContent).toContain('Meta Reels grey');
  });

  it('shows loading and error states without hiding the headline once data exists', () => {
    panel({ data: null, loading: true });
    expect(screen.getByTestId('spend-readiness').textContent).toMatch(/loading/i);
    panel({ data: null, loading: false, error: 'HTTP 500' });
    expect(screen.getAllByText(/HTTP 500/).length).toBeGreaterThan(0);
  });

  it('the Refresh gesture calls onRefresh', () => {
    const { onRefresh } = panel();
    fireEvent.click(screen.getByRole('button', { name: /refresh spend readiness/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

// T14910 / T14900: gate 4's green threshold and the Journey map's finished->took_away target
// are the same number, in two languages.
describe('gate 4 threshold matches journeyTargets (T14910)', () => {
  it('FINISHED_TO_TOOK_AWAY_GREEN equals JOURNEY_TARGETS["finished->took_away"].target', () => {
    const file = path.join(__dirname, '..', '..', '..', '..', 'backend', 'app', 'services', 'spend_readiness_constants.py');
    const src = readFileSync(file, 'utf8');
    const match = src.match(/^FINISHED_TO_TOOK_AWAY_GREEN\s*=\s*(\d+)/m);
    if (!match) throw new Error('FINISHED_TO_TOOK_AWAY_GREEN not found in spend_readiness_constants.py');
    expect(Number(match[1])).toBe(JOURNEY_TARGETS['finished->took_away'].target);
    const floor = src.match(/^SMALL_N_FLOOR\s*=\s*(\d+)/m);
    expect(Number(floor[1])).toBe(20);
  });
});
