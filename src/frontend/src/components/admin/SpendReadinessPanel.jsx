import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { RagChip } from './RagChip';
import { Toggle } from './Toggle';
import { GateDiagnosis } from './GateDiagnosis';
import { CHANNEL_RAG, fmtGateValue, fmtInterval, gateChipText, money } from './spendReadinessFormat';
import { fmtPct } from './formatNumber';

// T14910: "can we spend on ads yet?" Eleven read-only gates in three tiers (can we read a
// test / is the funnel clean / do the economics work), the tier to focus on, two verdicts
// (measurement flight allowed; channel economics), break-even per sign-up and the channel
// ladder. Collapsed by default with the verdict line always visible; Tier C and the ladder
// are one line each by default. Every chip is the shared RagChip with its interval in the
// title and data-confidence for the settled / provisional rendering. Nothing here persists:
// which sections are open is view state. Design: docs/plans/tasks/T14910-design.md.

const TIER_ORDER = ['A', 'B', 'C'];
const RAG_WORD = { green: 'green', yellow: 'yellow', red: 'red', grey: 'grey' };

function Legend() {
  return (
    <div data-testid="spend-legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
      <RagChip rag="green" confidence="settled" text="settled" title="the whole 95% interval is on one side of the deciding threshold" />
      <RagChip rag="yellow" confidence="provisional" text="provisional" title="the interval crosses a threshold; colour by the point estimate" />
      <RagChip rag="grey" text="under the floor" title="fewer than 20 judged; counts only" />
      <span>M measured, A assumption, B benchmark. Hover a chip for its interval.</span>
    </div>
  );
}

function ChipFor({ gate }) {
  const bits = [fmtInterval(gate.unit, gate.interval), gate.settle && gate.settle.text,
    gate.rag === 'grey' ? gate.unblock.text : null].filter(Boolean);
  return (
    <RagChip testId={`spend-chip-${gate.key}`} rag={gate.rag} confidence={gate.confidence}
             text={gateChipText(gate)} title={bits.join('; ') || gate.why} />
  );
}

function Recent({ gate }) {
  const r = gate.recent;
  if (!r) return <span className="text-gray-600">-</span>;
  const text = r.value == null ? `${r.k} of ${r.n}` : fmtGateValue(gate.unit, r.value);
  return (
    <span>
      <RagChip rag={r.rag} confidence={r.confidence} text={text} title={fmtInterval(gate.unit, r.interval) || `${r.k} of ${r.n}`} />
      <span className="text-gray-500"> n {r.n}</span>
    </span>
  );
}

function GateRow({ gate, isFocus, diagnosis, onDiagnose, onListUsers, onShowUploadFailures }) {
  const [open, setOpen] = useState(false);
  const diagnosable = gate.tier !== 'A' && gate.kind !== 'none';
  const toggleDiagnose = () => {
    const next = !open;
    setOpen(next);
    if (next && !diagnosis[gate.key]) onDiagnose(gate.key);
  };
  const interval = fmtInterval(gate.unit, gate.interval);
  return (
    <li data-testid={`spend-gate-${gate.key}`} data-gate={gate.key} data-focus={isFocus ? 'true' : undefined}
        className={`py-2 border-b border-white/5 text-xs text-gray-300 ${isFocus ? 'bg-purple-500/10 -mx-2 px-2 rounded' : ''}`}>
      <div className="grid grid-cols-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,1.8fr)] gap-x-3 gap-y-1 items-baseline">
        <div className="text-white font-medium" title={gate.why}>{gate.label}{isFocus && <span className="text-purple-300 text-[10px] ml-1">focus</span>}</div>
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <ChipFor gate={gate} />
          {interval && gate.rag !== 'grey' && <span className="text-gray-500">({interval})</span>}
          {gate.kind !== 'counts' && gate.kind !== 'none' && <span className="text-gray-500">n {gate.n}</span>}
          <span className="text-[10px] uppercase text-gray-500">{gate.label_kind}</span>
        </div>
        <div><span className="md:hidden text-gray-500">Last 30 d: </span><Recent gate={gate} /></div>
        <div className="text-gray-400"><span className="md:hidden text-gray-500">Target </span>{gate.target.text}</div>
        <div className="text-gray-400">{RAG_WORD[gate.rag]}{gate.confidence ? `, ${gate.confidence}` : ''}</div>
        <div className="col-span-2 md:col-span-1 space-y-0.5">
          {gate.unblock.text && <div data-testid={`spend-unblock-${gate.key}`} className="text-gray-400">{gate.unblock.text}</div>}
          {gate.caveats.length > 0 && (
            <div data-testid={`spend-caveat-${gate.key}`} className="text-amber-400">&#9888; {gate.caveats.join(' ')}</div>
          )}
          {gate.span && gate.span.since && <div className="text-gray-500">since {gate.span.since} ({gate.span.days} d)</div>}
          {gate.reference && (
            <div className="text-gray-500">
              reference {gate.reference.value == null ? `${gate.reference.k} of ${gate.reference.n}` : fmtGateValue(gate.unit, gate.reference.value)}, n {gate.reference.n} ({gate.reference.text})
            </div>
          )}
          {diagnosable && (
            <Toggle testId={`spend-diagnose-${gate.key}`} open={open} onClick={toggleDiagnose} className="text-purple-300">
              Diagnose
            </Toggle>
          )}
        </div>
      </div>
      {open && diagnosable && (
        <GateDiagnosis gate={gate} entry={diagnosis[gate.key]} onListUsers={onListUsers} onShowUploadFailures={onShowUploadFailures} />
      )}
    </li>
  );
}

function TierHeader({ tier, label, count, isFocus, waiting }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-purple-300 font-semibold">{tier}</span>
      <span className="text-xs uppercase text-gray-300">{label}</span>
      <span className="text-[11px] text-gray-500">{count} gates{isFocus ? ' · focus' : ''}{waiting ? ' · waiting on volume' : ''}</span>
    </span>
  );
}

function economicsLine(data) {
  const g7 = data.gates.find(g => g.key === 'revenue_per_payer');
  if (data.break_even.readable) {
    return `Economics: break-even ${money(data.break_even.point_cents)} per sign-up (at most ${money(data.break_even.upper_cents)}, A)`;
  }
  const need = g7 && g7.unblock.need;
  const months = need && need.eta_days != null ? `, about ${Math.max(1, Math.round(need.eta_days / 30))} months (A)` : '';
  return `Economics: not readable; ${need ? `${need.have} of ${need.floor} payers` : 'no payers'}${months}`;
}

function channelsLine(channels) {
  return `Channels: ${channels.map(c => `${c.label} ${c.state}${c.confidence === 'provisional' ? ' (provisional)' : ''}`).join(' · ')}`;
}

function ChannelRow({ c }) {
  const cost = c.cost_cents == null ? `$300 fee / ${c.n} sign-ups` : `${money(c.cost_cents)} ${c.label_kind}`;
  return (
    <li data-testid={`spend-channel-${c.key}`} className="grid grid-cols-2 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,2fr)] gap-x-3 py-1 border-b border-white/5 text-xs text-gray-300">
      <span className="text-white">{c.label}</span>
      <span title={c.note}>{cost}</span>
      <span className="text-gray-500">{c.n == null ? '-' : c.n}</span>
      <RagChip testId={`spend-channel-chip-${c.key}`} rag={CHANNEL_RAG[c.state]} confidence={c.confidence} text={c.state} title={c.reason} />
      <span className="col-span-2 md:col-span-1 text-gray-400">{c.reason}</span>
    </li>
  );
}

function Economics({ data }) {
  const [inputsOpen, setInputsOpen] = useState(false);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const be = data.break_even;
  return (
    <div className="mt-3 space-y-2 text-xs text-gray-300">
      <div data-testid="spend-break-even" className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="uppercase text-gray-400">Break-even per sign-up</span>
          {be.point_cents == null ? (
            // No sign-up or no payer: the backend sends null bounds and names the missing factor.
            <span data-testid="spend-break-even-none" className="text-gray-400 italic">no estimate yet ({be.no_estimate})</span>
          ) : (
            <>
              <span className="text-white font-semibold">{money(be.point_cents)}</span>
              <span className="text-gray-500">(at most {money(be.upper_cents)}, A{be.readable ? '' : '; not readable under the floor'})</span>
            </>
          )}
          <Toggle testId="spend-break-even-inputs" open={inputsOpen} onClick={() => setInputsOpen(o => !o)} className="text-purple-300">inputs</Toggle>
        </div>
        {inputsOpen && (
          <div className="text-gray-400">
            {be.text}
            {be.binding_text && <div className="text-amber-400 mt-1">{be.binding_text}</div>}
          </div>
        )}
      </div>
      <div>
        <Toggle testId="spend-channels-toggle" open={channelsOpen} onClick={() => setChannelsOpen(o => !o)} className="text-gray-300">
          <span data-testid="spend-channels-line">{channelsLine(data.channels)}</span>
        </Toggle>
        {channelsOpen && (
          <ul className="mt-1">
            <li className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.5fr)_minmax(0,0.7fr)_minmax(0,2fr)] gap-x-3 text-[10px] uppercase text-gray-500">
              <span>Channel</span><span>Cost / sign-up</span><span>N</span><span>State</span><span>Why</span>
            </li>
            {data.channels.map(c => <ChannelRow key={c.key} c={c} />)}
            <li className="pt-1 text-gray-500">Until a channel is GO, growth is the fix list, the share loop (K) and coach codes.</li>
          </ul>
        )}
      </div>
    </div>
  );
}

function Tier({ tier, data, diagnosis, onDiagnose, onListUsers, onShowUploadFailures }) {
  const [open, setOpen] = useState(tier !== 'C');
  const gates = data.gates.filter(g => g.tier === tier);
  const isFocus = !!data.focus && data.focus.tier === tier;
  const waiting = tier === 'C' && !isFocus && gates.some(g => g.rag === 'grey');
  const header = <TierHeader tier={tier} label={data.meta.tiers[tier].label} count={gates.length} isFocus={isFocus} waiting={waiting} />;
  return (
    <section data-testid={`spend-tier-${tier}`} data-focus={isFocus ? 'true' : undefined}
             className={`rounded-lg border p-3 ${isFocus ? 'border-purple-500/40 bg-purple-500/5' : 'border-white/10 bg-white/5'}`}>
      {tier === 'C' ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Toggle testId="spend-tier-C-toggle" open={open} onClick={() => setOpen(o => !o)}>{header}</Toggle>
          {!open && <span data-testid="spend-economics-line" className="text-xs text-gray-400">{economicsLine(data)}</span>}
        </div>
      ) : header}
      {open && (
        <>
          <ul className="mt-2">
            <li className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,1.8fr)] gap-x-3 text-[10px] uppercase text-gray-500">
              <span>Gate</span><span>Now ({data.meta.cohort_days} d)</span><span>Last {data.meta.recent_days} d</span><span>Target</span><span>Status</span><span>Unblock</span>
            </li>
            {gates.map(g => (
              <GateRow key={g.key} gate={g} isFocus={isFocus && data.focus.gate === g.key} diagnosis={diagnosis}
                       onDiagnose={onDiagnose} onListUsers={onListUsers} onShowUploadFailures={onShowUploadFailures} />
            ))}
          </ul>
          {tier === 'C' && <Economics data={data} />}
        </>
      )}
    </section>
  );
}

function Countries({ rows, days }) {
  if (!rows || rows.length === 0) return null;
  return (
    <p data-testid="spend-countries" className="text-xs text-gray-400">
      Sign-ups by country ({days} d): {rows.map(r => `${r.country} ${fmtPct(r.pct)}`).join(' · ')}
    </p>
  );
}

export function SpendReadinessPanel({ data, loading, error, onRefresh, onListUsers, onShowUploadFailures, diagnosis, onDiagnose }) {
  const [open, setOpen] = useState(false);
  const computedAt = data ? new Date(data.computed_at) : null;
  return (
    <div data-testid="spend-readiness" className="mb-5 bg-white/5 rounded-lg border border-white/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Toggle testId="spend-toggle" open={open} onClick={() => setOpen(o => !o)} className="text-gray-300">
          <span className="text-xs uppercase tracking-wider">Spend readiness</span>
          {data && <span data-testid="spend-headline" className="text-sm font-semibold text-white ml-2">{data.verdict.headline}</span>}
        </Toggle>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          {computedAt && <span>computed {computedAt.toISOString().slice(11, 16)} UTC · M unless marked</span>}
          <button type="button" onClick={onRefresh} aria-label="Refresh spend readiness" title="Refresh spend readiness"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-white/10 hover:border-white/20 text-gray-400 hover:text-gray-300">
            <RefreshCw size={11} aria-hidden="true" className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>
      {error && <p className="text-red-400 text-xs mt-1">Spend readiness failed to load: {error}</p>}
      {loading && !data && <p className="text-gray-500 text-xs mt-1">Loading spend readiness...</p>}
      {data && (
        <div className={loading ? 'opacity-60' : ''}>
          <p data-testid="spend-verdict-line" className="text-xs text-gray-300 mt-1">{data.verdict.line}</p>
          {open && (
            <div className="mt-3 space-y-3">
              <Legend />
              {TIER_ORDER.map(tier => (
                <Tier key={tier} tier={tier} data={data} diagnosis={diagnosis} onDiagnose={onDiagnose}
                      onListUsers={onListUsers} onShowUploadFailures={onShowUploadFailures} />
              ))}
              <Countries rows={data.signups_by_country} days={data.meta.cohort_days} />
              <p className="text-[11px] text-gray-500">
                {data.meta.small_n_floor} judged is the floor for a colour. Cohort gates judge sign-ups
                {' '}{data.meta.mature_days} to {data.meta.cohort_days + data.meta.mature_days} days old; the last {data.meta.recent_days} d
                column is the same definition on the newest mature sign-ups.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
