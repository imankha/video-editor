import React from 'react';

const GRID_CELLS = [
  { key: 'pwa-mobile',    row: 'PWA',    col: 'Mobile',  color: 'rgb(168, 85, 247)' },
  { key: 'pwa-desktop',   row: 'PWA',    col: 'Desktop', color: 'rgb(129, 140, 248)' },
  { key: 'webapp-mobile', row: 'Website', col: 'Mobile',  color: 'rgb(52, 211, 153)' },
  { key: 'webapp-desktop',row: 'Website', col: 'Desktop', color: 'rgb(251, 191, 36)' },
];

function buildMatrix(platforms) {
  const lookup = {};
  for (const p of platforms) lookup[p.platform] = p;

  const known = platforms.filter(p => p.platform !== 'unknown');
  const knownUsers = known.reduce((s, p) => s + p.users, 0);
  const knownActions = known.reduce((s, p) => s + p.actions, 0);
  const unknownEntry = lookup['unknown'];

  const cells = GRID_CELLS.map(c => {
    const entry = lookup[c.key];
    return {
      ...c,
      users: entry?.users || 0,
      actions: entry?.actions || 0,
      userPct: knownUsers ? Math.round((entry?.users || 0) / knownUsers * 100) : 0,
      actionPct: knownActions ? Math.round((entry?.actions || 0) / knownActions * 100) : 0,
    };
  });

  const pwaUsers = cells.filter(c => c.row === 'PWA').reduce((s, c) => s + c.users, 0);
  const mobileUsers = cells.filter(c => c.col === 'Mobile').reduce((s, c) => s + c.users, 0);
  const pwaActions = cells.filter(c => c.row === 'PWA').reduce((s, c) => s + c.actions, 0);
  const mobileActions = cells.filter(c => c.col === 'Mobile').reduce((s, c) => s + c.actions, 0);

  return {
    cells,
    knownUsers,
    knownActions,
    unknownUsers: unknownEntry?.users || 0,
    unknownActions: unknownEntry?.actions || 0,
    pwaUserPct: knownUsers ? Math.round(pwaUsers / knownUsers * 100) : 0,
    mobileUserPct: knownUsers ? Math.round(mobileUsers / knownUsers * 100) : 0,
    pwaActionPct: knownActions ? Math.round(pwaActions / knownActions * 100) : 0,
    mobileActionPct: knownActions ? Math.round(mobileActions / knownActions * 100) : 0,
  };
}

export function PlatformBreakdown({ data }) {
  if (!data) return null;

  const { platforms, total_users, total_actions } = data;
  const m = buildMatrix(platforms);

  if (!m.knownActions && !m.unknownActions) return null;

  return (
    <div className="bg-white/5 rounded-xl p-5 border border-white/10 mb-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-white text-sm font-semibold uppercase tracking-wider">Platform Breakdown</h3>
        <span className="text-gray-500 text-xs">{total_users} users / {total_actions} actions tracked</span>
      </div>

      {!m.knownActions ? (
        <p className="text-gray-500 text-sm">
          Not enough platform data yet -- actions recorded before this feature show as unknown.
          New sessions will populate this grid.
        </p>
      ) : (
        <>
          {/* 2x2 matrix */}
          <div className="grid grid-cols-[auto_1fr_1fr] gap-px mb-5">
            {/* Header row */}
            <div />
            <div className="text-center text-gray-400 text-xs uppercase tracking-wider pb-2">Mobile</div>
            <div className="text-center text-gray-400 text-xs uppercase tracking-wider pb-2">Desktop</div>

            {/* PWA row */}
            <div className="flex items-center pr-3">
              <span className="text-gray-400 text-xs uppercase tracking-wider">PWA</span>
            </div>
            {GRID_CELLS.filter(c => c.row === 'PWA').map(c => {
              const cell = m.cells.find(x => x.key === c.key);
              return (
                <div key={c.key} className="rounded-lg p-4 text-center border border-white/10" style={{ backgroundColor: `${c.color}15` }}>
                  <div className="text-white text-2xl font-bold">{cell.actionPct}%</div>
                  <div className="text-gray-400 text-xs mt-1">{cell.actions} actions</div>
                  <div className="text-gray-500 text-[10px] mt-0.5">{cell.users} users</div>
                </div>
              );
            })}

            {/* Website row */}
            <div className="flex items-center pr-3">
              <span className="text-gray-400 text-xs uppercase tracking-wider">Site</span>
            </div>
            {GRID_CELLS.filter(c => c.row === 'Website').map(c => {
              const cell = m.cells.find(x => x.key === c.key);
              return (
                <div key={c.key} className="rounded-lg p-4 text-center border border-white/10" style={{ backgroundColor: `${c.color}15` }}>
                  <div className="text-white text-2xl font-bold">{cell.actionPct}%</div>
                  <div className="text-gray-400 text-xs mt-1">{cell.actions} actions</div>
                  <div className="text-gray-500 text-[10px] mt-0.5">{cell.users} users</div>
                </div>
              );
            })}
          </div>

          {/* Row/column totals */}
          <div className="flex gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">PWA:</span>
              <span className="text-white font-semibold">{m.pwaActionPct}%</span>
              <span className="text-gray-600">of actions</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Mobile:</span>
              <span className="text-white font-semibold">{m.mobileActionPct}%</span>
              <span className="text-gray-600">of actions</span>
            </div>
            {m.unknownActions > 0 && (
              <div className="ml-auto flex items-center gap-1">
                <span className="text-gray-600 text-xs">{m.unknownActions} pre-tracking actions excluded</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
