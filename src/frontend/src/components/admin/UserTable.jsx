import React, { useState, useMemo } from 'react';
import { Plus, Cpu, Search, ArrowUpDown, ArrowUp, ArrowDown, DollarSign, Zap, Gamepad2, Film, Layers, CheckCircle2 } from 'lucide-react';
import { CreditGrantModal } from './CreditGrantModal';
import { GpuUsagePanel } from './GpuUsagePanel';
import { QuestFunnelChart } from './QuestFunnelChart';
import { useQuestStore } from '../../stores/questStore';
import { useAuthStore } from '../../stores/authStore';

const CLOUDFLARE_DASHBOARD_URL = 'https://dash.cloudflare.com/?to=/:account/web-analytics';

function fmtGpu(s) {
  if (s == null) return '—';
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function fmtMoney(cents) {
  if (!cents) return '—';
  return `$${(cents / 100).toFixed(2)}`;
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

/** Summary stat card */
function StatCard({ icon: Icon, label, value, sub, color = 'purple' }) {
  const colors = {
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    green: 'text-green-400 bg-green-500/10 border-green-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  };
  const c = colors[color] || colors.purple;
  return (
    <div className={`rounded-lg border px-4 py-3 ${c}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} />
        <span className="text-xs uppercase tracking-wider opacity-70">{label}</span>
      </div>
      <div className="text-xl font-semibold text-white">{value}</div>
      {sub && <div className="text-xs opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
}

const BASE_COLUMNS_BEFORE = [
  { key: 'email', label: 'Email', align: 'left' },
  { key: 'credits', label: 'Credits', align: 'right' },
  { key: 'credits_spent', label: 'Spent', align: 'right' },
  { key: 'credits_purchased', label: 'Purchased', align: 'right' },
  { key: 'money_spent_cents', label: '$ Spent', align: 'right' },
  { key: 'games_annotated', label: 'Games', align: 'right' },
  { key: 'clips_annotated', label: 'Clips', align: 'right' },
  { key: 'projects_framed', label: 'Framed', align: 'right' },
  { key: 'projects_completed', label: 'Done', align: 'right' },
];

const BASE_COLUMNS_AFTER = [
  { key: 'last_seen_at', label: 'Last seen', align: 'right' },
  { key: 'gpu_seconds_total', label: 'GPU', align: 'right' },
];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'paying', label: 'Paying' },
  { key: 'active', label: 'Active (7d)' },
  { key: 'has_exports', label: 'Has Exports' },
];

function getSortValue(user, key) {
  if (key.startsWith('quest_')) {
    const qp = user.quest_progress?.[key];
    return qp ? qp.completed : -1;
  }
  const v = user[key];
  if (v == null) return -Infinity;
  if (typeof v === 'string') return v.toLowerCase();
  return v;
}

function matchesFilter(user, filter) {
  switch (filter) {
    case 'paying': return (user.money_spent_cents || 0) > 0;
    case 'active': {
      if (!user.last_seen_at) return false;
      const seen = new Date(user.last_seen_at);
      const week = new Date();
      week.setDate(week.getDate() - 7);
      return seen >= week;
    }
    case 'has_exports': return (user.projects_framed || 0) > 0;
    default: return true;
  }
}

/**
 * UserTable — Admin user list with summary stats, filtering, sorting, quest funnel.
 *
 * Props:
 * - users: known (email) users for the table
 * - allUsers: all users including guests (for quest funnel when unfiltered)
 */
export function UserTable({ users, allUsers }) {
  const definitions = useQuestStore((s) => s.definitions);
  const [grantUser, setGrantUser] = useState(null);
  const [gpuUser, setGpuUser] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('last_seen_at');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('all');

  // Build columns dynamically from quest definitions
  const COLUMNS = useMemo(() => {
    const questCols = (definitions || []).map((q, i) => ({
      key: q.id,
      label: `Q${i + 1}`,
      align: 'center',
    }));
    return [...BASE_COLUMNS_BEFORE, ...questCols, ...BASE_COLUMNS_AFTER];
  }, [definitions]);

  const isFiltered = search !== '' || filter !== 'all';

  // Filter, then sort
  const matchedUsers = useMemo(() => {
    let result = users;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(u => (u.email || '').toLowerCase().includes(q));
    }
    return result.filter(u => matchesFilter(u, filter));
  }, [users, search, filter]);

  // Quest funnel uses allUsers when unfiltered (includes guests), matchedUsers when filtered
  const funnelUsers = isFiltered ? matchedUsers : allUsers;

  const filtered = useMemo(() => {
    return [...matchedUsers].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [matchedUsers, sortKey, sortDir]);

  // Compute totals from filtered users
  const totals = useMemo(() => {
    const t = { revenue: 0, spent: 0, purchased: 0, games: 0, clips: 0, framed: 0, completed: 0 };
    for (const u of matchedUsers) {
      t.revenue += u.money_spent_cents || 0;
      t.spent += u.credits_spent || 0;
      t.purchased += u.credits_purchased || 0;
      t.games += u.games_annotated || 0;
      t.clips += u.clips_annotated || 0;
      t.framed += u.projects_framed || 0;
      t.completed += u.projects_completed || 0;
    }
    return t;
  }, [matchedUsers]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function SortIcon({ colKey }) {
    if (sortKey !== colKey) return <ArrowUpDown size={10} className="opacity-30" />;
    return sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />;
  }

  return (
    <>
      {/* Summary stat cards */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard icon={DollarSign} label="Revenue" value={fmtMoney(totals.revenue)} color="green" />
        <StatCard icon={Zap} label="Credits Spent" value={totals.spent.toLocaleString()} color="rose" />
        <StatCard icon={Gamepad2} label="Games" value={totals.games} color="purple" />
        <StatCard icon={Film} label="Clips" value={totals.clips} color="blue" />
        <StatCard icon={Layers} label="Framed" value={totals.framed} color="cyan" />
        <StatCard icon={CheckCircle2} label="Completed" value={totals.completed} color="amber" />
      </div>

      {/* Quest Funnel */}
      {funnelUsers.length > 0 && (
        <div className="bg-white/5 rounded-lg p-4 border border-white/10 mb-5">
          <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-3">Quest Funnel</h3>
          <QuestFunnelChart users={funnelUsers} />
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center justify-between mb-3 gap-4">
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search email..."
              className="bg-white/5 border border-white/10 rounded-md pl-8 pr-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-purple-500/50 w-56"
            />
          </div>

          {/* Filter pills */}
          <div className="flex items-center gap-1">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  filter === f.key
                    ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
                    : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <span className="text-gray-500 text-xs">{filtered.length} of {users.length}</span>
        </div>

        <a
          href={CLOUDFLARE_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          View Cloudflare Analytics ↗
        </a>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  className={`text-${col.align} px-3 py-2.5 cursor-pointer hover:text-gray-200 transition-colors select-none`}
                  onClick={() => handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <SortIcon colKey={col.key} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(user => (
              <tr
                key={user.user_id}
                className="border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                <td className="px-3 py-2.5 text-gray-200 text-xs">
                  {user.email ? (
                    // T1510: click to impersonate. Server enforces admin-cannot-
                    // impersonate-admin and all other guards — this is a UX link,
                    // not an authorization decision.
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Impersonate ${user.email}?`)) return;
                        try {
                          await useAuthStore.getState().startImpersonation(user.user_id);
                        } catch (e) {
                          window.alert(e.message || 'Impersonation failed');
                        }
                      }}
                      className="text-purple-300 hover:text-purple-200 hover:underline focus:outline-none focus:ring-1 focus:ring-purple-400 rounded"
                      title="Log in as this user"
                    >
                      {user.email}
                    </button>
                  ) : (
                    <span className="text-gray-500 italic">guest</span>
                  )}
                </td>

                {/* Credits with grant button */}
                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-gray-200 text-xs">{user.credits ?? 0}</span>
                    <button
                      onClick={() => setGrantUser(user)}
                      className="text-gray-500 hover:text-purple-400 transition-colors"
                      title="Grant credits"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </td>

                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                  {user.credits_spent ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                  {user.credits_purchased ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                  {fmtMoney(user.money_spent_cents)}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                  {user.games_annotated ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                  {user.clips_annotated ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                  {user.projects_framed ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                  {user.projects_completed ?? '—'}
                </td>

                {(definitions || []).map(q => (
                  <td key={q.id} className="px-3 py-2.5 text-center">
                    <QuestBadge questId={q.id} progress={user.quest_progress?.[q.id]} />
                  </td>
                ))}

                <td className="px-3 py-2.5 text-right text-gray-500 text-xs">
                  {user.last_seen_at ? user.last_seen_at.slice(0, 10) : '—'}
                </td>

                <td className="px-3 py-2.5 text-right">
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
