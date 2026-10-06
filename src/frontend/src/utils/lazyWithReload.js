import { lazy } from 'react';

const RELOAD_KEY = 'chunk-reload';
// A reload only counts as "already tried" for this long. A flag that lives for the whole
// tab session goes stale: the post-reload page often lands on a screen with no lazy chunk,
// so nothing clears it, and the NEXT deploy's stale chunk never gets its reload.
const RELOAD_GUARD_MS = 30_000;

function reloadedRecently() {
  const at = Number(sessionStorage.getItem(RELOAD_KEY));
  return Number.isFinite(at) && at > 0 && Date.now() - at < RELOAD_GUARD_MS;
}

/**
 * React.lazy wrapper for route chunks. After a deploy the old hashed chunk is gone from
 * the CDN (Pages serves index.html for it). Reload once so the browser fetches the new
 * HTML with current hashes; if a reload just happened and it still fails, surface the error.
 */
export function lazyWithReload(importFn) {
  return lazy(() => importFn().catch(err => {
    if (reloadedRecently()) throw err;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
    return new Promise(() => {});
  }));
}
