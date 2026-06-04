import React, { useState, useMemo } from 'react';
import { Plus, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ChevronLeft, Activity } from 'lucide-react';
import { CreditGrantModal } from './CreditGrantModal';
import { useAuthStore } from '../../stores/authStore';
import { useAdminStore } from '../../stores/adminStore';

const CLOUDFLARE_DASHBOARD_URL = 'https://dash.cloudflare.com/?to=/:account/web-analytics';

function fmtMoney(cents) {
  if (!cents) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function OriginBadge({ origin }) {
  if (!origin) return <span className="text-gray-600">{'—'}</span>;
  const style = origin === 'organic'
    ? 'bg-green-500/20 text-green-400 border-green-500/30'
    : 'bg-blue-500/20 text-blue-400 border-blue-500/30';
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] rounded border ${style}`}
      title={origin}
    >
      {origin}
    </span>
  );
}

const COLUMNS = [
  { key: 'email', label: 'Email', align: 'left' },
  { key: 'origin', label: 'Origin', align: 'center' },
  { key: 'last_step', label: 'Last Step', align: 'center' },
  { key: 'acquired_at', label: 'Joined', align: 'right' },
  { key: 'game_created_count', label: 'Games', align: 'right' },
  { key: 'clip_created_count', label: 'Clips', align: 'right' },
  { key: 'export_completed_count', label: 'Exports', align: 'right' },
  { key: 'share_completed_count', label: 'Shares', align: 'right' },
  { key: 'credits', label: 'Credits', align: 'right' },
  { key: 'total_spent_cents', label: '$ Spent', align: 'right' },
  { key: 'action_count', label: 'Actions', align: 'right' },
  { key: 'session_count', label: 'Sessions', align: 'right' },
  { key: 'last_active_at', label: 'Last active', align: 'right' },
];

const STEP_STYLES = {
  'Signed Up': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  'Uploaded': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Clipped': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'Annotation Done': 'bg-cyan-600/20 text-cyan-300 border-cyan-600/30',
  'Framing Opened': 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  'Framing Exported': 'bg-teal-600/20 text-teal-300 border-teal-600/30',
  'Overlay Exported': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'Gallery Viewed': 'bg-green-400/20 text-green-300 border-green-400/30',
  'Downloaded': 'bg-green-500/20 text-green-400 border-green-500/30',
  'Exported': 'bg-green-500/20 text-green-400 border-green-500/30',
  'Shared': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'Purchased': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

function StepBadge({ step }) {
  if (!step) return <span className="text-gray-600">{'--'}</span>;
  const style = STEP_STYLES[step] || STEP_STYLES['Signed Up'];
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded border ${style}`}>
      {step}
    </span>
  );
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'paying', label: 'Paying' },
  { key: 'active', label: 'Active (7d)' },
  { key: 'has_exports', label: 'Has Exports' },
];

function matchesFilter(user, filter) {
  switch (filter) {
    case 'paying': return (user.total_spent_cents || 0) > 0;
    case 'active': {
      if (!user.last_active_at) return false;
      const seen = new Date(user.last_active_at);
      const week = new Date();
      week.setDate(week.getDate() - 7);
      return seen >= week;
    }
    case 'has_exports': return (user.export_completed_count || 0) > 0;
    default: return true;
  }
}

function getSortValue(user, key) {
  const v = user[key];
  if (v == null) return -Infinity;
  if (typeof v === 'string') return v.toLowerCase();
  return v;
}

const FUNNEL_STEPS = [
  { key: 'signed_up', label: 'Signed Up' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'clipped', label: 'Clipped' },
  { key: 'exported', label: 'Exported' },
  { key: 'shared', label: 'Shared' },
  { key: 'purchased', label: 'Purchased' },
];

function FunnelSummary({ totals }) {
  if (!totals) return null;
  const max = totals.signed_up || 1;
  return (
    <div className="flex items-end gap-2 mb-4 px-1">
      {FUNNEL_STEPS.map((step, i) => {
        const val = totals[step.key] || 0;
        const pct = Math.round((val / max) * 100);
        const prevVal = i > 0 ? (totals[FUNNEL_STEPS[i - 1].key] || 1) : val;
        const convPct = i > 0 ? Math.round((val / prevVal) * 100) : 100;
        return (
          <div key={step.key} className="flex-1 text-center">
            <div className="text-white text-sm font-semibold">{val}</div>
            <div className="text-gray-500 text-[10px]">
              {step.label}
              {i > 0 && <span className="text-gray-600 ml-0.5">({convPct}%)</span>}
            </div>
            <div className="mt-1 mx-auto rounded-full h-1.5 bg-white/5">
              <div
                className="h-full rounded-full bg-purple-500/60"
                style={{ width: `${Math.max(pct, 3)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function UserTable({ users, onUserClick, funnelTotals }) {
  const currentPage = useAdminStore(s => s.currentPage);
  const totalPages = useAdminStore(s => s.totalPages);
  const totalUsers = useAdminStore(s => s.totalUsers);
  const nextPage = useAdminStore(s => s.nextPage);
  const prevPage = useAdminStore(s => s.prevPage);

  const [grantUser, setGrantUser] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('last_active_at');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('all');

  const matchedUsers = useMemo(() => {
    let result = users;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(u => (u.email || '').toLowerCase().includes(q));
    }
    return result.filter(u => matchesFilter(u, filter));
  }, [users, search, filter]);

  const sorted = useMemo(() => {
    return [...matchedUsers].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [matchedUsers, sortKey, sortDir]);

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
      <FunnelSummary totals={funnelTotals} />

      {/* Controls row */}
      <div className="flex items-center justify-between mb-3 gap-4">
        <div className="flex items-center gap-3">
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

          <span className="text-gray-500 text-xs">
            {sorted.length} of {users.length} on page
            {totalUsers > 0 && ` · ${totalUsers} users total`}
          </span>
        </div>

        <a
          href={CLOUDFLARE_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          View Cloudflare Analytics {'↗'}
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
            {sorted.map(user => (
              <tr key={user.user_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="px-3 py-2.5 text-gray-200 text-xs">
                  {user.email ? (
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

                <td className="px-3 py-2.5 text-center">
                  <OriginBadge origin={user.origin} />
                </td>

                <td className="px-3 py-2.5 text-center">
                  <StepBadge step={user.last_step} />
                </td>

                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                  {user.acquired_at || '—'}
                </td>

                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{user.game_created_count ?? 0}</td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{user.clip_created_count ?? 0}</td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{user.export_completed_count ?? 0}</td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{user.share_completed_count ?? 0}</td>

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
                  {fmtMoney(user.total_spent_cents)}
                </td>

                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{user.action_count ?? 0}</td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{user.session_count ?? 0}</td>

                <td className="px-3 py-2.5 text-right text-gray-500 text-xs">
                  <div className="flex items-center justify-end gap-1.5">
                    <span>{user.last_active_at ? user.last_active_at.slice(0, 10) : '—'}</span>
                    {onUserClick && (
                      <button
                        onClick={() => onUserClick(user.user_id)}
                        className="text-gray-600 hover:text-purple-400 transition-colors"
                        title="View journey"
                      >
                        <Activity size={12} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-4">
          <button
            onClick={prevPage}
            disabled={currentPage <= 1}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-white/10 text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={12} />
            Previous
          </button>
          <span className="text-gray-400 text-xs">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={nextPage}
            disabled={currentPage >= totalPages}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-white/10 text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight size={12} />
          </button>
        </div>
      )}

      {grantUser && (
        <CreditGrantModal user={grantUser} onClose={() => setGrantUser(null)} />
      )}
    </>
  );
}
