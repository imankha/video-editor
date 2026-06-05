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
        return (
          <div key={key} className="bg-white/5 rounded-lg p-4 border border-white/10">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">{label}</div>
            <div className="text-white text-2xl font-bold">{displayVal}</div>
            <div className={`text-xs mt-0.5 ${up ? 'text-green-400' : 'text-red-400'}`}>
              {up ? '+' : ''}{card.change_pct}% vs last week
            </div>
            <Sparkline data={card.sparkline} />
          </div>
        );
      })}
    </div>
  );
}
