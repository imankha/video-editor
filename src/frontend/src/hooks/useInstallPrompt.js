import { useState, useEffect, useCallback } from 'react';

const DISMISS_KEY = 'pwa-install-dismissed';

function detectPlatform() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  if (isIOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [pwaDetected, setPwaDetected] = useState(false);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === '1');

  const platform = detectPlatform();

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Real-time check via getInstalledRelatedApps (Chrome 80+)
    // Requires related_applications in manifest — handles uninstalls correctly
    if ('getInstalledRelatedApps' in navigator) {
      navigator.getInstalledRelatedApps().then(apps => {
        if (apps.length > 0) setPwaDetected(true);
      }).catch(() => {});
    }

    // Pick up event if it fired before React mounted
    if (window.__deferredInstallPrompt) {
      setDeferredPrompt(window.__deferredInstallPrompt);
      window.__deferredInstallPrompt = null;
    }

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      window.__deferredInstallPrompt = null;
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const canPrompt = !!deferredPrompt;
  // Installed but user opened the URL in a regular browser tab
  const installedInBrowser = !isInstalled && pwaDetected && !canPrompt;
  // Desktop: only show when native prompt is available (no valid manual instructions)
  // Mobile: show always (manual instructions are correct for iOS/Android)
  const canInstall = !isInstalled && !pwaDetected && !dismissed && (canPrompt || platform !== 'desktop');

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }, []);

  return { canInstall, canPrompt, platform, isInstalled, installedInBrowser, promptInstall, dismiss };
}
