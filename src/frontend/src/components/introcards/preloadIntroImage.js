// T6960 — fetch+decode the intro card's photo BEFORE the intro clock starts.
//
// Why this exists: every Play fetches a freshly PRESIGNED R2 URL for the card
// photo (new signature query params each time), so the browser cache never
// helps — each play re-races a photo download against a ~4s card. The hosts
// (IntroStoryPlayer's play switch, IntroPreRoll's self-driven autoplay, the
// edge share page's animation start) hold the clock at t=0 until this
// resolves. Because the SAME url string is then used by the visible <img>,
// the real render is a memory/disk cache hit.
//
// Contract: ALWAYS resolves (never rejects, never hangs) with one of
// 'loaded' | 'error' | 'timeout' | 'no-image'. A broken or slow photo
// degrades to today's behavior — the card plays without it — after the cap,
// with a console.warn. The cap exists because a network resource may simply
// never arrive; it must not hold playback hostage.

// 8s, not 2.5s (T6960 round 2): a real 2.2MB legacy card photo blew a 2.5s cap
// on an ordinary connection, so the gate gave up and the card played photoless
// anyway — the user explicitly prefers holding (card background + skeleton is
// an honest loading state) over playing without the photo. Still bounded: a
// dead URL can't hold playback hostage. New uploads are far smaller (JPEG
// re-encode) and the served URL is cache-stable for ~10min (backend presign
// memoization), so hitting this cap should be rare.
export const INTRO_IMAGE_PRELOAD_TIMEOUT_MS = 8000;

export function preloadIntroImage(url, { timeoutMs = INTRO_IMAGE_PRELOAD_TIMEOUT_MS } = {}) {
  if (!url) return Promise.resolve('no-image');
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      console.warn(`[preloadIntroImage] photo not ready after ${timeoutMs}ms — starting the intro without waiting (url=${url})`);
      settle('timeout');
    }, timeoutMs);

    const img = new Image();
    // The photo races the reel videos' own prefetch for bandwidth the moment
    // Play is clicked; at default priority Chrome happily starves a small
    // image behind a large video stream. The card cannot start without this
    // resource — mark it high priority (no-op where unsupported).
    img.fetchPriority = 'high';
    img.onload = () => {
      // decode() (where available) guarantees the first paint is not a blank
      // decode frame; jsdom has no decode(), so fall through on absence. A
      // decode FAILURE is a degrade path like any other — warn + 'error',
      // never silently reported as loaded.
      if (typeof img.decode === 'function') {
        img.decode().then(
          () => settle('loaded'),
          () => {
            console.warn(`[preloadIntroImage] photo loaded but failed to decode — starting the intro without waiting (url=${url})`);
            settle('error');
          },
        );
      } else {
        settle('loaded');
      }
    };
    img.onerror = () => {
      console.warn(`[preloadIntroImage] photo failed to load — the intro will play without it (url=${url})`);
      settle('error');
    };
    img.src = url;
  });
}

export default preloadIntroImage;
