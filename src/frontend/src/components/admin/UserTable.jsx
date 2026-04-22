import React, { useState, useMemo } from 'react';
import { Plus, Cpu, Search, ArrowUpDown, ArrowUp, ArrowDown, DollarSign, Zap, Gamepad2, Film, Layers, CheckCircle2, ChevronRight, ChevronDown, ChevronLeft } from 'lucide-react';
import { CreditGrantModal } from './CreditGrantModal';
import { GpuUsagePanel } from './GpuUsagePanel';
import { QuestFunnelChart } from './QuestFunnelChart';
import { useQuestStore } from '../../stores/questStore';
import { useAuthStore } from '../../stores/authStore';
import { useAdminStore } from '../../stores/adminStore';

const CLOUDFLARE_DASHBOARD_URL = 'https://dash.cloudflare.com/?to=/:account/web-analytics';

function fmtGpu(s) {
  if (s == null) return '\u2014';
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function fmtMoney(cents) {
  if (!cents) return '\u2014';
  return `$${(cents / 100).toFixed(2)}`;
}

function QuestBadge({ questId, progress }) {
  if (!progress) return <span className="text-gray-600">{'\u2014'}</span>;
  const { completed, total, reward_claimed } = progress;
  const done = completed === total;
  return (
    <span className={`text-xs ${done ? 'text-green-400' : 'text-gray-300'}`}>
      {done ? '\u2713' : `${completed}/${total}`}
      {reward_claimed && done && ' \uD83C\uDFC6'}
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

/** Aggregate stats from profile arrays across all users on this page */
function aggregateFromProfiles(users) {
  const t = { revenue: 0, spent: 0, purchased: 0, games: 0, clips: 0, framed: 0, completed: 0 };
  for (const u of users) {
    t.revenue += u.money_spent_cents || 0;
    t.spent += u.credits_spent || 0;
    t.purchased += u.credits_purchased || 0;
    for (const p of u.profiles || []) {
      t.games += p.games_annotated || 0;
      t.clips += p.clips_annotated || 0;
      t.framed += p.projects_framed || 0;
      t.completed += p.projects_completed || 0;
    }
  }
  return t;
}

// Columns that appear on user-level rows
const USER_COLUMNS = [
  { key: 'email', label: 'Email', align: 'left' },
  { key: 'credits', label: 'Credits', align: 'right' },
  { key: 'credits_spent', label: 'Spent', align: 'right' },
  { key: 'credits_purchased', label: 'Purchased', align: 'right' },
  { key: 'money_spent_cents', label: '$ Spent', align: 'right' },
];

// Columns that appear on profile-level rows (activity stats)
const PROFILE_COLUMNS = [
  { key: 'profile_id', label: 'Profile', align: 'left' },
  { key: 'games_annotated', label: 'Games', align: 'right' },
  { key: 'clips_annotated', label: 'Clips', align: 'right' },
  { key: 'projects_framed', label: 'Framed', align: 'right' },
  { key: 'projects_completed', label: 'Done', align: 'right' },
];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'paying', label: 'Paying' },
  { key: 'active', label: 'Active (7d)' },
  { key: 'has_exports', label: 'Has Exports' },
];

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
    case 'has_exports': {
      return (user.profiles || []).some(p => (p.projects_framed || 0) > 0);
    }
    default: return true;
  }
}

function getSortValue(user, key) {
  if (key.startsWith('quest_')) {
    // Aggregate quest progress across profiles for sorting
    const profiles = user.profiles || [];
    let maxCompleted = -1;
    for (const p of profiles) {
      const qp = p.quest_progress?.[key];
      if (qp) maxCompleted = Math.max(maxCompleted, qp.completed);
    }
    return maxCompleted;
  }
  // For profile-level keys, sum across profiles
  if (['games_annotated', 'clips_annotated', 'projects_framed', 'projects_completed', 'gpu_seconds_total'].includes(key)) {
    return (user.profiles || []).reduce((sum, p) => sum + (p[key] || 0), 0);
  }
  const v = user[key];
  if (v == null) return -Infinity;
  if (typeof v === 'string') return v.toLowerCase();
  return v;
}

/** Profile row — renders activity stats for a single profile */
function ProfileRow({ profile, user, definitions, colCount, isOnly, onGpuClick }) {
  return (
    <tr className="border-b border-white/5 bg-white/[0.02]">
      {/* Profile ID (indented if multi-profile) */}
      <td className="px-3 py-2 text-gray-500 text-xs" colSpan={isOnly ? 1 : 1}>
        {!isOnly && <span className="text-gray-600 mr-1">{'\u2514'}</span>}
        <span className="font-mono text-gray-400">{profile.profile_id?.slice(0, 8)}</span>
      </td>

      {/* Spacer for user-level columns (credits, spent, purchased, $ spent) */}
      {!isOnly && <td colSpan={4} />}

      {/* Activity stats */}
      <td className="px-3 py-2 text-right text-gray-400 text-xs">{profile.games_annotated ?? 0}</td>
      <td className="px-3 py-2 text-right text-gray-400 text-xs">{profile.clips_annotated ?? 0}</td>
      <td className="px-3 py-2 text-right text-gray-400 text-xs">{profile.projects_framed ?? 0}</td>
      <td className="px-3 py-2 text-right text-gray-400 text-xs">{profile.projects_completed ?? 0}</td>

      {/* Quest columns */}
      {(definitions || []).map(q => (
        <td key={q.id} className="px-3 py-2 text-center">
          <QuestBadge questId={q.id} progress={profile.quest_progress?.[q.id]} />
        </td>
      ))}

      {/* Last seen — blank for profile rows */}
      <td className="px-3 py-2" />

      {/* GPU */}
      <td className="px-3 py-2 text-right">
        <button
          onClick={() => onGpuClick(user, profile.profile_id)}
          className="flex items-center gap-1 ml-auto text-gray-400 hover:text-purple-300 transition-colors"
          title="GPU usage drilldown"
        >
          <span className="text-xs">{fmtGpu(profile.gpu_seconds_total)}</span>
          <Cpu size={11} />
        </button>
      </td>
    </tr>
  );
}

/**
 * UserTable — Admin user list with profile-centric rows, pagination, filtering, sorting.
 *
 * T1590: Users with multiple profiles show grouped rows (expandable parent + child profile rows).
 * Single-profile users show one flat row with all data inline.
 *
 * Props:
 * - users: paginated user list (with nested profiles)
 * - allUsers: same as users for quest funnel (pagination means we only have current page)
 */
export function UserTable({ users, allUsers }) {
  const definitions = useQuestStore((s) => s.definitions);
  const { currentPage, totalPages, totalProfiles } = useAdminStore(s => ({
    currentPage: s.currentPage,
    totalPages: s.totalPages,
    totalProfiles: s.totalProfiles,
  }));
  const nextPage = useAdminStore(s => s.nextPage);
  const prevPage = useAdminStore(s => s.prevPage);

  const [grantUser, setGrantUser] = useState(null);
  const [gpuUser, setGpuUser] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('last_seen_at');
  const [sortDir, setSortDir] = useState('desc');
  const [filter, setFilter] = useState('all');
  const [expandedUsers, setExpandedUsers] = useState({});

  // Build full column list for header
  const COLUMNS = useMemo(() => {
    const questCols = (definitions || []).map((q, i) => ({
      key: q.id,
      label: `Q${i + 1}`,
      align: 'center',
    }));
    return [
      { key: 'email', label: 'Email', align: 'left' },
      { key: 'credits', label: 'Credits', align: 'right' },
      { key: 'credits_spent', label: 'Spent', align: 'right' },
      { key: 'credits_purchased', label: 'Purchased', align: 'right' },
      { key: 'money_spent_cents', label: '$ Spent', align: 'right' },
      { key: 'games_annotated', label: 'Games', align: 'right' },
      { key: 'clips_annotated', label: 'Clips', align: 'right' },
      { key: 'projects_framed', label: 'Framed', align: 'right' },
      { key: 'projects_completed', label: 'Done', align: 'right' },
      ...questCols,
      { key: 'last_seen_at', label: 'Last seen', align: 'right' },
      { key: 'gpu_seconds_total', label: 'GPU', align: 'right' },
    ];
  }, [definitions]);

  const isFiltered = search !== '' || filter !== 'all';

  // Client-side filter + sort within the loaded page
  const matchedUsers = useMemo(() => {
    let result = users;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(u => (u.email || '').toLowerCase().includes(q));
    }
    return result.filter(u => matchesFilter(u, filter));
  }, [users, search, filter]);

  // QuestFunnelChart expects quest_progress at user level.
  // Merge from profiles: a step is done if ANY profile has it.
  const funnelUsers = useMemo(() => {
    const source = isFiltered ? matchedUsers : allUsers;
    return source.map(u => {
      const profiles = u.profiles || [];
      if (profiles.length === 0) return u;
      if (profiles.length === 1) return { ...u, quest_progress: profiles[0].quest_progress };
      // Merge across profiles: OR-gate steps
      const merged = {};
      for (const p of profiles) {
        if (!p.quest_progress) continue;
        for (const [qid, qp] of Object.entries(p.quest_progress)) {
          if (!merged[qid]) {
            merged[qid] = { ...qp, steps: { ...qp.steps } };
          } else {
            merged[qid].completed = Math.max(merged[qid].completed, qp.completed);
            merged[qid].reward_claimed = merged[qid].reward_claimed || qp.reward_claimed;
            for (const [sid, done] of Object.entries(qp.steps || {})) {
              merged[qid].steps[sid] = merged[qid].steps[sid] || done;
            }
          }
        }
      }
      return { ...u, quest_progress: merged };
    });
  }, [isFiltered, matchedUsers, allUsers]);

  const sorted = useMemo(() => {
    return [...matchedUsers].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [matchedUsers, sortKey, sortDir]);

  const totals = useMemo(() => aggregateFromProfiles(matchedUsers), [matchedUsers]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function toggleExpand(userId) {
    setExpandedUsers(prev => ({ ...prev, [userId]: !prev[userId] }));
  }

  function handleGpuClick(user, profileId) {
    setGpuUser({ ...user, _profileId: profileId });
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

          <span className="text-gray-500 text-xs">
            {sorted.length} of {users.length} on page
            {totalProfiles > 0 && ` \u00b7 ${totalProfiles} profiles total`}
          </span>
        </div>

        <a
          href={CLOUDFLARE_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          View Cloudflare Analytics {'\u2197'}
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
            {sorted.map(user => {
              const profiles = user.profiles || [];
              const isMulti = profiles.length > 1;
              const isSingle = profiles.length === 1;
              const isExpanded = expandedUsers[user.user_id];
              const singleProfile = isSingle ? profiles[0] : null;

              return (
                <React.Fragment key={user.user_id}>
                  {/* User row */}
                  <tr className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    {/* Email + expand toggle */}
                    <td className="px-3 py-2.5 text-gray-200 text-xs">
                      <div className="flex items-center gap-1.5">
                        {isMulti && (
                          <button
                            onClick={() => toggleExpand(user.user_id)}
                            className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                          >
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        )}
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
                        {isMulti && (
                          <span className="text-gray-600 text-[10px]">({profiles.length} profiles)</span>
                        )}
                        {isSingle && singleProfile?.profile_id && (
                          <span className="font-mono text-gray-600 text-[10px]">{singleProfile.profile_id.slice(0, 8)}</span>
                        )}
                      </div>
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
                      {user.credits_spent ?? '\u2014'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                      {user.credits_purchased ?? '\u2014'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-400 text-xs">
                      {fmtMoney(user.money_spent_cents)}
                    </td>

                    {/* Activity stats — inline for single-profile, blank for multi */}
                    {isSingle ? (
                      <>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{singleProfile.games_annotated ?? 0}</td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{singleProfile.clips_annotated ?? 0}</td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{singleProfile.projects_framed ?? 0}</td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{singleProfile.projects_completed ?? 0}</td>
                      </>
                    ) : isMulti ? (
                      <>
                        <td className="px-3 py-2.5 text-right text-gray-500 text-xs italic" colSpan={4}>
                          {isExpanded ? '' : 'expand for details'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2.5 text-right text-gray-600 text-xs">{'\u2014'}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600 text-xs">{'\u2014'}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600 text-xs">{'\u2014'}</td>
                        <td className="px-3 py-2.5 text-right text-gray-600 text-xs">{'\u2014'}</td>
                      </>
                    )}

                    {/* Quest columns — inline for single-profile, blank for multi */}
                    {(definitions || []).map(q => (
                      <td key={q.id} className="px-3 py-2.5 text-center">
                        {isSingle ? (
                          <QuestBadge questId={q.id} progress={singleProfile?.quest_progress?.[q.id]} />
                        ) : (
                          <span className="text-gray-600">{'\u2014'}</span>
                        )}
                      </td>
                    ))}

                    <td className="px-3 py-2.5 text-right text-gray-500 text-xs">
                      {user.last_seen_at ? user.last_seen_at.slice(0, 10) : '\u2014'}
                    </td>

                    {/* GPU — inline for single-profile */}
                    <td className="px-3 py-2.5 text-right">
                      {isSingle ? (
                        <button
                          onClick={() => handleGpuClick(user, singleProfile.profile_id)}
                          className="flex items-center gap-1 ml-auto text-gray-400 hover:text-purple-300 transition-colors"
                          title="GPU usage drilldown"
                        >
                          <span className="text-xs">{fmtGpu(singleProfile.gpu_seconds_total)}</span>
                          <Cpu size={11} />
                        </button>
                      ) : isMulti ? (
                        <button
                          onClick={() => handleGpuClick(user, null)}
                          className="flex items-center gap-1 ml-auto text-gray-400 hover:text-purple-300 transition-colors"
                          title="GPU usage drilldown (all profiles)"
                        >
                          <span className="text-xs">
                            {fmtGpu(profiles.reduce((s, p) => s + (p.gpu_seconds_total || 0), 0) || null)}
                          </span>
                          <Cpu size={11} />
                        </button>
                      ) : (
                        <span className="text-xs text-gray-600">{'\u2014'}</span>
                      )}
                    </td>
                  </tr>

                  {/* Expanded profile rows for multi-profile users */}
                  {isMulti && isExpanded && profiles.map(profile => (
                    <ProfileRow
                      key={profile.profile_id}
                      profile={profile}
                      user={user}
                      definitions={definitions}
                      colCount={COLUMNS.length}
                      isOnly={false}
                      onGpuClick={handleGpuClick}
                    />
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
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
      {gpuUser && (
        <GpuUsagePanel user={gpuUser} onClose={() => setGpuUser(null)} />
      )}
    </>
  );
}
