import { registerSW } from 'virtual:pwa-register';
import { toast, useToastStore } from '../components/shared/Toast';

// Long-lived installed PWAs never hit a "next load", and browsers throttle or
// freeze background timers, so the re-check rides visibilitychange instead of
// an interval: returning to the app is exactly the moment to check (T4150).
const UPDATE_CHECK_MIN_GAP_MS = 5 * 60 * 1000;

/**
 * T4150: In-session PWA update. vite.config.js uses registerType 'prompt',
 * so a new build sits in the waiting SW until the user clicks Refresh here.
 */
export function setupPwaUpdatePrompt() {
  let refreshToastId = null;
  let lastCheckAt = 0;

  const updateSW = registerSW({
    onNeedRefresh() {
      showRefreshToast();
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (registration.waiting) {
          // An update is already waiting (e.g. the toast was dismissed) —
          // re-surface the prompt instead of fetching sw.js again.
          showRefreshToast();
          return;
        }
        const now = Date.now();
        if (now - lastCheckAt < UPDATE_CHECK_MIN_GAP_MS) return;
        lastCheckAt = now;
        // Rejection here just means the check couldn't reach the server
        // (offline/flaky network) — the next return to the app retries.
        registration.update().catch(() => {});
      });
    },
  });

  function showRefreshToast() {
    const alreadyShowing =
      refreshToastId !== null &&
      useToastStore.getState().toasts.some((t) => t.id === refreshToastId);
    if (alreadyShowing) return;
    refreshToastId = toast.info('New version available', {
      message: 'Refresh to load the latest update.',
      duration: 0,
      action: {
        label: 'Refresh',
        onClick: () => updateSW(true),
      },
    });
  }
}
