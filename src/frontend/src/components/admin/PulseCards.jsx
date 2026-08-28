import React from 'react';

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

const CARD_LABELS = {
  signups: 'Signups',
  exports: 'Exports',
  active_users: 'Active Users',
  revenue: 'Revenue',
  viral_conversion: 'Viral Conv.',
  // T7510: durable-upload success rate (game_upload_succeeded / attempts).
  upload_success_rate: 'Upload Success',
};

export function PulseCards({ data }) {
  if (!data?.cards) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {Object.entries(CARD_LABELS).map(([key, label]) => {
        const card = data.cards[key];
        if (!card) return null;
        const up = card.change_pct >= 0;
        let displayVal = card.today;
        if (key === 'revenue') displayVal = `$${((card.today || 0) / 100).toFixed(2)}`;
        if (key === 'viral_conversion') displayVal = `${card.today || 0}%`;
        // T7510: upload success rate is null when there were no attempts -> "--".
        if (key === 'upload_success_rate') {
          displayVal = card.today == null ? '--' : `${card.today}%`;
        }
        return (
          <div key={key} className="bg-white/5 rounded-lg p-4 border border-white/10">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">{label}</div>
            <div className="text-white text-2xl font-bold">{displayVal}</div>
            {key === 'upload_success_rate' ? (
              <div className="text-xs mt-0.5 text-gray-400">
                {card.succeeded ?? 0}/{card.attempts ?? 0} succeeded
              </div>
            ) : (
              <div className={`text-xs mt-0.5 ${up ? 'text-green-400' : 'text-red-400'}`}>
                {/* T7990: the card value is a single day and change_pct compares it to the
                    SAME WEEKDAY one week prior (sparkline[-1] vs sparkline[-8]), not a
                    weekly rollup. Say "same day last week" so the tile isn't misread as a
                    weekly total. */}
                {up ? '+' : ''}{card.change_pct}% vs same day last week
              </div>
            )}
            <Sparkline data={card.sparkline} />
          </div>
        );
      })}
    </div>
  );
}
