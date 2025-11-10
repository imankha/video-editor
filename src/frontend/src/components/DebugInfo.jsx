import { useState } from 'react';
import { Code, X, ChevronDown, ChevronUp } from 'lucide-react';
import versionInfo from '../version.json';

/**
 * DebugInfo component - Shows git branch, commit, and build info
 * Useful for debugging and verifying the running version
 * Only visible in development mode
 */
export default function DebugInfo() {
  const [isExpanded, setIsExpanded] = useState(false);

  // Don't render in production
  if (versionInfo.environment === 'production') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {isExpanded ? (
        // Expanded view with full details
        <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-4 max-w-md">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Code size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-white">Build Info</h3>
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
              <span className="text-gray-400">Phase:</span>
              <span className="text-purple-400 text-right">
                Phase 2: Crop Tool with Keyframe Animation
              </span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-gray-400">Branch:</span>
              <span className="text-green-400 text-right break-all">
                {versionInfo.branch}
              </span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-gray-400">Commit:</span>
              <span className="text-blue-400">
                {versionInfo.commit}
              </span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-gray-400">Full Hash:</span>
              <span className="text-blue-300 text-right break-all text-[10px]">
                {versionInfo.commitFull}
              </span>
            </div>

            <div className="flex justify-between gap-4">
              <span className="text-gray-400">Built:</span>
              <span className="text-yellow-400 text-right">
                {versionInfo.buildTime}
              </span>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-gray-700">
            <p className="text-[10px] text-gray-500">
              Take a screenshot of this info when reporting issues
            </p>
          </div>
        </div>
      ) : (
        // Collapsed view - small badge
        <button
          onClick={() => setIsExpanded(true)}
          className="bg-gray-900 border border-gray-700 rounded-lg shadow-lg px-3 py-2 flex items-center gap-2 hover:bg-gray-800 transition-colors group"
        >
          <Code size={14} className="text-blue-400" />
          <span className="text-xs font-mono text-gray-300">
            {versionInfo.commit}
          </span>
          <ChevronUp size={12} className="text-gray-500 group-hover:text-gray-300" />
        </button>
      )}
    </div>
  );
}
