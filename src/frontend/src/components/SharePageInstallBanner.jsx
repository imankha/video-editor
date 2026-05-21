import { Download, Share } from 'lucide-react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

export function SharePageInstallBanner() {
  const { canInstall, canPrompt, platform, promptInstall, dismiss } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-800/90 backdrop-blur border-t border-gray-700">
      <div className="flex items-center gap-2 min-w-0">
        <Download size={16} className="text-purple-400 shrink-0" />
        <p className="text-sm text-gray-300 truncate">
          Get the app to make your own reels
        </p>
      </div>
      {platform === 'ios' ? (
        <p className="text-xs text-gray-400 shrink-0">
          Tap <Share size={12} className="inline text-blue-400" /> then &quot;Add to Home Screen&quot;
        </p>
      ) : canPrompt ? (
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={promptInstall}
            className="px-3 py-1 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors"
          >
            Install
          </button>
          <button
            onClick={dismiss}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      ) : platform === 'android' ? (
        <p className="text-xs text-gray-400 shrink-0">
          Tap <strong className="text-white">&#x22EE;</strong> then &quot;Install app&quot;
        </p>
      ) : null}
    </div>
  );
}
