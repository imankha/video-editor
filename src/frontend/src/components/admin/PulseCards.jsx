function Sparkline({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const w = 120;
  const h = 40;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 4)}`
  ).join(' ');

  return (
    <svg width={w} height={h} className="mt-2">
      <polyline
        points={points}
        fill="none"
        stroke="rgb(168, 85, 247)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// T13990: Signups, Revenue and Upload Success are dimension-table columns now, so the
// cards carry only the remaining KPIs, all for the active selection + filter pills.
// Daily-flow cards: today vs the same weekday last week, with a 30-day sparkline.
const FLOW_CARDS = {
  exports: 'Exports',
  active_users: 'Active Users',
  viral_conversion: 'Viral Conv.',
};

// Population cards: one value for the filtered population (`pulse.population`).
const POPULATION_CARDS = [
  { key: 'avg_exports', label: 'Avg Exports', hint: 'exports per exporting user', format: v => `${v}` },
  { key: 'time_to_export_days', label: 'Time-to-Export', hint: 'median, signup to first export', format: v => `${v}d` },
  { key: 'return_7d_pct', label: '7d Return', hint: 'active 7+ days after signup', format: v => `${v}%` },
];

export function PulseCards({ data }) {
  if (!data?.cards) return null;

  // T8170: the T8160 outage sat at 29% upload success for ~2 days with nothing
  // on screen to notice it -- a bug report from a paying customer surfaced it.
  // The backend already computes this from a real threshold+sample-size guard
  // (never a false alarm on a quiet day); render it unmissably, not just as a
  // red number buried in a 4-column grid.
  const uploadAlarm = data.cards.upload_success_rate?.alarm;

  return (
    <>
      {uploadAlarm && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-500 bg-red-900/40 px-4 py-3 text-red-200 font-semibold"
        >
          Upload success rate has collapsed to {data.cards.upload_success_rate.today}%
          ({data.cards.upload_success_rate.succeeded}/{data.cards.upload_success_rate.attempts} succeeded today).
          Investigate the upload pipeline now.
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {Object.entries(FLOW_CARDS).map(([key, label]) => {
          const card = data.cards[key];
          if (!card) return null;
          const up = card.change_pct >= 0;
          let displayVal = card.today;
          // T7960: viral_conversion is referral conversion (referred/total signups), bounded
          // 0-100%. null when there were no signups in the window -> honest "--", not a fake 0%.
          if (key === 'viral_conversion') {
            displayVal = card.today == null ? '--' : `${card.today}%`;
          }
          return (
            <div key={key} data-testid="pulse-card" className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div data-testid="pulse-card-label" className="text-gray-400 text-xs uppercase tracking-wider mb-1">{label}</div>
              <div className="text-2xl font-bold text-white">{displayVal}</div>
              <div className={`text-xs mt-0.5 ${up ? 'text-green-400' : 'text-red-400'}`}>
                {/* T7990: the card value is a single day and change_pct compares it to the
                    SAME WEEKDAY one week prior (sparkline[-1] vs sparkline[-8]), not a
                    weekly rollup. Say "same day last week" so the tile isn't misread as a
                    weekly total. */}
                {up ? '+' : ''}{card.change_pct}% vs same day last week
              </div>
              <Sparkline data={card.sparkline} />
            </div>
          );
        })}
        {data.population && POPULATION_CARDS.map(({ key, label, hint, format }) => {
          const value = data.population[key];
          return (
            <div key={key} data-testid="pulse-card" className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div data-testid="pulse-card-label" className="text-gray-400 text-xs uppercase tracking-wider mb-1">{label}</div>
              <div className="text-2xl font-bold text-white">{value == null ? '--' : format(value)}</div>
              <div className="text-xs mt-0.5 text-gray-400">{hint}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
