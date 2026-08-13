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

export const INTRO_IMAGE_PRELOAD_TIMEOUT_MS = 2500;

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
    img.onload = () => {
      // decode() (where available) guarantees the first paint is not a blank
      // decode frame; jsdom has no decode(), so fall through on absence.
      const decoded = typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
      decoded.then(() => settle('loaded'));
    };
    img.onerror = () => {
      console.warn(`[preloadIntroImage] photo failed to load — the intro will play without it (url=${url})`);
      settle('error');
    };
    img.src = url;
  });
}

export default preloadIntroImage;
