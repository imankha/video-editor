import React, { useEffect } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAdminStore } from '../stores/adminStore';
import { UserTable } from '../components/admin/UserTable';

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

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
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
          </div>
        </div>

        {/* Users section */}
        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
          <h2 className="text-gray-300 font-medium mb-4">Users</h2>

          {loading && (
            <p className="text-gray-500 text-sm">Loading users…</p>
          )}

          {error && (
            <p className="text-red-400 text-sm">Error: {error}</p>
          )}

          {!loading && !error && users.length === 0 && (
            <p className="text-gray-500 text-sm">No users found.</p>
          )}

          {!loading && !error && users.length > 0 && (
            <UserTable users={users} />
          )}
        </div>
      </div>
    </div>
  );
}
