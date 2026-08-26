import React, { useState, useMemo } from 'react';
import { X } from 'lucide-react';

// T7510: content-outcome pipeline. The upload step is special-cased to render
// BOTH the attempt (game_created, pending insert) and the durable success
// (game_upload_succeeded, R2-verified) so the attempt->durable gap is visible;
// its failure reasons are surfaced from the game_upload_failed rollup on the
// journey payload. annotation_completed is NOT here — it tracks watched-video,
// not clips, so it lives in the Engagement band below.
const PIPELINE_STEPS = [
  { action: 'clip_created', label: 'Clip' },
  { action: 'framing_opened', label: 'Frame' },
  { action: 'framing_exported', label: 'Export' },
  { action: 'overlay_exported', label: 'Overlay' },
  { action: 'share_completed', label: 'Share' },
  { action: 'credit_purchased', label: 'Purchase' },
];

// T7510: upload attempt vs durable outcome, rendered as a distinct pair.
const UPLOAD_ATTEMPT = 'game_created';
const UPLOAD_SUCCESS = 'game_upload_succeeded';
const UPLOAD_FAILED = 'game_upload_failed';

// T7510: engagement signals — activity that is NOT a content outcome (watched
// video, opened editors). Rendered in a visually distinct band so the dashboard
// never reads engagement as production.
const ENGAGEMENT_STEPS = [
  { action: 'annotation_completed', label: 'Annotate' },
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
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const match = str.match(/\.(\d+)/);
  const frac = match ? match[1].padEnd(2, '0').slice(0, 2) : '00';
  return `${hh}:${mm}:${ss}.${frac}`;
}

function formatShortDate(str) {
  if (!str) return '--';
  const d = new Date(str);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// T7510: "timeout x2, network x1" from a {reason: count} failures map.
function formatFailures(failures) {
  if (!failures) return '';
  return Object.entries(failures)
    .map(([reason, count]) => `${reason} x${count}`)
    .join(', ');
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

  // T7510: full milestone entry keyed by event (carries count, failed_count,
  // failures) so the pipeline can render attempted-vs-succeeded and failure
  // reasons, not just a timestamp dot.
  const milestoneByEvent = useMemo(() => {
    if (!data?.milestones) return {};
    const m = {};
    for (const ms of data.milestones) {
      m[ms.event] = ms;
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
    return [...actions].reverse();
  }, [data?.actionLog, actionFilter, searchText]);

  if (!data) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-white/10 max-w-4xl w-full h-[90vh] flex flex-col">
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

          {/* Pipeline summary (content outcomes) */}
          {(() => {
            const attemptMs = milestoneByEvent[UPLOAD_ATTEMPT];
            const successMs = milestoneByEvent[UPLOAD_SUCCESS];
            const failedMs = milestoneByEvent[UPLOAD_FAILED];
            const attemptCount = attemptMs?.count ?? 0;
            const successCount = successMs?.count ?? 0;
            // Failure reasons ride either the game_upload_failed rollup entry or
            // the game_upload_succeeded entry (when some succeeded, some failed).
            const failures = failedMs?.failures || successMs?.failures || null;
            const failedTotal = failedMs?.failed_count ?? failedMs?.count
              ?? successMs?.failed_count ?? 0;
            const gap = attemptCount - successCount;
            return (
              <div className="flex items-center gap-1 text-xs overflow-x-auto pb-1">
                <span className="text-green-400 font-mono">Signup</span>
                <span className="text-gray-600 font-mono">{formatShortDate(milestoneMap.signup_completed || data.acquired_at)}</span>

                {/* Upload: attempt -> durable success, with the gap surfaced */}
                <span className="text-gray-600 mx-0.5">-&gt;</span>
                <span className={attemptMs?.at ? 'text-purple-400 font-mono' : 'text-gray-600 font-mono'}>Upload</span>
                <span
                  className="font-mono"
                  title={failures ? `Failures: ${formatFailures(failures)}` : undefined}
                >
                  <span className={successCount > 0 ? 'text-green-400' : 'text-gray-500'}>{successCount}</span>
                  <span className="text-gray-600">/</span>
                  <span className="text-gray-400">{attemptCount}</span>
                  {gap > 0 && (
                    <span className="text-red-400 ml-0.5">(-{gap})</span>
                  )}
                </span>
                {failedTotal > 0 && failures && (
                  <span className="text-red-400/80 font-mono" title={formatFailures(failures)}>
                    [{formatFailures(failures)}]
                  </span>
                )}

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
            );
          })()}

          {/* T7510: Engagement band — activity, not content outcomes. Visually
              distinct (amber) so it never reads as production. */}
          <div className="flex items-center gap-1 text-[11px] overflow-x-auto pt-1.5 mt-1.5 border-t border-white/5">
            <span className="text-amber-400/70 font-mono uppercase tracking-wide mr-1">Engagement</span>
            {ENGAGEMENT_STEPS.map(step => {
              const at = milestoneMap[step.action];
              return (
                <React.Fragment key={step.action}>
                  <span className={at ? 'text-amber-300/90 font-mono' : 'text-gray-600 font-mono'}>{step.label}</span>
                  <span className="text-gray-600 font-mono">{at ? formatShortDate(at) : '--'}</span>
                </React.Fragment>
              );
            })}
          </div>

          {/* T7510 tier 5 (partial): retry-burst frustration signal — >=3 of the
              same attempt within 60s, read-time derived, no new storage. */}
          {data.frustration_signals?.retry_bursts && Object.keys(data.frustration_signals.retry_bursts).length > 0 && (
            <div className="flex items-center gap-2 text-[11px] pt-1.5 mt-1.5 border-t border-white/5 flex-wrap">
              <span className="text-red-400/80 font-mono uppercase tracking-wide">Retry Burst</span>
              {Object.entries(data.frustration_signals.retry_bursts).map(([action, bursts]) => (
                <span key={action} className="text-red-300/90 font-mono">
                  {action} x{bursts.reduce((sum, b) => sum + b.count, 0)}
                </span>
              ))}
            </div>
          )}
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
                <th className="px-2 py-2 w-40">TIME</th>
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
                const prev = i > 0 ? filteredActions[i - 1] : null;
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
