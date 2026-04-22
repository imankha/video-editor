import React, { useEffect } from 'react';
import { X, Cpu } from 'lucide-react';
import { useAdminStore } from '../../stores/adminStore';

function fmtSeconds(s) {
  if (s == null) return '—';
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

/**
 * GpuUsagePanel — Per-user GPU usage drilldown panel.
 *
 * Props:
 * - user: { user_id, email }
 * - onClose: called when panel is dismissed
 */
export function GpuUsagePanel({ user, onClose }) {
  const fetchGpuUsage = useAdminStore(state => state.fetchGpuUsage);
  const gpuState = useAdminStore(state => state.gpuUsage[user.user_id]);

  useEffect(() => {
    if (!gpuState) {
      fetchGpuUsage(user.user_id, user._profileId);
    }
  }, [user.user_id, user._profileId, gpuState, fetchGpuUsage]);

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const data = gpuState?.data;
  const loading = gpuState?.loading;
  const error = gpuState?.error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdrop}
    >
      <div className="bg-gray-800 border border-white/10 rounded-xl p-6 w-[480px] max-h-[80vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-purple-400" />
            <h3 className="text-white font-semibold">GPU Usage</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <p className="text-gray-400 text-sm mb-4">{user.email || user.user_id}</p>

        {loading && <p className="text-gray-500 text-sm">Loading…</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {data && (
          <>
            <p className="text-white text-sm mb-3">
              Total: <span className="font-semibold text-purple-300">{fmtSeconds(data.total_gpu_seconds)}</span>
            </p>

            {/* By function */}
            {Object.keys(data.by_function).length > 0 && (
              <div className="mb-4">
                <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">By type</p>
                <div className="flex flex-col gap-1">
                  {Object.entries(data.by_function).map(([fn, stats]) => (
                    <div key={fn} className="flex justify-between text-sm">
                      <span className="text-gray-300 capitalize">{fn}</span>
                      <span className="text-gray-400">
                        {stats.count} calls · {fmtSeconds(stats.total_seconds)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent jobs */}
            {data.recent_jobs.length > 0 && (
              <div>
                <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Recent jobs</p>
                <div className="flex flex-col gap-1">
                  {data.recent_jobs.map(job => (
                    <div key={job.id} className="flex justify-between text-xs text-gray-400">
                      <span className="font-mono text-gray-500 w-24 truncate">{job.id.slice(0, 8)}</span>
                      <span className="capitalize text-gray-300">{job.type}</span>
                      <span>{fmtSeconds(job.gpu_seconds)}</span>
                      <span className="text-gray-500">{job.created_at?.slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!data.total_gpu_seconds && (
              <p className="text-gray-500 text-sm">No GPU jobs recorded yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
