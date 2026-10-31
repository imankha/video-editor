import React, { useEffect, useMemo, useState } from 'react';
import { useAdminStore } from '../../stores/adminStore';
import { JourneyFlowChart, formatRate } from './JourneyFlowChart';

// T14010: Journey tab. Filters are ephemeral view state (never persisted); a change
// re-queries the map (a read). Window / inactivity are explicit controls so the operator
// sees how sensitive the stuck / gone split is.

const SIGNUP_RANGES = [
  { key: '30', label: 'last 30d' },
  { key: '90', label: 'last 90d' },
  { key: '365', label: 'last year' },
];
const DAY_OPTIONS = [7, 14, 21, 30, 60];
const PLATFORMS = ['all', 'ios', 'android', 'desktop', 'unknown'];

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const selectCls = 'bg-gray-900 border border-white/10 rounded px-2 py-1 text-xs text-gray-200';

function Select({ label, value, onChange, children }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-gray-400">
      {label}
      <select aria-label={label} className={selectCls} value={value} onChange={e => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

export function LossRanking({ loss }) {
  if (!loss || loss.length === 0) {
    return <p className="text-xs text-gray-500">No judged losses yet.</p>;
  }
  return (
    <ol data-testid="journey-loss" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {loss.map((r, i) => (
        <li key={r.stage} className="text-gray-300">
          <span className="text-gray-500">{i + 1}. </span>
          {r.label}{' '}
          <span className="text-white font-semibold">{r.lost} lost</span>{' '}
          <span className="text-amber-400 text-xs">({r.still_visiting} still visiting)</span>
        </li>
      ))}
    </ol>
  );
}

export function JourneyView({ data }) {
  const [selected, setSelected] = useState(null);
  const node = data.nodes.find(n => n.key === selected);
  return (
    <div className="space-y-5">
      <div className="bg-white/5 rounded-lg p-3 border border-white/10">
        <h3 className="text-xs uppercase text-gray-400 mb-2">Loss ranking</h3>
        <LossRanking loss={data.loss} />
      </div>

      <JourneyFlowChart nodes={data.nodes} edges={data.edges} bands={data.bands}
                        selected={selected} onSelect={setSelected} />

      <p className="text-[11px] text-gray-500">
        Window {data.meta.window_days} d, inactive after {data.meta.inactive_days} d. Hatched = in window
        (pending, not judged). Amber = stuck (past the window, active recently). Gray = gone.
        Dashed ribbons skip stages.
      </p>

      {node && (
        <div data-testid="journey-selected" className="text-xs text-gray-300 bg-white/5 rounded p-3 border border-white/10">
          <span className="font-semibold text-white">{node.label}</span>: reached {node.reached}, continued{' '}
          {node.continued} ({formatRate(node.continue_rate)}), in window {node.in_window}, stuck {node.stuck}, gone {node.gone}
        </div>
      )}

      {data.money && data.money.nodes.length > 0 && (
        <div data-testid="journey-money" className="bg-white/5 rounded-lg p-3 border border-white/10">
          <h3 className="text-xs uppercase text-gray-400 mb-2">Money</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-300">
            {data.money.nodes.map((n, i) => (
              <React.Fragment key={n.key}>
                {i > 0 && <span className="text-gray-600">&rarr;</span>}
                <span>
                  {n.label}{' '}
                  <span className="text-white font-semibold">{n.no_data ? 'no data' : n.reached}</span>
                  {n.partial_from && <span className="text-amber-400 text-[10px]"> data from {n.partial_from}</span>}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function JourneyTab() {
  const fetchJourney = useAdminStore(s => s.fetchJourney);
  const data = useAdminStore(s => s.journeyData);
  const loading = useAdminStore(s => s.journeyLoading);
  const error = useAdminStore(s => s.journeyError);
  const buildsData = useAdminStore(s => s.buildsData);

  const [range, setRange] = useState('90');
  const [origin, setOrigin] = useState('all');
  const [build, setBuild] = useState('');
  const [platform, setPlatform] = useState('all');
  const [excludeTest, setExcludeTest] = useState(true);
  const [windowDays, setWindowDays] = useState(14);
  const [inactiveDays, setInactiveDays] = useState(14);
  const [steps, setSteps] = useState('compact');

  const filters = useMemo(() => ({
    from: isoDaysAgo(Number(range)),
    origin,
    build: build || undefined,
    platform: platform === 'all' ? undefined : platform,
    excludeTest,
    windowDays,
    inactiveDays,
    steps,
  }), [range, origin, build, platform, excludeTest, windowDays, inactiveDays, steps]);

  // Read-only: re-query the map when a control changes. No write path.
  useEffect(() => { fetchJourney(filters); }, [fetchJourney, filters]);

  const buildOptions = (buildsData && buildsData.builds) || [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <Select label="Signups" value={range} onChange={setRange}>
          {SIGNUP_RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </Select>
        <Select label="Origin" value={origin} onChange={setOrigin}>
          <option value="all">all</option>
          <option value="organic">organic</option>
          <option value="paid">paid</option>
          <option value="referral">referral</option>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          Build
          <input aria-label="Build" className={`${selectCls} w-20`} inputMode="numeric" placeholder="all"
                 value={build} onChange={e => setBuild(e.target.value.replace(/\D/g, ''))}
                 list="journey-builds" />
          <datalist id="journey-builds">
            {buildOptions.map(b => <option key={b.build} value={b.build} />)}
          </datalist>
        </label>
        <Select label="Platform" value={platform} onChange={setPlatform}>
          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select label="Conversion window" value={windowDays} onChange={v => setWindowDays(Number(v))}>
          {DAY_OPTIONS.map(d => <option key={d} value={d}>{d}d</option>)}
        </Select>
        <Select label="Inactive after" value={inactiveDays} onChange={v => setInactiveDays(Number(v))}>
          {DAY_OPTIONS.map(d => <option key={d} value={d}>{d}d</option>)}
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={excludeTest} onChange={e => setExcludeTest(e.target.checked)} />
          exclude test
        </label>
        <div className="flex items-center gap-1">
          {['compact', 'full'].map(s => (
            <button key={s} onClick={() => setSteps(s)}
              className={`px-2 py-1 text-xs rounded ${steps === s
                ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
                : 'text-gray-400 border border-white/10'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-red-400 text-sm mb-2">Journey failed to load: {error}</p>}
      {loading && !data && <p className="text-gray-500 text-sm">Loading journey...</p>}
      {data && (
        <div className={loading ? 'opacity-60' : ''}>
          <JourneyView data={data} />
        </div>
      )}
    </div>
  );
}
