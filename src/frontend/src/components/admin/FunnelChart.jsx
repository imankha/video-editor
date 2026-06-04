import React from 'react';

const STAGES = [
  { key: 'signed_up', label: 'Signed Up' },
  { key: 'session', label: 'Session' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'clipped', label: 'Clipped' },
  { key: 'annotation_done', label: 'Annotation Done' },
  { key: 'framing_opened', label: 'Framing Opened' },
  { key: 'framing_exported', label: 'Framing Exported' },
  { key: 'overlay_exported', label: 'Overlay Exported' },
  { key: 'export_started', label: 'Export Started' },
  { key: 'exported', label: 'Exported' },
  { key: 'gallery_viewed', label: 'Gallery Viewed' },
  { key: 'downloaded', label: 'Downloaded' },
  { key: 'shared', label: 'Shared' },
  { key: 'invited', label: 'Invited' },
  { key: 'share_viewed', label: 'Share Viewed' },
  { key: 'purchased', label: 'Purchased' },
];

export function FunnelChart({ data }) {
  if (!data?.funnel?.length) {
    return <p className="text-gray-500 text-sm">No funnel data available.</p>;
  }

  const totals = data.funnel.find(r => r.origin === 'all') || data.funnel[0];
  const maxVal = totals[STAGES[0].key] || 1;

  return (
    <div className="space-y-2">
      {STAGES.map((stage, i) => {
        const val = totals[stage.key] || 0;
        const pct = Math.round((val / maxVal) * 100);
        const prevVal = i > 0 ? (totals[STAGES[i - 1].key] || 1) : val;
        const convPct = i > 0 ? Math.round((val / prevVal) * 100) : 100;

        return (
          <div key={stage.key} className="flex items-center gap-3">
            <div className="w-24 text-right text-gray-400 text-xs shrink-0">{stage.label}</div>
            <div className="flex-1 bg-white/5 rounded-full h-7 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 flex items-center px-3 transition-all"
                style={{ width: `${Math.max(pct, 2)}%` }}
              >
                <span className="text-white text-xs font-medium whitespace-nowrap">
                  {val}
                </span>
              </div>
            </div>
            <div className="w-16 text-gray-500 text-xs shrink-0">
              {i > 0 ? `${convPct}%` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}
