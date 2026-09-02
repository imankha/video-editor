import { useState, useMemo } from 'react';
import { Plus, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ChevronLeft, Activity, CheckSquare, Square, FlaskConical } from 'lucide-react';
import { CreditGrantModal } from './CreditGrantModal';
import { BulkEmailModal } from './BulkEmailModal';
import { BulkActionBar } from './BulkActionBar';
import { useAuthStore } from '../../stores/authStore';
import { useAdminStore } from '../../stores/adminStore';

const CLOUDFLARE_DASHBOARD_URL = 'https://dash.cloudflare.com/?to=/:account/web-analytics';

function fmtMoney(cents) {
  if (!cents) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDuration(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  // T5660: hours-only — no days branch (26h, not "1d 2h").
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
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
  { key: 'total_usage_seconds', label: 'Usage', align: 'right' },
  { key: 'avg_weekly_seconds', label: 'Avg/wk', align: 'right' },
  { key: 'last_7d_seconds', label: 'Last 7d', align: 'right' },
  { key: 'last_active_at', label: 'Last active', align: 'right' },
];

const STEP_STYLES = {
  'Signed Up': 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  'Uploaded': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Clipped': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'Watched Annotate Video': 'bg-cyan-600/20 text-cyan-300 border-cyan-600/30', // T7930: was 'Annotation Done'; keyed by backend label (admin._compute_last_step)
  'Focus Opened': 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  'Focus Exported': 'bg-teal-600/20 text-teal-300 border-teal-600/30',
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
  // T8110: sort now lives in the store and drives a server refetch (global
  // ordering over the whole DB), not a local useMemo over the current page.
  const sortKey = useAdminStore(s => s.sortKey);
  const sortDir = useAdminStore(s => s.sortDir);
  const setSort = useAdminStore(s => s.setSort);
  const markTestAccount = useAdminStore(s => s.markTestAccount);

  const [grantUsers, setGrantUsers] = useState(null);
  const [emailUsers, setEmailUsers] = useState(null);
  const [search, setSearch] = useState('');

  // T4860: selection is ephemeral view state — local useState only, never
  // persisted (no-redundant-state / no persisted view state).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // T8110: the server returns rows already globally sorted; this useMemo only
  // applies the local email search ("filters this page"). No client re-sort --
  // single source of truth for ordering is the server.
  const matchedUsers = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(u => (u.email || '').toLowerCase().includes(q));
  }, [users, search]);

  // Selected user objects derived from the full page (not just the filtered
  // view), so a search filter never drops an already-selected user.
  const selectedUsers = useMemo(
    () => users.filter(u => selectedIds.has(u.user_id)),
    [users, selectedIds],
  );

  const allFilteredSelected = matchedUsers.length > 0 && matchedUsers.every(u => selectedIds.has(u.user_id));

  function toggleRow(userId) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const u of matchedUsers) next.delete(u.user_id);
      } else {
        for (const u of matchedUsers) next.add(u.user_id);
      }
      return next;
    });
  }

  function enterSelectionMode() {
    setSelectionMode(true);
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function handleBulkGrantDone() {
    setGrantUsers(null);
    exitSelectionMode();
  }

  function handleBulkEmailDone() {
    setEmailUsers(null);
    exitSelectionMode();
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

          <button
            type="button"
            onClick={() => (selectionMode ? exitSelectionMode() : enterSelectionMode())}
            className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
              selectionMode
                ? 'border-purple-500/50 bg-purple-600/30 text-purple-200'
                : 'border-white/10 text-gray-300 hover:bg-white/5'
            }`}
          >
            {selectionMode ? 'Done' : 'Select'}
          </button>

          <span className="text-gray-500 text-xs">
            {matchedUsers.length} of {users.length} on page
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

      {selectionMode && (
        <BulkActionBar
          count={selectedIds.size}
          onGrant={() => setGrantUsers(selectedUsers)}
          onEmail={() => setEmailUsers(selectedUsers)}
          onCancel={exitSelectionMode}
        />
      )}

      {/* Table */}
      <div className="rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
              {selectionMode && (
                <th className="px-3 py-2.5 w-8 text-center select-none">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-gray-400 hover:text-purple-300 transition-colors align-middle"
                    title={allFilteredSelected ? 'Deselect all' : 'Select all'}
                  >
                    {allFilteredSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                </th>
              )}
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  className={`text-${col.align} px-3 py-2.5 cursor-pointer hover:text-gray-200 transition-colors select-none`}
                  onClick={() => setSort(col.key)}
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
            {matchedUsers.map(user => {
              const isSelected = selectedIds.has(user.user_id);
              return (
              <tr
                key={user.user_id}
                className={`border-b border-white/5 transition-colors ${
                  isSelected ? 'bg-purple-500/10' : 'hover:bg-white/5'
                }`}
              >
                {selectionMode && (
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => toggleRow(user.user_id)}
                      className="text-gray-400 hover:text-purple-300 transition-colors align-middle"
                      title={isSelected ? 'Deselect' : 'Select'}
                    >
                      {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                    </button>
                  </td>
                )}
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
                  {/* T8110: internal/test-account badge -- visible when the Real
                      pill is off (test accounts shown), so they read as ours. */}
                  {user.is_test_account && (
                    <span
                      className="ml-1.5 inline-block px-1 py-0.5 text-[9px] rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 align-middle"
                      title="Internal / test account"
                    >
                      TEST
                    </span>
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
                    <span className="text-gray-200 text-xs">{user.credits == null ? '—' : user.credits}</span>
                    <button
                      onClick={() => setGrantUsers([user])}
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
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{fmtDuration(user.total_usage_seconds)}</td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{fmtDuration(user.avg_weekly_seconds)}</td>
                <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{fmtDuration(user.last_7d_seconds)}</td>

                <td className="px-3 py-2.5 text-right text-gray-500 text-xs">
                  <div className="flex items-center justify-end gap-1.5">
                    <span>{user.last_active_at ? user.last_active_at.slice(0, 10) : '—'}</span>
                    {/* T8110: per-row mark/unmark as a test account (gesture DB
                        write). Amber when flagged; toggles the badge in place. */}
                    <button
                      onClick={async () => {
                        try {
                          await markTestAccount(user.user_id, !user.is_test_account);
                        } catch (e) {
                          window.alert(e.message || 'Failed to update test flag');
                        }
                      }}
                      className={`transition-colors ${
                        user.is_test_account
                          ? 'text-amber-400 hover:text-amber-300'
                          : 'text-gray-600 hover:text-amber-400'
                      }`}
                      title={user.is_test_account ? 'Unmark as test account' : 'Mark as test account'}
                    >
                      <FlaskConical size={12} />
                    </button>
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
              );
            })}
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

      {grantUsers && (
        <CreditGrantModal
          users={grantUsers}
          onClose={grantUsers.length > 1 ? handleBulkGrantDone : () => setGrantUsers(null)}
        />
      )}

      {emailUsers && (
        <BulkEmailModal users={emailUsers} onClose={handleBulkEmailDone} />
      )}
    </>
  );
}
