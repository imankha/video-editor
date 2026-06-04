import React, { useState, useMemo } from 'react';
import { X } from 'lucide-react';

const PIPELINE_STEPS = [
  { action: 'game_created', label: 'Upload' },
  { action: 'clip_created', label: 'Clip' },
  { action: 'annotation_completed', label: 'Annotate' },
  { action: 'framing_opened', label: 'Frame' },
  { action: 'framing_exported', label: 'Export' },
  { action: 'overlay_exported', label: 'Overlay' },
  { action: 'share_completed', label: 'Share' },
  { action: 'credit_purchased', label: 'Purchase' },
];

function formatDelta(ms) {
  if (ms <= 0) return '--';
  if (ms < 60_000) return '<1m';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(ms / 86_400_000);
  const h = Math.round((ms % 86_400_000) / 3_600_000);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function formatContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return '--';
  const parts = Object.entries(ctx)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length > 0 ? parts.join(', ') : '--';
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatShortDate(str) {
  if (!str) return '--';
  const d = new Date(str);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function UserDetailPanel({ data, onClose }) {
  const [actionFilter, setActionFilter] = useState('all');
  const [searchText, setSearchText] = useState('');

  const milestoneMap = useMemo(() => {
    if (!data?.milestones) return {};
    const m = {};
    for (const ms of data.milestones) {
      if (ms.at) m[ms.event] = ms.at;
    }
    return m;
  }, [data?.milestones]);

  const actionTypes = useMemo(() => {
    if (!data?.actionLog) return [];
    const types = new Set(data.actionLog.map(a => a.action));
    return [...types].sort();
  }, [data?.actionLog]);

  const filteredActions = useMemo(() => {
    if (!data?.actionLog) return [];
    let actions = data.actionLog;
    if (actionFilter !== 'all') {
      actions = actions.filter(a => a.action === actionFilter);
    }
    if (searchText) {
      const q = searchText.toLowerCase();
      actions = actions.filter(a => {
        const ctxStr = a.context ? JSON.stringify(a.context).toLowerCase() : '';
        return a.action.toLowerCase().includes(q) || ctxStr.includes(q);
      });
    }
    return actions;
  }, [data?.actionLog, actionFilter, searchText]);

  if (!data) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-white/10 max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-white font-medium text-lg">{data.email}</h3>
              <div className="text-gray-400 text-xs mt-0.5">
                {data.origin} · Joined {data.acquired_at || '--'} · {data.session_count} sessions
                {data.last_active_at && ` · Last active ${new Date(data.last_active_at).toLocaleString()}`}
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={18} />
            </button>
          </div>

          {/* Pipeline summary */}
          <div className="flex items-center gap-1 text-xs overflow-x-auto pb-1">
            <span className="text-green-400 font-mono">Signup</span>
            <span className="text-gray-600 font-mono">{formatShortDate(milestoneMap.signup_completed || data.acquired_at)}</span>
            {PIPELINE_STEPS.map(step => {
              const at = milestoneMap[step.action];
              return (
                <React.Fragment key={step.action}>
                  <span className="text-gray-600 mx-0.5">-&gt;</span>
                  <span className={at ? 'text-purple-400 font-mono' : 'text-gray-600 font-mono'}>{step.label}</span>
                  <span className="text-gray-600 font-mono">{at ? formatShortDate(at) : '--'}</span>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Filters */}
        <div className="px-5 py-2 border-b border-white/5 flex gap-3 flex-shrink-0">
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="bg-gray-800 text-gray-300 text-xs border border-white/10 rounded px-2 py-1"
          >
            <option value="all">All actions</option>
            {actionTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Search context..."
            className="bg-gray-800 text-gray-300 text-xs border border-white/10 rounded px-2 py-1 flex-1"
          />
        </div>

        {/* Action log */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-900 border-b border-white/10">
              <tr className="text-gray-500 text-left">
                <th className="px-5 py-2 w-20">DATE</th>
                <th className="px-2 py-2 w-20">TIME</th>
                <th className="px-2 py-2 w-44">ACTION</th>
                <th className="px-2 py-2 w-20 text-right">DELTA</th>
                <th className="px-2 py-2">CONTEXT</th>
              </tr>
            </thead>
            <tbody>
              {filteredActions.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-gray-500 text-center">No actions recorded yet</td></tr>
              )}
              {filteredActions.map((action, i) => {
                const prev = i < filteredActions.length - 1 ? filteredActions[i + 1] : null;
                const delta = prev ? new Date(action.created_at) - new Date(prev.created_at) : 0;
                const isSessionBoundary = action.action === 'session_started';
                const curDate = formatDate(action.created_at);
                const prevDate = i > 0 ? formatDate(filteredActions[i - 1].created_at) : '';
                const showDate = curDate !== prevDate;

                return (
                  <tr
                    key={action.id}
                    className={`border-b border-white/5 hover:bg-white/5 ${isSessionBoundary ? 'bg-gray-800/50' : ''}`}
                  >
                    <td className="px-5 py-1.5 text-gray-400 font-mono">
                      {showDate ? curDate : ''}
                    </td>
                    <td className="px-2 py-1.5 text-gray-400 font-mono">
                      {formatTime(action.created_at)}
                    </td>
                    <td className="px-2 py-1.5 text-gray-200 font-mono">
                      {action.action}
                    </td>
                    <td className={`px-2 py-1.5 text-right font-mono ${delta > 1_800_000 ? 'text-yellow-500' : 'text-gray-500'}`}>
                      {formatDelta(delta)}
                    </td>
                    <td className="px-2 py-1.5 text-gray-500 font-mono truncate max-w-xs" title={formatContext(action.context)}>
                      {formatContext(action.context)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
