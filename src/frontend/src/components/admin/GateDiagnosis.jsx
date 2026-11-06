import { RagChip } from './RagChip';
import { fmtGateValue } from './spendReadinessFormat';

// T14910: one gate's Diagnose drawer -- where the loss is and whether the last fix moved it.
// Weekly series (interval band, target line), by build, by platform, by country, each row
// carrying the settled / provisional rendering; a row under the floor prints the count.
// Drill links open the existing tools with the gate's filter applied. Read-only.

// Users the gate counts as lost, expressed in Journey stages for the Users list (T14740).
// Gate 2 is "signed up, no true export within 14 d": every stage before `exported`.
// Gate 4 is "finished, not taken away": the stages between `finished` and `took_away`.
export const DRILLS = {
  signup_to_export_14d: {
    label: 'List sign-ups without an export',
    chipLabel: 'Sign-up without an export in 14 d',
    stages: ['signed_up', 'started', 'add_footage', 'footage_landed', 'clipped', 'frame_opened', 'framed', 'export_pressed'],
  },
  finished_to_took_away: {
    label: 'List users who did not take it away',
    chipLabel: 'Finished, not taken away',
    stages: ['finished', 'watched'],
  },
  upload_failure: { label: 'Open upload failures', panel: true },
};

const CUT_LABELS = { weekly: 'Weekly', by_build: 'By build', by_platform: 'By platform', by_country: 'By country' };
const CUT_UNITS = { weekly: 'week of', by_build: 'build', by_platform: 'platform', by_country: 'country' };

// Weekly values as a line with the 95% band and the green target as a dashed line. Weeks
// under the floor have no point: the band and line skip them.
function WeeklySparkline({ rows, gate }) {
  const w = 240;
  const h = 48;
  const valued = rows.filter(r => r.value != null);
  if (valued.length === 0) return null;
  const highs = valued.flatMap(r => (r.interval ? [r.interval[1]] : [r.value]));
  const max = Math.max(gate.target.green, ...highs, 1);
  const x = i => (rows.length === 1 ? w / 2 : (i / (rows.length - 1)) * w);
  const y = v => h - (v / max) * (h - 4) - 2;
  const points = rows.map((r, i) => (r.value == null ? null : `${x(i)},${y(r.value)}`)).filter(Boolean).join(' ');
  const band = [
    ...rows.map((r, i) => (r.interval ? `${x(i)},${y(r.interval[1])}` : null)),
    ...[...rows].reverse().map((r, i) => (r.interval ? `${x(rows.length - 1 - i)},${y(r.interval[0])}` : null)),
  ].filter(Boolean).join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label="Weekly values with the 95% band and the target">
      {band && <polygon points={band} fill="rgb(168, 85, 247)" fillOpacity="0.15" />}
      <line x1="0" x2={w} y1={y(gate.target.green)} y2={y(gate.target.green)} stroke="#4ade80" strokeDasharray="3 3" strokeWidth="1" />
      <polyline points={points} fill="none" stroke="rgb(168, 85, 247)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function CutRows({ cut, rows, gate }) {
  if (rows.length === 0) return <p className="text-gray-500">No rows.</p>;
  return (
    <ul className="space-y-0.5">
      {rows.map(r => (
        <li key={String(r.group)} className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-gray-400 min-w-[6rem]">{CUT_UNITS[cut]} {String(r.group)}</span>
          <RagChip testId={`spend-cut-chip-${cut}-${r.group}`} rag={r.rag} confidence={r.confidence} text={r.text}
                   title={r.interval ? `${fmtGateValue(gate.unit, r.interval[0])} to ${fmtGateValue(gate.unit, r.interval[1])}` : `${r.k} of ${r.n}`} />
          <span className="text-gray-500">n {r.n}</span>
        </li>
      ))}
    </ul>
  );
}

export function GateDiagnosis({ gate, entry, onListUsers, onShowUploadFailures }) {
  const drill = DRILLS[gate.key];
  const drillClick = () => {
    if (drill.panel) {
      onShowUploadFailures();
      return;
    }
    // No count: the gate's n - k (a 14 d window, mature cohort) is not what the Users list
    // counts (ever, all stages), so the chip would disagree with the rows under it.
    onListUsers({ stages: drill.stages, label: drill.chipLabel, outcome: 'lost' });
  };
  return (
    <div data-testid={`spend-diagnosis-${gate.key}`} className="mt-2 ml-2 pl-3 border-l border-white/10 space-y-3 text-xs text-gray-300">
      {drill && (
        <button type="button" data-testid={`spend-drill-${gate.key}`} onClick={drillClick}
                className="text-purple-300 hover:text-white underline">
          {drill.label}
        </button>
      )}
      {!entry || entry.loading ? <p className="text-gray-500">Loading diagnosis...</p> : null}
      {entry && entry.error && <p className="text-red-400">Diagnosis failed to load: {entry.error}</p>}
      {entry && entry.data && Object.entries(entry.data.cuts).map(([cut, rows]) => (
        <div key={cut} data-testid={`spend-cut-${cut}`}>
          <h5 className="text-[11px] uppercase text-gray-500 mb-1">{CUT_LABELS[cut]}</h5>
          {cut === 'weekly' && <WeeklySparkline rows={rows} gate={gate} />}
          <CutRows cut={cut} rows={rows} gate={gate} />
        </div>
      ))}
    </div>
  );
}
