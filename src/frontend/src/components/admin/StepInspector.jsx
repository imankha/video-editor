import { formatRate } from './JourneyFlowChart';
import { fmt2, fmtPct } from './formatNumber';
import { transitionChipText } from './journeyTargets';
import { RagChip } from './RagChip';

// T14020: inspector for one Journey stage. Presentational: JourneyView owns the selected
// stage / outcome / breakdown tab (view state) and the store owns the read. Sections:
// counts, time to next, breakdown tabs, what they did instead, why signals, where they
// left (T14030 rollup; admin-run, stamped with its computed_at), people (opens the
// existing UserDetailPanel).

export const BREAKDOWN_TABS = [
  { value: 'platform', label: 'Platform' },
  { value: 'origin', label: 'Origin' },
  { value: 'build', label: 'Build' },
  { value: 'cohort_month', label: 'Signup month' },
  { value: 'country', label: 'Country' },
  // T14930: "arrival sport (landing page)" -- the visitor's interest at arrival, not the
  // profile's own sport.
  { value: 'arrival_sport', label: 'Arrival sport' },
  // T15010: the landing page that converted, bucketed by page class (sport/works-with/
  // vs/guides/audience/home/other), "unknown" for direct app arrivals and pre-T15010 signups.
  { value: 'landing_path', label: 'Landing page' },
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

const DWELL_BUCKETS = [
  { key: 'lt_10s', label: '<10 s' },
  { key: 's10_60', label: '10-60 s' },
  { key: 'm1_5', label: '1-5 min' },
  { key: 'm5_30', label: '5-30 min' },
  { key: 'gt_30m', label: '>30 min' },
];

export function formatDuration(seconds) {
  if (seconds == null) return '--';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(2)} h`;
  return `${(seconds / 86400).toFixed(2)} d`;
}

function Section({ title, note, children, testId }) {
  return (
    <section data-testid={testId} className="space-y-1.5">
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

// Users who skipped a stage counted as reaching it but have no timestamp for it (T14720).
function TimedNote({ next }) {
  const noun = next.continued === 1 ? 'user has' : 'users have';
  return (
    <p data-testid="step-next-timed" className="text-xs text-gray-500">
      {`${next.timed} of ${next.continued} ${noun} a timestamp for this stage`}
    </p>
  );
}

function TimeToNext({ next }) {
  if (next.continued === 0) {
    return <p className="text-xs text-gray-500">Nobody continued from this stage yet.</p>;
  }
  if (next.timed === 0) return <TimedNote next={next} />;
  const max = Math.max(1, ...BUCKETS.map(b => next.buckets[b.key]));
  return (
    <div data-testid="step-next" className="text-xs text-gray-300 space-y-1">
      <TimedNote next={next} />
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
            <td>{r.rate.pct == null ? `${r.rate.k} / ${r.rate.n}` : fmtPct(r.rate.pct)}</td>
            <td className="text-gray-500">{r.judged > 0 ? fmtPct(r.rate_lb) : '--'}</td>
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
              <span className="text-white font-semibold">{fmt2(r.lift)}x</span>{' '}
              <span className="text-gray-500">dropped {r.n_dropped} ({fmtPct(r.p_dropped * 100)}) vs
                continued {r.n_continued} ({fmtPct(r.p_continued * 100)})</span>
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

function RollupStamp({ left }) {
  const skipped = [left.below_head_skipped && `${left.below_head_skipped} below head skipped`,
    left.users_failed && `${left.users_failed} failed`].filter(Boolean);
  return (
    <p data-testid="step-left-stamp" className="text-[11px] text-gray-500">
      computed {left.computed_at.slice(0, 16).replace('T', ' ')} UTC over {left.users_walked} users
      {skipped.length > 0 && ` (${skipped.join(', ')})`}; all signups, not filtered
      {left.partial && <span className="text-amber-400"> -- some shards unreadable</span>}
    </p>
  );
}

function WhereLeft({ left, rollup, onRunRollup }) {
  const running = Boolean(rollup && rollup.running);
  return (
    <Section title="Where they left" note="(sessions that ended while at this stage)" testId="step-where-left">
      <div className="flex items-center gap-3">
        <button type="button" disabled={running} onClick={() => onRunRollup && onRunRollup()}
                className="text-[11px] px-2 py-0.5 rounded bg-white/10 text-gray-300 hover:text-white disabled:opacity-50">
          {running ? 'Running...' : 'Run rollup'}
        </button>
        {rollup && rollup.error && (
          <span data-testid="step-left-error" className="text-[11px] text-red-400">Rollup failed: {rollup.error}</span>
        )}
      </div>
      {!left || !left.computed_at ? (
        <p className="text-xs text-gray-500">No rollup yet. Run it to read exit screens and dwell from the user logs.</p>
      ) : (
        <>
          <RollupStamp left={left} />
          {left.exit_screens.length === 0 ? <p className="text-xs text-gray-500">No session exits at this stage.</p> : (
            <ul data-testid="step-left-exits" className="text-xs text-gray-300 space-y-0.5">
              {left.exit_screens.map(e => (
                <li key={e.screen}><span className="font-mono">{e.screen}</span>{' '}
                  <span className="text-white font-semibold">{e.users} / {left.exit_users}</span>
                  {e.share.pct !== null && <span className="text-gray-500"> ({fmtPct(e.share.pct)})</span>}
                </li>
              ))}
            </ul>
          )}
          {left.dwell.length > 0 && (
            <table data-testid="step-left-dwell" className="text-xs text-gray-300">
              <thead>
                <tr className="text-gray-500"><th className="text-left pr-3 font-normal">dwell</th>
                  {DWELL_BUCKETS.map(b => <th key={b.key} className="px-1.5 font-normal">{b.label}</th>)}</tr>
              </thead>
              <tbody>
                {left.dwell.map(d => (
                  <tr key={d.screen}><td className="font-mono pr-3">{d.screen}</td>
                    {DWELL_BUCKETS.map(b => <td key={b.key} className="px-1.5 text-center">{d.buckets[b.key]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
          {left.retry_bursts.length > 0 && (
            <p className="text-xs text-red-300/90">retry bursts: {left.retry_bursts.map(r => `${r.action} ${r.users}`).join(', ')}</p>
          )}
          {left.transitions_out.length > 0 && (
            <p className="text-xs text-gray-400">went on to (repeats included):{' '}
              {left.transitions_out.map(t => `${t.to_stage} ${t.users}`).join(', ')}</p>
          )}
        </>
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
                <span className="truncate">{p.is_deleted ? 'Deleted account' : (p.email || p.user_id)}</span>
                <span className="text-gray-500">{p.platform}</span>
                <span className="text-gray-500 ml-auto">{p.last_active_at ? p.last_active_at.slice(0, 10) : '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// transition (T14900): the target step this stage belongs to; absent for the last stage.
export function StepInspector({ step, loading, error, by, onChangeBy, outcome, onChangeOutcome, onOpenUser,
  rollup, onRunRollup, transition }) {
  if (error) return <p data-testid="step-inspector" className="text-red-400 text-sm">Inspector failed to load: {error}</p>;
  if (!step) return <p data-testid="step-inspector" className="text-gray-500 text-sm">Loading inspector...</p>;
  return (
    <div data-testid="step-inspector" className={`space-y-4 bg-white/5 rounded-lg p-4 border border-white/10 ${loading ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-white">{step.label}</h3>
        {transition && (
          <RagChip testId="step-rag-chip" rag={transition.rag} title={transition.label}
                   text={`${transition.from === step.stage ? '' : `${transition.label}: `}${transitionChipText(transition)}`} />
        )}
      </div>
      <Counts counts={step.counts} />
      <Section title="Time to next stage"><TimeToNext next={step.next} /></Section>
      <Section title="Breakdown" testId="step-breakdown-section">
        <Tabs label="Breakdown by" tabs={BREAKDOWN_TABS} value={by} onChange={onChangeBy} />
        <Breakdown rows={step.breakdown} />
      </Section>
      <Instead rows={step.instead} note={step.instead_note} />
      <Why why={step.why} />
      <WhereLeft left={step.left} rollup={rollup} onRunRollup={onRunRollup} />
      <People people={step.people} outcome={outcome} onOutcome={onChangeOutcome} onOpenUser={onOpenUser} />
    </div>
  );
}
