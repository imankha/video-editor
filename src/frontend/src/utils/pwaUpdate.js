import { registerSW } from 'virtual:pwa-register';
import { toast } from '../components/shared/Toast';

// Long-lived installed PWAs never hit a "next load", so the browser's
// navigation-triggered sw.js re-check never fires — poll instead (T4150).
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * T4150: In-session PWA update. vite.config.js uses registerType 'prompt',
 * so a new build sits in the waiting SW until the user clicks Refresh here.
 */
export function setupPwaUpdatePrompt() {
  const updateSW = registerSW({
    onNeedRefresh() {
      toast.info('New version available', {
        message: 'Refresh to load the latest update.',
        duration: 0,
        action: {
          label: 'Refresh',
          onClick: () => updateSW(true),
        },
      });
    },
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => {
          // Rejection here just means the check couldn't reach the server
          // (offline/flaky network) — the next interval retries.
          registration.update().catch(() => {});
        }, UPDATE_CHECK_INTERVAL_MS);
      }
    },
  });
  return updateSW;
}
