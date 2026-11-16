import { useAuthStore } from '../../stores/authStore';

/**
 * T16660: /admin for a signed-in account. The server refuses every admin data route to a
 * non-admin (T4610), so the panel must not mount for one: it would show the filters, the roadmap
 * line and the build id, and fire requests that 403. Nothing renders until GET /api/admin/me has
 * answered; a non-admin then gets a short not-available screen with a way Home.
 */
export function AdminGate({ onHome, children }) {
  const isAdmin = useAuthStore(s => s.isAdmin);
  const adminChecked = useAuthStore(s => s.adminChecked);

  if (!adminChecked) return null;
  if (isAdmin) return children;

  return (
    <div data-testid="admin-not-available" className="min-h-screen bg-gray-900 flex items-center justify-center px-6">
      <div className="text-center">
        <p className="text-white text-lg font-semibold mb-2">This page is not available</p>
        <p className="text-gray-400 text-sm mb-6">It is only open to the ReelBallers team.</p>
        <button
          onClick={onHome}
          className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
        >
          Go to Home
        </button>
      </div>
    </div>
  );
}
