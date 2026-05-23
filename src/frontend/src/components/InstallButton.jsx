import { useState, useRef, useEffect } from 'react';
import { Download, Smartphone, X, Share } from 'lucide-react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

export function InstallButton() {
  const { canInstall, canPrompt, platform, promptInstall, dismiss } = useInstallPrompt();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!canInstall) return null;

  const handleClick = () => {
    if (canPrompt) {
      promptInstall();
    } else {
      setOpen(!open);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleClick}
        className="flex items-center gap-1.5 px-2 py-1.5 text-sm text-purple-300 hover:text-white hover:bg-purple-600/20 rounded-lg transition-colors"
      >
        <Download size={16} />
        <span className="hidden sm:inline">Install App</span>
      </button>

      {open && (
        <div className="fixed left-1/2 -translate-x-1/2 top-14 w-[calc(100vw-2rem)] max-w-72 sm:absolute sm:left-auto sm:translate-x-0 sm:right-0 sm:top-full sm:mt-2 sm:w-72 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-50 p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
                <Smartphone size={16} className="text-white" />
              </div>
              <h3 className="text-white font-semibold text-sm">Install Reel Ballers</h3>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300">
              <X size={14} />
            </button>
          </div>

          <ul className="space-y-1.5 mb-4 text-sm text-gray-300">
            <li className="flex items-center gap-2">
              <span className="text-purple-400">&#x2713;</span> Home screen icon -- one tap to open
            </li>
            <li className="flex items-center gap-2">
              <span className="text-purple-400">&#x2713;</span> Full screen -- no browser bars
            </li>
            <li className="flex items-center gap-2">
              <span className="text-purple-400">&#x2713;</span> Push alerts when your reel is ready
            </li>
            <li className="flex items-center gap-2">
              <span className="text-purple-400">&#x2713;</span> Uploads keep going if you switch apps
            </li>
          </ul>

          {platform === 'ios' ? (
            <div className="bg-gray-700/50 rounded-lg p-3 text-sm text-gray-300 space-y-2">
              <p className="font-medium text-white">Add to Home Screen</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Tap the Share icon <Share size={14} className="inline text-blue-400" />
                </li>
                <li>Scroll down and tap &quot;Add to Home Screen&quot;</li>
              </ol>
            </div>
          ) : platform === 'android' ? (
            <div className="bg-gray-700/50 rounded-lg p-3 text-sm text-gray-300 space-y-2">
              <p className="font-medium text-white">Install the App</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Tap the browser menu <strong className="text-white">&#x22EE;</strong></li>
                <li>Tap &quot;Install app&quot; or &quot;Add to Home Screen&quot;</li>
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
