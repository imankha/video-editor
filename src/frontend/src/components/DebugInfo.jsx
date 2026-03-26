import { useState } from 'react';
import { Code, X, ChevronUp } from 'lucide-react';
import { useProfileStore } from '../stores/profileStore';
import { getUserId } from '../utils/sessionInit';

/**
 * DebugInfo component - Shows current profile, user ID, and environment info
 * Only visible in development mode
 */
export default function DebugInfo() {
  const [isExpanded, setIsExpanded] = useState(false);

  // Don't render in production
  if (import.meta.env.PROD) {
    return null;
  }

  const currentProfile = useProfileStore(state =>
    state.profiles.find(p => p.id === state.currentProfileId) || null
  );
  const profileName = currentProfile?.name || 'No profile';
  const profileId = currentProfile?.id || '—';
  const userId = getUserId() || '—';

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {isExpanded ? (
        <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-4 max-w-md">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Code size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-white">Dev Info</h3>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between gap-4">
              <span className="text-gray-400">Profile:</span>
              <span className="text-green-400 text-right">{profileName}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-gray-400">Profile ID:</span>
              <span className="text-blue-400 text-right">{profileId}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-gray-400">User ID:</span>
              <span className="text-purple-400 text-right break-all text-[10px]">{userId}</span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-gray-400">Env:</span>
              <span className="text-yellow-400 text-right">
                {import.meta.env.MODE}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsExpanded(true)}
          className="bg-gray-900 border border-gray-700 rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 hover:bg-gray-800 transition-colors group"
        >
          <Code size={14} className="text-blue-400" />
          <span className="text-xs font-mono text-gray-300 truncate max-w-[120px]">
            {profileName}
          </span>
          <ChevronUp size={12} className="text-gray-500 group-hover:text-gray-300" />
        </button>
      )}
    </div>
  );
}
