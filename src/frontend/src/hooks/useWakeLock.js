import { useEffect } from 'react';

export function useWakeLock() {
  useEffect(() => {
    if (!navigator.wakeLock) return;

    let active = true;
    let current = null;

    async function request() {
      try {
        const s = await navigator.wakeLock.request('screen');
        if (!active) {
          s.release();
          return;
        }
        current = s;
      } catch (_) {}
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        current?.release();
        current = null;
      } else if (!current || current.released) {
        request();
      }
    }

    request();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      current?.release();
      current = null;
    };
  }, []);
}
