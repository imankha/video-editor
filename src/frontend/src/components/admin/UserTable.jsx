import React, { useState } from 'react';
import { Plus, Cpu } from 'lucide-react';
import { CreditGrantModal } from './CreditGrantModal';
import { GpuUsagePanel } from './GpuUsagePanel';

const CLOUDFLARE_DASHBOARD_URL = 'https://dash.cloudflare.com/?to=/:account/web-analytics';

function fmtGpu(s) {
  if (s == null) return '—';
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function QuestBadge({ questId, progress }) {
  if (!progress) return <span className="text-gray-600">—</span>;
  const { completed, total, reward_claimed } = progress;
  const done = completed === total;
  return (
    <span className={`text-xs ${done ? 'text-green-400' : 'text-gray-300'}`}>
      {done ? '✓' : `${completed}/${total}`}
      {reward_claimed && done && ' 🏆'}
    </span>
  );
}

/**
 * UserTable — Admin user list with credits, quest progress, and GPU usage.
 *
 * Props:
 * - users: array from GET /api/admin/users
 */
export function UserTable({ users }) {
  const [grantUser, setGrantUser] = useState(null);
  const [gpuUser, setGpuUser] = useState(null);

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm">{users.length} user{users.length !== 1 ? 's' : ''}</span>
        <a
          href={CLOUDFLARE_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          View Cloudflare Analytics ↗
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-right px-4 py-3">Credits</th>
              <th className="text-center px-4 py-3">Q1</th>
              <th className="text-center px-4 py-3">Q2</th>
              <th className="text-center px-4 py-3">Q3</th>
              <th className="text-right px-4 py-3">Last seen</th>
              <th className="text-right px-4 py-3">GPU</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr
                key={user.user_id}
                className="border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                <td className="px-4 py-3 text-gray-200">
                  {user.email || <span className="text-gray-500 italic">guest</span>}
                </td>

                {/* Credits with grant button */}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-gray-200">{user.credits ?? 0}</span>
                    <button
                      onClick={() => setGrantUser(user)}
                      className="text-gray-500 hover:text-purple-400 transition-colors"
                      title="Grant credits"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </td>

                {/* Quest progress per quest */}
                <td className="px-4 py-3 text-center">
                  <QuestBadge questId="quest_1" progress={user.quest_progress?.quest_1} />
                </td>
                <td className="px-4 py-3 text-center">
                  <QuestBadge questId="quest_2" progress={user.quest_progress?.quest_2} />
                </td>
                <td className="px-4 py-3 text-center">
                  <QuestBadge questId="quest_3" progress={user.quest_progress?.quest_3} />
                </td>

                {/* Last seen */}
                <td className="px-4 py-3 text-right text-gray-500 text-xs">
                  {user.last_seen_at ? user.last_seen_at.slice(0, 10) : '—'}
                </td>

                {/* GPU — click for drilldown */}
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => setGpuUser(user)}
                    className="flex items-center gap-1 ml-auto text-gray-400 hover:text-purple-300 transition-colors"
                    title="GPU usage drilldown"
                  >
                    <span className="text-xs">{fmtGpu(user.gpu_seconds_total)}</span>
                    <Cpu size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {grantUser && (
        <CreditGrantModal user={grantUser} onClose={() => setGrantUser(null)} />
      )}
      {gpuUser && (
        <GpuUsagePanel user={gpuUser} onClose={() => setGpuUser(null)} />
      )}
    </>
  );
}
