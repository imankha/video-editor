import React, { useEffect, useMemo, useState } from 'react';
import { useAdminStore } from '../../stores/adminStore';
import { JourneyFlowChart, formatRate } from './JourneyFlowChart';
import { groupOfStage } from './journeyFold';

// T14010: Journey section of AdminScreen. Signup range, origin (campaign), build and
// the Real (exclude test) pill are AdminScreen's GLOBAL filters, read from adminStore so
// the map always describes the same population as the users list below it. Only the
// journey-specific controls are local view state (never persisted): conversion window,
// inactivity threshold, platform. A change re-queries the map (a read). Which stage groups
// are expanded on the map is JourneyView view state, never persisted.

const DAY_OPTIONS = [7, 14, 30].map(d => ({ value: d, label: `${d}d` }));
// Device family: the endpoint matches pwa-<family> and webapp-<family>. The app records no
// iOS vs Android split, so there is no iPhone / Android pill.
const PLATFORM_OPTIONS = [
  { value: 'all', label: 'all' },
  { value: 'mobile', label: 'mobile' },
  { value: 'desktop', label: 'desktop' },
];

// Segmented pill group, same look as the T13990 dimension pills: one pressed button.
function PillGroup({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <span className="text-gray-500 text-xs mr-1">{label}</span>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
            value === o.value
              ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
              : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function LossRanking({ loss, onSelectStage }) {
  if (!loss || loss.length === 0) {
    return <p className="text-xs text-gray-500">No judged losses yet.</p>;
  }
  return (
    <ol data-testid="journey-loss" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {loss.map((r, i) => (
        <li key={r.stage} className="text-gray-300">
          <button
            type="button"
            data-testid={`journey-loss-${r.stage}`}
            onClick={() => onSelectStage && onSelectStage(r.stage)}
            className="text-left hover:text-white"
          >
            <span className="text-gray-500">{i + 1}. </span>
            {r.label}{' '}
            <span className="text-white font-semibold">{r.lost} lost</span>{' '}
            <span className="text-amber-400 text-xs">({r.still_visiting} still visiting)</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export function JourneyView({ data }) {
  const [selected, setSelected] = useState(null);
  // Which collapsed groups are open: view state only, never persisted.
  const [expanded, setExpanded] = useState(() => new Set());
  const node = data.nodes.find(n => n.key === selected);

  const toggleGroup = groupKey => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
    return next;
  });
  // Loss ranking keeps 14-stage granularity: open the group hiding the stage, then select it.
  const selectStage = stage => {
    const group = groupOfStage(data.nodes, stage);
    if (group) setExpanded(prev => (prev.has(group.key) ? prev : new Set(prev).add(group.key)));
    setSelected(stage);
  };

  return (
    <div className="space-y-5">
      <div className="bg-white/5 rounded-lg p-3 border border-white/10">
        <h3 className="text-xs uppercase text-gray-400 mb-2">Loss ranking</h3>
        <LossRanking loss={data.loss} onSelectStage={selectStage} />
      </div>

      <JourneyFlowChart nodes={data.nodes} edges={data.edges} bands={data.bands}
                        selected={selected} onSelect={setSelected}
                        expanded={expanded} onToggleGroup={toggleGroup} />

      <p className="text-[11px] text-gray-500">
        Window {data.meta.window_days} d, inactive after {data.meta.inactive_days} d. Hatched = in window
        (pending, not judged). Amber = stuck (past the window, active recently). Gray = gone.
        Dashed ribbons skip stages. Click a +N chip (or its gap) to show the stages between two milestones.
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
  const origin = useAdminStore(s => s.segmentOrigin);
  const from = useAdminStore(s => s.segmentFrom);
  const to = useAdminStore(s => s.segmentTo);
  const build = useAdminStore(s => s.segmentBuild);
  const excludeTest = useAdminStore(s => s.excludeTest);

  const [platform, setPlatform] = useState('all');
  const [windowDays, setWindowDays] = useState(14);
  const [inactiveDays, setInactiveDays] = useState(14);

  const filters = useMemo(() => ({
    from: from || undefined,
    to: to || undefined,
    origin: origin || undefined,
    build: build ?? undefined,
    platform: platform === 'all' ? undefined : platform,
    excludeTest,
    windowDays,
    inactiveDays,
  }), [from, to, origin, build, platform, excludeTest, windowDays, inactiveDays]);

  // Read-only: re-query the map when a global filter or a journey control changes.
  useEffect(() => { fetchJourney(filters); }, [fetchJourney, filters]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <PillGroup label="Conversion window" options={DAY_OPTIONS} value={windowDays} onChange={setWindowDays} />
        <PillGroup label="Inactive after" options={DAY_OPTIONS} value={inactiveDays} onChange={setInactiveDays} />
        <PillGroup label="Platform" options={PLATFORM_OPTIONS} value={platform} onChange={setPlatform} />
        <span className="text-[11px] text-gray-500">Signups, campaign, build and Real follow the filters above.</span>
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
