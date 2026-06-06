import React from 'react';

const PLATFORM_CONFIG = {
  'pwa-mobile':      { label: 'PWA Mobile',     color: 'rgb(168, 85, 247)', bg: 'rgba(168, 85, 247, 0.2)' },
  'pwa-desktop':     { label: 'PWA Desktop',    color: 'rgb(129, 140, 248)', bg: 'rgba(129, 140, 248, 0.2)' },
  'webapp-mobile':   { label: 'Web Mobile',     color: 'rgb(52, 211, 153)', bg: 'rgba(52, 211, 153, 0.2)' },
  'webapp-desktop':  { label: 'Web Desktop',    color: 'rgb(251, 191, 36)', bg: 'rgba(251, 191, 36, 0.2)' },
  'unknown':         { label: 'Unknown',        color: 'rgb(107, 114, 128)', bg: 'rgba(107, 114, 128, 0.2)' },
};

const KEY_ACTIONS = [
  'session_started', 'game_created', 'clip_created', 'export_completed',
  'share_completed', 'video_downloaded',
];

const ACTION_LABELS = {
  session_started: 'Sessions',
  game_created: 'Games',
  clip_created: 'Clips',
  export_completed: 'Exports',
  share_completed: 'Shares',
  video_downloaded: 'Downloads',
};

function StackedBar({ platforms, total }) {
  if (!total) return <div className="h-6 bg-white/5 rounded" />;
  return (
    <div className="flex h-6 rounded overflow-hidden">
      {platforms.map(p => {
        const pct = p.count / total * 100;
        if (pct < 0.5) return null;
        const cfg = PLATFORM_CONFIG[p.platform] || PLATFORM_CONFIG.unknown;
        return (
          <div
            key={p.platform}
            style={{ width: `${pct}%`, backgroundColor: cfg.color }}
            className="relative group"
            title={`${cfg.label}: ${p.count} (${p.pct}%)`}
          >
            {pct > 12 && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white font-medium">
                {Math.round(p.pct)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PlatformBreakdown({ data }) {
  if (!data) return null;

  const { platforms, by_action, total_users, total_actions } = data;
  const knownPlatforms = platforms.filter(p => p.platform !== 'unknown');
  const knownTotal = knownPlatforms.reduce((s, p) => s + p.actions, 0);

  const pwaActions = platforms
    .filter(p => p.platform.startsWith('pwa-'))
    .reduce((s, p) => s + p.actions, 0);
  const mobileActions = platforms
    .filter(p => p.platform.endsWith('-mobile'))
    .reduce((s, p) => s + p.actions, 0);
  const pwaPct = knownTotal ? Math.round(pwaActions / knownTotal * 100) : 0;
  const mobilePct = knownTotal ? Math.round(mobileActions / knownTotal * 100) : 0;

  const actionMap = {};
  for (const entry of (by_action || [])) {
    if (KEY_ACTIONS.includes(entry.action)) {
      actionMap[entry.action] = entry;
    }
  }

  return (
    <div className="bg-white/5 rounded-xl p-5 border border-white/10 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white text-sm font-semibold uppercase tracking-wider">Platform Breakdown</h3>
        <div className="flex gap-4 text-xs">
          <span className="text-gray-400">{total_users} users</span>
          <span className="text-gray-400">{total_actions} actions</span>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex gap-3 mb-4">
        <div className="bg-white/5 rounded-lg px-3 py-2 border border-white/10">
          <div className="text-gray-400 text-[10px] uppercase tracking-wider">PWA vs Web</div>
          <div className="text-white text-lg font-bold">{pwaPct}% <span className="text-gray-500 text-xs font-normal">PWA</span></div>
        </div>
        <div className="bg-white/5 rounded-lg px-3 py-2 border border-white/10">
          <div className="text-gray-400 text-[10px] uppercase tracking-wider">Mobile vs Desktop</div>
          <div className="text-white text-lg font-bold">{mobilePct}% <span className="text-gray-500 text-xs font-normal">Mobile</span></div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-3">
        {platforms.map(p => {
          const cfg = PLATFORM_CONFIG[p.platform] || PLATFORM_CONFIG.unknown;
          return (
            <div key={p.platform} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: cfg.color }} />
              <span className="text-gray-400 text-xs">{cfg.label}</span>
              <span className="text-gray-500 text-xs">({p.user_pct}%)</span>
            </div>
          );
        })}
      </div>

      {/* Overall bar */}
      <div className="mb-5">
        <div className="text-gray-500 text-[10px] uppercase tracking-wider mb-1">All Actions</div>
        <StackedBar platforms={platforms} total={total_actions} />
      </div>

      {/* Per-action bars */}
      <div className="space-y-2.5">
        {KEY_ACTIONS.map(action => {
          const entry = actionMap[action];
          if (!entry) return null;
          const actionTotal = entry.platforms.reduce((s, p) => s + p.count, 0);
          return (
            <div key={action}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-gray-400 text-xs">{ACTION_LABELS[action] || action}</span>
                <span className="text-gray-500 text-[10px]">{actionTotal}</span>
              </div>
              <StackedBar platforms={entry.platforms} total={actionTotal} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
