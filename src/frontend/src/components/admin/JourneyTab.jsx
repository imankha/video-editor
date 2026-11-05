import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useAdminStore } from '../../stores/adminStore';
import { JourneyFlowChart, formatRate } from './JourneyFlowChart';
import { groupOfStage } from './journeyFold';
import { RAG_STYLES, endToEndTransition, journeyTransitions, stageTransition, transitionChipText } from './journeyTargets';
import { RagChip } from './RagChip';
import { SpendReadinessPanel } from './SpendReadinessPanel';
import { StepInspector } from './StepInspector';

// T14010: Journey section of AdminScreen. Signup range, origin (campaign), build and
// the Real (exclude test) pill are AdminScreen's GLOBAL filters, read from adminStore so
// the map always describes the same population as the users list below it. Only the
// journey-specific controls are local view state (never persisted): conversion window,
// inactivity threshold, platform. A change re-queries the map (a read). Which stage groups
// are expanded on the map is JourneyView view state, never persisted. Full screen (T14730)
// is browser state mirrored into view state, never persisted.

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

// A row click selects the stage; the number is its own button that lists those users (T14740).
export function LossRanking({ loss, onSelectStage, onListUsers }) {
  if (!loss || loss.length === 0) {
    return <p className="text-xs text-gray-500">No judged losses yet.</p>;
  }
  return (
    <ol data-testid="journey-loss" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {loss.map((r, i) => (
        <li
          key={r.stage}
          className="text-gray-300 cursor-pointer"
          onClick={() => onSelectStage && onSelectStage(r.stage)}
        >
          <button type="button" data-testid={`journey-loss-${r.stage}`} className="text-left hover:text-white">
            <span className="text-gray-500">{i + 1}. </span>
            {r.label}
          </button>{' '}
          <button
            type="button"
            data-testid={`journey-loss-count-${r.stage}`}
            title="List these users in Users"
            onClick={ev => {
              ev.stopPropagation();
              onListUsers({ stages: [r.stage], label: r.label, outcome: 'lost', count: r.lost });
            }}
            className="text-white font-semibold hover:underline"
          >
            {r.lost} lost
          </button>{' '}
          <span className="text-amber-400 text-xs">({r.still_visiting} still visiting)</span>
        </li>
      ))}
    </ol>
  );
}

// T14900: what the transition marks on the map mean. Each word sits on its own mark, so the
// legend does not depend on colour either.
function RagLegend() {
  return (
    <div data-testid="journey-rag-legend" className="flex flex-wrap gap-x-4 gap-y-1">
      {Object.entries(RAG_STYLES).map(([rag, style]) => (
        <RagChip key={rag} rag={rag} text={style.word} />
      ))}
    </div>
  );
}

export function JourneyView({ data, filters, fit = false, onListUsers }) {
  const [selected, setSelected] = useState(null);
  // Inspector view state (never persisted): breakdown tab and the People outcome.
  const [by, setBy] = useState('platform');
  const [outcome, setOutcome] = useState('stuck');
  // Which collapsed groups are open: view state only, never persisted.
  const [expanded, setExpanded] = useState(() => new Set());
  const node = data.nodes.find(n => n.key === selected);
  const endToEnd = endToEndTransition(data.nodes);
  const selectedKey = node ? stageTransition(node.key) : null;
  const transition = journeyTransitions(data.nodes).find(t => t.key === selectedKey);
  const fetchJourneyStep = useAdminStore(s => s.fetchJourneyStep);
  const step = useAdminStore(s => s.journeyStep);
  const stepLoading = useAdminStore(s => s.journeyStepLoading);
  const stepError = useAdminStore(s => s.journeyStepError);
  const fetchUserDetail = useAdminStore(s => s.fetchUserDetail);
  const runJourneyRollup = useAdminStore(s => s.runJourneyRollup);
  const rollup = useAdminStore(s => s.journeyRollup);

  // Read-only: the inspector re-queries ITSELF when the stage, tab or a filter changes;
  // the map data above is not touched.
  useEffect(() => {
    if (selected && filters) fetchJourneyStep(selected, by, filters);
  }, [selected, by, filters, fetchJourneyStep]);

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
  // A drop ribbon opens its stage with that outcome pre-selected in People.
  const selectDrop = (stage, kind) => { setOutcome(kind); setSelected(stage); };
  // Run rollup click: the sweep, then re-read the open stage so "Where they left" shows the new run.
  const runRollup = async () => {
    const result = await runJourneyRollup();
    if (result && selected) fetchJourneyStep(selected, by, filters);
  };

  return (
    <div className="space-y-5">
      {endToEnd && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-xs uppercase text-gray-400">{endToEnd.label}</h3>
          <RagChip testId="journey-end-to-end" rag={endToEnd.rag} text={transitionChipText(endToEnd)} />
        </div>
      )}

      <div className="bg-white/5 rounded-lg p-3 border border-white/10">
        <h3 className="text-xs uppercase text-gray-400 mb-2">Loss ranking</h3>
        <LossRanking loss={data.loss} onSelectStage={selectStage} onListUsers={onListUsers} />
      </div>

      <JourneyFlowChart nodes={data.nodes} edges={data.edges} bands={data.bands}
                        selected={selected} onSelect={setSelected} onSelectDrop={selectDrop}
                        onListDropUsers={onListUsers}
                        expanded={expanded} onToggleGroup={toggleGroup} fit={fit} />

      <RagLegend />

      <p className="text-[11px] text-gray-500">
        Window {data.meta.window_days} d, inactive after {data.meta.inactive_days} d. Hatched = in window
        (pending, not judged). Amber = stuck (past the window, active recently). Gray = gone.
        Click a +N chip (or its gap) to show the stages between two milestones. Click a number
        to list those users in Users.
      </p>

      {node && (
        <div data-testid="journey-selected" className="text-xs text-gray-300 bg-white/5 rounded p-3 border border-white/10">
          <span className="font-semibold text-white">{node.label}</span>: reached {node.reached}, continued{' '}
          {node.continued} ({formatRate(node.continue_rate)}), in window {node.in_window}, stuck {node.stuck}, gone {node.gone}
        </div>
      )}

      {node && filters && (
        <StepInspector step={step && step.stage === selected ? step : null} loading={stepLoading}
                       error={stepError} by={by} onChangeBy={setBy} outcome={outcome}
                       onChangeOutcome={setOutcome} onOpenUser={fetchUserDetail}
                       rollup={rollup} onRunRollup={runRollup} transition={transition} />
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

// onShowUsers: bring the Users section into view after a drop-off count was clicked (T14740).
// onShowUploadFailures: open the Upload Failures section (a Spend readiness drill, T14910).
export function JourneyTab({ onShowUsers, onShowUploadFailures }) {
  const fetchJourney = useAdminStore(s => s.fetchJourney);
  const fetchSpendReadiness = useAdminStore(s => s.fetchSpendReadiness);
  const fetchSpendGateDiagnosis = useAdminStore(s => s.fetchSpendGateDiagnosis);
  const spendReadiness = useAdminStore(s => s.spendReadiness);
  const spendReadinessLoading = useAdminStore(s => s.spendReadinessLoading);
  const spendReadinessError = useAdminStore(s => s.spendReadinessError);
  const spendGateDiagnosis = useAdminStore(s => s.spendGateDiagnosis);
  const setJourneyUserFilter = useAdminStore(s => s.setJourneyUserFilter);
  const clearJourneyUserFilter = useAdminStore(s => s.clearJourneyUserFilter);
  const data = useAdminStore(s => s.journeyData);
  const loading = useAdminStore(s => s.journeyLoading);
  const error = useAdminStore(s => s.journeyError);
  const origin = useAdminStore(s => s.segmentOrigin);
  const from = useAdminStore(s => s.segmentFrom);
  const to = useAdminStore(s => s.segmentTo);
  const build = useAdminStore(s => s.segmentBuild);
  const country = useAdminStore(s => s.segmentCountry);
  const excludeTest = useAdminStore(s => s.excludeTest);

  const [platform, setPlatform] = useState('all');
  const [windowDays, setWindowDays] = useState(14);
  const [inactiveDays, setInactiveDays] = useState(14);
  const rootRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const filters = useMemo(() => ({
    from: from || undefined,
    to: to || undefined,
    origin: origin || undefined,
    build: build ?? undefined,
    country: country ?? undefined,
    platform: platform === 'all' ? undefined : platform,
    excludeTest,
    windowDays,
    inactiveDays,
  }), [from, to, origin, build, country, platform, excludeTest, windowDays, inactiveDays]);

  // Read-only: re-query the map when a global filter or a journey control changes.
  useEffect(() => { fetchJourney(filters); }, [fetchJourney, filters]);
  // T14910: the Spend readiness read follows only the Real pill; the map's own controls
  // (window, inactivity, platform, signup range) do not define the gates.
  useEffect(() => { fetchSpendReadiness(); }, [fetchSpendReadiness, excludeTest]);

  // The browser owns full screen (Esc leaves without a click), so follow its event.
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = () => {
    const change = isFullscreen ? document.exitFullscreen() : rootRef.current.requestFullscreen();
    change.catch(err => console.error('[Journey] full screen change refused', err));
  };
  // The window, inactivity and platform decide who counts as stuck or gone, so a listed
  // drop-off stops matching any number on screen when one of them changes.
  const changeControl = (setControl, current) => value => {
    if (value === current) return;
    setControl(value);
    clearJourneyUserFilter();
  };

  // Users sits outside the full screen element, so leave full screen before showing it.
  const listUsers = async pick => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(err => console.error('[Journey] full screen exit refused', err));
    }
    await setJourneyUserFilter({ ...pick, platform: filters.platform, windowDays, inactiveDays });
    onShowUsers();
  };

  const fullscreenLabel = isFullscreen ? 'Exit full screen' : 'Full screen';
  const FullscreenIcon = isFullscreen ? Minimize2 : Maximize2;

  return (
    <div
      ref={rootRef}
      data-testid="journey-root"
      className={`journey-fullscreen ${isFullscreen ? 'overflow-auto p-6 bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900' : ''}`}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <PillGroup label="Conversion window" options={DAY_OPTIONS} value={windowDays} onChange={changeControl(setWindowDays, windowDays)} />
          <PillGroup label="Inactive after" options={DAY_OPTIONS} value={inactiveDays} onChange={changeControl(setInactiveDays, inactiveDays)} />
          <PillGroup label="Platform" options={PLATFORM_OPTIONS} value={platform} onChange={changeControl(setPlatform, platform)} />
          <span className="text-[11px] text-gray-500">Signups, campaign, build, country and Real follow the filters above.</span>
        </div>
        {document.fullscreenEnabled && (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreenLabel}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full transition-colors text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20"
          >
            <FullscreenIcon size={12} aria-hidden="true" />
            {fullscreenLabel}
          </button>
        )}
      </div>

      <SpendReadinessPanel data={spendReadiness} loading={spendReadinessLoading} error={spendReadinessError}
                           onRefresh={fetchSpendReadiness} diagnosis={spendGateDiagnosis}
                           onDiagnose={fetchSpendGateDiagnosis} onListUsers={listUsers}
                           onShowUploadFailures={onShowUploadFailures} />

      {error && <p className="text-red-400 text-sm mb-2">Journey failed to load: {error}</p>}
      {loading && !data && <p className="text-gray-500 text-sm">Loading journey...</p>}
      {data && (
        <div className={loading ? 'opacity-60' : ''}>
          <JourneyView data={data} filters={filters} fit={isFullscreen} onListUsers={listUsers} />
        </div>
      )}
    </div>
  );
}
