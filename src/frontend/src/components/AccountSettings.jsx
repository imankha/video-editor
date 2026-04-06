import { X, Mail, LogOut, Link2, Coins } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCreditStore } from '../stores/creditStore';

/**
 * AccountSettings - Modal panel showing account info, Google link status,
 * credit balance, and logout button.
 *
 * T430: Opened by clicking the avatar/user icon in ProfileDropdown.
 */
export function AccountSettings() {
  const showAccountSettings = useAuthStore(state => state.showAccountSettings);
  const closeAccountSettings = useAuthStore(state => state.closeAccountSettings);
  const email = useAuthStore(state => state.email);
  const pictureUrl = useAuthStore(state => state.pictureUrl);
  const logout = useAuthStore(state => state.logout);
  const balance = useCreditStore(state => state.balance);
  const loaded = useCreditStore(state => state.loaded);

  if (!showAccountSettings) return null;

  const isGoogleLinked = !!email;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg border border-gray-700 max-w-sm w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Account Settings</h2>
          <button onClick={closeAccountSettings} className="text-gray-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Avatar + Email */}
          <div className="flex items-center gap-3">
            {pictureUrl ? (
              <img
                src={pictureUrl}
                alt=""
                className="w-12 h-12 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                <Mail size={20} className="text-gray-400" />
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm text-white truncate">{email || 'Guest'}</div>
              <div className="text-xs text-gray-500">
                {isGoogleLinked ? 'Signed in with Google' : 'Not signed in'}
              </div>
            </div>
          </div>

          {/* Google link status */}
          <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
            <div className="flex items-center gap-2">
              <Link2 size={16} className="text-gray-400" />
              <span className="text-sm text-gray-300">Google Account</span>
            </div>
            {isGoogleLinked ? (
              <span className="text-xs text-green-400 font-medium">Linked</span>
            ) : (
              <button
                disabled
                className="text-xs text-blue-400 font-medium opacity-50 cursor-not-allowed"
                title="Coming soon"
              >
                Link Account
              </button>
            )}
          </div>

          {/* Credit balance */}
          {loaded && (
            <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
              <div className="flex items-center gap-2">
                <Coins size={16} className="text-yellow-400" />
                <span className="text-sm text-gray-300">Credits</span>
              </div>
              <span className="text-sm text-white font-medium">{balance}</span>
            </div>
          )}

          {/* Logout */}
          <button
            onClick={() => {
              closeAccountSettings();
              logout();
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
          >
            <LogOut size={16} className="text-gray-400" />
            <span className="text-sm text-gray-300">Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
