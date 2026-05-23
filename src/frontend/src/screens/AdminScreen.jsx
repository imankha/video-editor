import React, { useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAdminStore } from '../stores/adminStore';
import { useAuthStore } from '../stores/authStore';
import { UserTable } from '../components/admin/UserTable';
import { AnalyticsDashboard } from '../components/admin/AnalyticsDashboard';
import { JourneyTimeline } from '../components/admin/JourneyTimeline';

const ENV_STYLES = {
  dev: 'bg-green-500/20 text-green-400 border-green-500/40',
  staging: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  production: 'bg-red-500/20 text-red-400 border-red-500/40',
};

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'analytics', label: 'Analytics' },
];

export function AdminScreen({ onBack }) {
  const [tab, setTab] = useState('users');

  const fetchUsers = useAdminStore(state => state.fetchUsers);
  const users = useAdminStore(state => state.users);
  const loading = useAdminStore(state => state.usersLoading);
  const error = useAdminStore(state => state.usersError);
  const funnelTotals = useAdminStore(state => state.funnelTotals);
  const journeyData = useAdminStore(state => state.journeyData);
  const journeyLoading = useAdminStore(state => state.journeyLoading);
  const fetchJourney = useAdminStore(state => state.fetchJourney);
  const clearJourney = useAdminStore(state => state.clearJourney);
  const environment = useAuthStore(state => state.adminEnvironment);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const knownUsers = users.filter(u => u.email);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="mx-auto px-6 py-8 max-w-[1600px]">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white transition-colors"
            title="Back"
          >
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

        <div className="flex items-center gap-1 mb-6">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                tab === t.key
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'users' && (
          <div className="bg-white/5 rounded-xl p-6 border border-white/10">
            <h2 className="text-gray-300 font-medium mb-4">Users</h2>

            {loading && (
              <p className="text-gray-500 text-sm">Loading users{'...'}</p>
            )}

            {error && (
              <p className="text-red-400 text-sm">Error: {error}</p>
            )}

            {!loading && !error && knownUsers.length === 0 && (
              <p className="text-gray-500 text-sm">No recognised users found.</p>
            )}

            {!loading && !error && knownUsers.length > 0 && (
              <UserTable users={knownUsers} onUserClick={(userId) => fetchJourney(userId)} funnelTotals={funnelTotals} />
            )}
          </div>
        )}

        {tab === 'analytics' && <AnalyticsDashboard />}

        {(journeyData || journeyLoading) && (
          <JourneyTimeline
            data={journeyData}
            onClose={clearJourney}
          />
        )}
      </div>
    </div>
  );
}
