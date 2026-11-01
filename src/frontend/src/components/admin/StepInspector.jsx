import { formatRate } from './JourneyFlowChart';

// T14020: inspector for one Journey stage. Presentational: JourneyView owns the selected
// stage / outcome / breakdown tab (view state) and the store owns the read. Sections:
// counts, time to next, breakdown tabs, what they did instead, why signals, where they
// left (ghosted until T14030), people (opens the existing UserDetailPanel).

export const BREAKDOWN_TABS = [
  { value: 'platform', label: 'Platform' },
  { value: 'origin', label: 'Origin' },
  { value: 'build', label: 'Build' },
  { value: 'cohort_month', label: 'Signup month' },
];
const OUTCOMES = [
  { value: 'stuck', label: 'stuck' },
  { value: 'gone', label: 'gone' },
  { value: 'in_window', label: 'in window' },
];
const BUCKETS = [
  { key: 'lt_1h', label: '<1h' },
  { key: 'same_day', label: 'same day' },
  { key: 'd2_3', label: '2-3d' },
  { key: 'd4_14', label: '4-14d' },
  { key: 'gt_14d', label: '>14d' },
];

export function formatDuration(seconds) {
  if (seconds == null) return '--';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} d`;
}

function Section({ title, note, children, ghost = false, testId }) {
  return (
    <section data-testid={testId} className={`space-y-1.5 ${ghost ? 'opacity-40' : ''}`}>
      <h4 className="text-[11px] uppercase tracking-wide text-gray-400">
        {title}{note && <span className="normal-case text-gray-500 ml-2">{note}</span>}
      </h4>
      {children}
    </section>
  );
}

function Tabs({ label, tabs, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {tabs.map(t => (
        <button key={t.value} type="button" aria-pressed={value === t.value}
                onClick={() => onChange(t.value)}
                className={`px-2 py-0.5 text-[11px] rounded-full border ${
                  value === t.value
                    ? 'bg-purple-500/30 text-purple-300 border-purple-500/40'
                    : 'text-gray-400 border-white/10 hover:border-white/20'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Counts({ counts }) {
  const cell = (label, v, cls = 'text-white') => (
    <div key={label}><div className="text-gray-500 text-[10px] uppercase">{label}</div>
      <div className={`font-semibold tabular-nums ${cls}`}>{v}</div></div>
  );
  return (
    <div data-testid="step-counts" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {cell('reached', counts.reached)}
      {cell('continued', `${counts.continued} (${formatRate(counts.continue_rate)})`)}
      {cell('stuck', counts.stuck, 'text-amber-400')}
      {cell('gone', counts.gone, 'text-gray-300')}
      {cell('in window', counts.in_window, 'text-gray-400')}
    </div>
  );
}

function TimeToNext({ next }) {
  if (next.n === 0 && next.out_of_order === 0) {
    return <p className="text-xs text-gray-500">Nobody continued from this stage yet.</p>;
  }
  const max = Math.max(1, ...BUCKETS.map(b => next.buckets[b.key]));
  return (
    <div data-testid="step-next" className="text-xs text-gray-300 space-y-1">
      <div>
        median <span className="text-white font-semibold">{formatDuration(next.median_s)}</span>
        {' | '}p75 <span className="text-white font-semibold">{formatDuration(next.p75_s)}</span>
        {' | '}n {next.n}
        {next.out_of_order > 0 && (
          <span data-testid="step-out-of-order" className="text-amber-400"> | out of order: {next.out_of_order}</span>
        )}
      </div>
      <div className="flex gap-3">
        {BUCKETS.map(b => (
          <div key={b.key} className="text-center">
            <div className="h-6 w-8 flex items-end">
              <div className="w-full bg-purple-400/60 rounded-sm"
                   style={{ height: `${(next.buckets[b.key] / max) * 100}%` }} />
            </div>
            <div className="text-gray-500 text-[10px]">{b.label}</div>
            <div className="tabular-nums">{next.buckets[b.key]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Breakdown({ rows }) {
  if (rows.length === 0) return <p className="text-xs text-gray-500">No users.</p>;
  return (
    <table data-testid="step-breakdown" className="w-full text-xs">
      <thead><tr className="text-gray-500 text-left">
        <th className="py-1">value</th><th>reached</th><th>stuck</th><th>gone</th><th>continue</th><th>Wilson lb</th>
      </tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key} className="border-t border-white/5 text-gray-300 tabular-nums">
            <td className="py-1 font-mono">{r.key}</td>
            <td>{r.reached}</td>
            <td className="text-amber-400">{r.stuck}</td>
            <td>{r.gone}</td>
            <td>{r.rate.pct == null ? `${r.rate.k} / ${r.rate.n}` : `${r.rate.pct}%`}</td>
            <td className="text-gray-500">{r.judged > 0 ? `${r.rate_lb}%` : '--'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Instead({ rows, note }) {
  return (
    <Section title="What they did instead" note={`(${note}; needs 5+ users on both sides)`} testId="step-instead">
      {rows.length === 0 ? <p className="text-xs text-gray-500">No side action clears the bar.</p> : (
        <ul className="text-xs text-gray-300 space-y-0.5">
          {rows.map(r => (
            <li key={r.action} className="tabular-nums">
              <span className="font-mono">{r.action}</span>{' '}
              <span className="text-white font-semibold">{r.lift}x</span>{' '}
              <span className="text-gray-500">dropped {r.n_dropped} ({Math.round(r.p_dropped * 100)}%) vs
                continued {r.n_continued} ({Math.round(r.p_continued * 100)}%)</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Why({ why }) {
  const bursts = why.retry_bursts;
  const empty = why.failures.length === 0 && why.impressions.length === 0 && !(bursts && bursts.with_bursts);
  return (
    <Section title="Why signals" note="(users who stopped here)" testId="step-why">
      {empty ? <p className="text-xs text-gray-500">No failures, impressions or retry bursts.</p> : (
        <ul className="text-xs text-gray-300 space-y-0.5">
          {why.failures.map(f => (
            <li key={`${f.event}:${f.reason}`}><span className="font-mono">{f.event}</span>: {f.reason}{' '}
              <span className="text-white font-semibold">{f.users}</span></li>
          ))}
          {why.impressions.map(i => (
            <li key={i.slug}><span className="font-mono">{i.slug}</span>{' '}
              <span className="text-white font-semibold">{i.users}</span></li>
          ))}
          {bursts && bursts.with_bursts > 0 && (
            <li data-testid="step-retry-bursts" className="text-red-300/90">
              retry bursts: {bursts.with_bursts} of {bursts.sampled} sampled users
              ({Object.entries(bursts.by_action).map(([a, n]) => `${a} ${n}`).join(', ')})
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

function People({ people, outcome, onOutcome, onOpenUser }) {
  const list = people[outcome] || [];
  return (
    <Section title="People" testId="step-people">
      <Tabs label="People outcome" tabs={OUTCOMES.map(o => ({ ...o, label: `${o.label} ${(people[o.value] || []).length}` }))}
            value={outcome} onChange={onOutcome} />
      {list.length === 0 ? <p className="text-xs text-gray-500">Nobody.</p> : (
        <ul className="text-xs max-h-48 overflow-y-auto">
          {list.map(p => (
            <li key={p.user_id}>
              <button type="button" data-testid={`step-person-${p.user_id}`}
                      onClick={() => onOpenUser && onOpenUser(p.user_id)}
                      className="w-full text-left py-0.5 text-gray-300 hover:text-white flex gap-3">
                <span className="truncate">{p.email || p.user_id}</span>
                <span className="text-gray-500">{p.platform}</span>
                <span className="text-gray-500 ml-auto">{p.last_active_at.slice(0, 10)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function StepInspector({ step, loading, error, by, onChangeBy, outcome, onChangeOutcome, onOpenUser }) {
  if (error) return <p data-testid="step-inspector" className="text-red-400 text-sm">Inspector failed to load: {error}</p>;
  if (!step) return <p data-testid="step-inspector" className="text-gray-500 text-sm">Loading inspector...</p>;
  return (
    <div data-testid="step-inspector" className={`space-y-4 bg-white/5 rounded-lg p-4 border border-white/10 ${loading ? 'opacity-60' : ''}`}>
      <h3 className="text-sm font-semibold text-white">{step.label}</h3>
      <Counts counts={step.counts} />
      <Section title="Time to next stage"><TimeToNext next={step.next} /></Section>
      <Section title="Breakdown" testId="step-breakdown-section">
        <Tabs label="Breakdown by" tabs={BREAKDOWN_TABS} value={by} onChange={onChangeBy} />
        <Breakdown rows={step.breakdown} />
      </Section>
      <Instead rows={step.instead} note={step.instead_note} />
      <Why why={step.why} />
      <Section title="Where they left" note="(coming with T14030)" ghost testId="step-where-left">
        <p className="text-xs text-gray-500">Last screen and dwell time arrive with the exit rollup.</p>
      </Section>
      <People people={step.people} outcome={outcome} onOutcome={onChangeOutcome} onOpenUser={onOpenUser} />
    </div>
  );
}
