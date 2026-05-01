import React, { useEffect } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAdminStore } from '../stores/adminStore';
import { useAuthStore } from '../stores/authStore';
import { UserTable } from '../components/admin/UserTable';

const ENV_STYLES = {
  dev: 'bg-green-500/20 text-green-400 border-green-500/40',
  staging: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  production: 'bg-red-500/20 text-red-400 border-red-500/40',
};

/**
 * AdminScreen — Full-page admin panel.
 *
 * Props:
 * - onBack: navigate back to project manager
 */
export function AdminScreen({ onBack }) {
  const fetchUsers = useAdminStore(state => state.fetchUsers);
  const users = useAdminStore(state => state.users);
  const loading = useAdminStore(state => state.usersLoading);
  const error = useAdminStore(state => state.usersError);
  const environment = useAuthStore(state => state.adminEnvironment);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Guests (no email) are hidden from the table but included in the funnel chart
  const knownUsers = users.filter(u => u.email);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="mx-auto px-6 py-8 max-w-[1600px]">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
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

        {/* Users section */}
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-gray-300 font-medium mb-4">Users</h2>

          {loading && (
            <p className="text-gray-500 text-sm">Loading users{'\u2026'}</p>
          )}

          {error && (
            <p className="text-red-400 text-sm">Error: {error}</p>
          )}

          {!loading && !error && knownUsers.length === 0 && (
            <p className="text-gray-500 text-sm">No recognised users found.</p>
          )}

          {!loading && !error && knownUsers.length > 0 && (
            <UserTable users={knownUsers} allUsers={knownUsers} />
          )}
        </div>
      </div>
    </div>
  );
}
