import React, { useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck, X } from 'lucide-react';
import { useAdminStore } from '../stores/adminStore';
import { useAuthStore } from '../stores/authStore';
import { UserTable } from '../components/admin/UserTable';
import { PulseCards } from '../components/admin/PulseCards';
import { FunnelChart } from '../components/admin/FunnelChart';
import { ChannelsTable } from '../components/admin/ChannelsTable';
import { CohortGrid } from '../components/admin/CohortGrid';
import { UserDetailPanel } from '../components/admin/UserDetailPanel';

const ENV_STYLES = {
  dev: 'bg-green-500/20 text-green-400 border-green-500/40',
  staging: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  production: 'bg-red-500/20 text-red-400 border-red-500/40',
};

const DETAIL_TABS = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'cohorts', label: 'Cohorts' },
];

export function AdminScreen({ onBack }) {
  const [detailTab, setDetailTab] = useState(null);

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

  useEffect(() => {
    fetchUsers();
    fetchPulse();
  }, [fetchUsers, fetchPulse]);

  useEffect(() => {
    if (detailTab === 'campaigns' && !channelsData) fetchChannels();
    if (detailTab === 'cohorts' && !cohortsData) fetchCohorts();
  }, [detailTab, channelsData, cohortsData, fetchChannels, fetchCohorts]);

  const hasFilter = segmentOrigin || segmentFrom || segmentTo;
  const knownUsers = users.filter(u => u.email);

  function handleCampaignClick(origin) {
    setSegmentFilter(origin, null, null);
    setDetailTab(null);
  }

  function handleCohortClick(cohortPeriod) {
    const from = cohortPeriod;
    const d = new Date(cohortPeriod);
    d.setDate(d.getDate() + 6);
    const to = d.toISOString().slice(0, 10);
    setSegmentFilter(null, from, to);
    setDetailTab(null);
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

        {/* Segment filter bar */}
        {hasFilter && (
          <div className="flex items-center gap-2 mb-4 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
            <span className="text-purple-300 text-xs font-medium">Filtered:</span>
            {segmentOrigin && (
              <span className="text-purple-200 text-xs bg-purple-500/20 px-2 py-0.5 rounded">
                Campaign: {segmentOrigin}
              </span>
            )}
            {segmentFrom && (
              <span className="text-purple-200 text-xs bg-purple-500/20 px-2 py-0.5 rounded">
                Cohort: {segmentFrom}{segmentTo ? ` to ${segmentTo}` : ''}
              </span>
            )}
            <button
              onClick={clearSegmentFilter}
              className="text-purple-400 hover:text-white ml-1"
              title="Clear filter"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Pulse */}
        <PulseCards data={pulseData} />

        {/* Detail tabs (campaigns / cohorts) */}
        <div className="flex items-center gap-1 mb-4">
          {DETAIL_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setDetailTab(detailTab === t.key ? null : t.key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                detailTab === t.key
                  ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
                  : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
              }`}
            >
              {t.label}
            </button>
          ))}
          <span className="text-gray-600 text-xs ml-2">Click a row to filter users</span>
        </div>

        {detailTab === 'campaigns' && (
          <div className="bg-white/5 rounded-xl p-5 border border-white/10 mb-6">
            {channelsLoading
              ? <p className="text-gray-500 text-sm">Loading campaigns...</p>
              : <ChannelsTable data={channelsData} onRowClick={handleCampaignClick} />
            }
          </div>
        )}

        {detailTab === 'cohorts' && (
          <div className="bg-white/5 rounded-xl p-5 border border-white/10 mb-6">
            {cohortsLoading
              ? <p className="text-gray-500 text-sm">Loading cohorts...</p>
              : <CohortGrid data={cohortsData} onRowClick={handleCohortClick} />
            }
          </div>
        )}

        {/* Funnel */}
        {funnelTotals && (
          <div className="bg-white/5 rounded-xl p-5 border border-white/10 mb-6">
            <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-3">
              Funnel{hasFilter ? ' (filtered)' : ''}
            </h3>
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
