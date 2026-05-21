import { useState } from 'react';
import { X, Mail, LogOut, Link2, Coins, Download, Trash2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCreditStore } from '../stores/creditStore';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';

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

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!showAccountSettings) return null;

  const isGoogleLinked = !!email;

  const handleDownloadData = async () => {
    setExporting(true);
    try {
      const resp = await apiFetch(`${API_BASE}/api/privacy/export-data`, {
        method: 'POST',
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'reelballers-data-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Error handled silently — user can retry
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteInput !== 'DELETE') return;
    setDeleting(true);
    try {
      const resp = await apiFetch(`${API_BASE}/api/privacy/delete-account`, {
        method: 'DELETE',
      });
      if (resp.ok) {
        window.location.reload();
      }
    } catch {
      setDeleting(false);
    }
  };

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

          {/* T1740: Privacy Rights */}
          <div className="border-t border-gray-700 pt-4 space-y-2">
            <h3 className="text-sm font-medium text-gray-400 flex items-center gap-1.5">
              <ShieldCheck size={14} />
              Your Privacy Rights
            </h3>

            <button
              onClick={handleDownloadData}
              disabled={exporting}
              className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-left disabled:opacity-50"
            >
              <Download size={16} className="text-gray-400" />
              <span className="text-sm text-gray-300">{exporting ? 'Preparing...' : 'Download My Data'}</span>
            </button>

            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-red-900/20 rounded-lg transition-colors text-left"
            >
              <Trash2 size={16} className="text-red-400" />
              <span className="text-sm text-red-300">Delete My Account</span>
            </button>

            <div className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg">
              <span className="text-sm text-gray-300">Do Not Sell or Share</span>
              <span className="text-xs text-green-400 font-medium">Active</span>
            </div>

            <div className="flex items-center gap-3 text-xs text-gray-500">
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Privacy Policy</a>
              <span>|</span>
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Terms of Service</a>
              <span>|</span>
              <a href="mailto:privacy@reelballers.com" className="text-blue-400 hover:underline">Contact</a>
            </div>
          </div>

          {/* Delete confirmation */}
          {showDeleteConfirm && (
            <div className="border border-red-800 bg-red-900/20 rounded-lg p-3 space-y-3">
              <p className="text-sm text-red-300">This will permanently delete your account and all data. This cannot be undone.</p>
              <input
                type="text"
                placeholder='Type "DELETE" to confirm'
                value={deleteInput}
                onChange={e => setDeleteInput(e.target.value)}
                className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                  className="flex-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded text-sm text-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteInput !== 'DELETE' || deleting}
                  className="flex-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm text-white font-medium transition-colors"
                >
                  {deleting ? 'Deleting...' : 'Delete Forever'}
                </button>
              </div>
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
