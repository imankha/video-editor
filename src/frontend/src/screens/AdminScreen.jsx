import React, { useEffect } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAdminStore } from '../stores/adminStore';
import { useAuthStore } from '../stores/authStore';
import { UserTable } from '../components/admin/UserTable';
import { PulseCards } from '../components/admin/PulseCards';
import { FunnelChart } from '../components/admin/FunnelChart';
import { ChannelsTable } from '../components/admin/ChannelsTable';
import { CohortGrid } from '../components/admin/CohortGrid';
import { PlatformBreakdown } from '../components/admin/PlatformBreakdown';
import { UserDetailPanel } from '../components/admin/UserDetailPanel';

const ENV_STYLES = {
  dev: 'bg-green-500/20 text-green-400 border-green-500/40',
  staging: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  production: 'bg-red-500/20 text-red-400 border-red-500/40',
};

const USER_FILTERS = [
  { key: 'paying', label: 'Paying' },
  { key: 'active_7d', label: 'Active (7d)' },
  { key: 'has_exports', label: 'Has Exports' },
  { key: 'invited_others', label: 'Invited Others' },
  { key: 'was_invited', label: 'Was Invited' },
];

export function AdminScreen({ onBack }) {
  const fetchUsers = useAdminStore(s => s.fetchUsers);
  const users = useAdminStore(s => s.users);
  const loading = useAdminStore(s => s.usersLoading);
  const error = useAdminStore(s => s.usersError);
  const funnelTotals = useAdminStore(s => s.funnelTotals);
  const segmentOrigin = useAdminStore(s => s.segmentOrigin);
  const segmentFrom = useAdminStore(s => s.segmentFrom);
  const segmentTo = useAdminStore(s => s.segmentTo);
  const setSegmentFilter = useAdminStore(s => s.setSegmentFilter);
  const clearSegmentFilter = useAdminStore(s => s.clearSegmentFilter);
  const userFilter = useAdminStore(s => s.userFilter);
  const setUserFilter = useAdminStore(s => s.setUserFilter);
  const userDetailData = useAdminStore(s => s.userDetailData);
  const userDetailLoading = useAdminStore(s => s.userDetailLoading);
  const fetchUserDetail = useAdminStore(s => s.fetchUserDetail);
  const clearUserDetail = useAdminStore(s => s.clearUserDetail);
  const environment = useAuthStore(s => s.adminEnvironment);

  const fetchPulse = useAdminStore(s => s.fetchPulse);
  const pulseData = useAdminStore(s => s.pulseData);
  const fetchChannels = useAdminStore(s => s.fetchChannels);
  const channelsData = useAdminStore(s => s.channelsData);
  const channelsLoading = useAdminStore(s => s.channelsLoading);
  const fetchCohorts = useAdminStore(s => s.fetchCohorts);
  const cohortsData = useAdminStore(s => s.cohortsData);
  const cohortsLoading = useAdminStore(s => s.cohortsLoading);
  const fetchPlatforms = useAdminStore(s => s.fetchPlatforms);
  const platformsData = useAdminStore(s => s.platformsData);

  useEffect(() => {
    fetchUsers();
    fetchPulse();
    fetchChannels();
    fetchCohorts();
    fetchPlatforms();
  }, [fetchUsers, fetchPulse, fetchChannels, fetchCohorts, fetchPlatforms]);

  const hasFilter = segmentOrigin || segmentFrom || segmentTo || userFilter;
  const knownUsers = users.filter(u => u.email);

  function handleCampaignClick(origin) {
    if (segmentOrigin === origin) {
      setSegmentFilter(null, segmentFrom, segmentTo);
    } else {
      setSegmentFilter(origin, segmentFrom, segmentTo);
    }
  }

  function handleCohortClick(cohortPeriod) {
    if (segmentFrom === cohortPeriod) {
      setSegmentFilter(segmentOrigin, null, null);
    } else {
      const d = new Date(cohortPeriod);
      d.setDate(d.getDate() + 6);
      setSegmentFilter(segmentOrigin, cohortPeriod, d.toISOString().slice(0, 10));
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="mx-auto px-6 py-8 max-w-[1600px]">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors" title="Back">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-purple-400" />
            <h1 className="text-white text-xl font-semibold">Admin Panel</h1>
            {environment && (
              <span className={`px-2 py-0.5 text-xs font-mono font-semibold rounded border uppercase ${ENV_STYLES[environment] || ENV_STYLES.dev}`}>
                {environment === 'production' ? 'PROD' : environment.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Filters -- all dimensions in one panel */}
        <div className="bg-white/5 rounded-xl border border-white/10 mb-6 overflow-hidden">
          {/* User type pills */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 flex-wrap">
            <span className="text-gray-500 text-xs uppercase tracking-wider mr-1">Filter</span>
            {USER_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setUserFilter(userFilter === f.key ? null : f.key)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  userFilter === f.key
                    ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
                    : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
                }`}
              >
                {f.label}
              </button>
            ))}
            {hasFilter && (
              <button
                onClick={clearSegmentFilter}
                className="text-gray-500 hover:text-white text-xs underline ml-auto"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Campaigns */}
          <div className="px-5 py-3 border-b border-white/5">
            <h4 className="text-gray-500 text-xs uppercase tracking-wider mb-2">Campaign</h4>
            {channelsLoading
              ? <p className="text-gray-500 text-xs">Loading...</p>
              : <ChannelsTable data={channelsData} onRowClick={handleCampaignClick} selectedOrigin={segmentOrigin} />
            }
          </div>

          {/* Cohorts */}
          <div className="px-5 py-3">
            <h4 className="text-gray-500 text-xs uppercase tracking-wider mb-2">Cohort</h4>
            {cohortsLoading
              ? <p className="text-gray-500 text-xs">Loading...</p>
              : <CohortGrid data={cohortsData} onRowClick={handleCohortClick} selectedPeriod={segmentFrom} />
            }
          </div>
        </div>

        {/* Results -- everything below reflects the active filters */}

        {/* Pulse */}
        <PulseCards data={pulseData} />

        {/* Platform Breakdown */}
        <PlatformBreakdown data={platformsData} />

        {/* Funnel */}
        {funnelTotals && (
          <div className="bg-white/5 rounded-xl p-5 border border-white/10 mb-6">
            <FunnelChart data={{ funnel: [{ origin: 'all', ...funnelTotals }] }} />
          </div>
        )}

        {/* Users */}
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          {loading && <p className="text-gray-500 text-sm">Loading users...</p>}
          {error && <p className="text-red-400 text-sm">Error: {error}</p>}
          {!loading && !error && knownUsers.length === 0 && (
            <p className="text-gray-500 text-sm">No users found{hasFilter ? ' for this filter' : ''}.</p>
          )}
          {!loading && !error && knownUsers.length > 0 && (
            <UserTable users={knownUsers} onUserClick={(userId) => fetchUserDetail(userId)} funnelTotals={funnelTotals} />
          )}
        </div>

        {(userDetailData || userDetailLoading) && (
          <UserDetailPanel data={userDetailData} onClose={clearUserDetail} />
        )}
      </div>
    </div>
  );
}
