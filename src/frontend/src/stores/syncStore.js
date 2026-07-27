/**
 * Sync Status Store (T87, T5870)
 *
 * Tracks the backend's R2 sync state, surfaced via the `X-Sync-Status` response
 * header. A global fetch interceptor (installed at import time) checks every
 * response, so no per-call-site instrumentation is needed.
 *
 * T5870: THREE honest states, not the old "any pending == failed" boolean:
 *   'ok'       — nothing to show.
 *   'pending'  — a write is queued/deferred and the backend is still delivering
 *                it (bounded re-drain). QUIET "backup pending", NEVER "not saving".
 *   'failed'   — a real R2 failure the re-drain could not heal. Alarm + Retry.
 *   'conflict' — a CAS refusal (T4310). Alarm + Retry-that-restores (the backend
 *                pulls the newer R2 copy; a blind retry would loop forever).
 */

import { create } from 'zustand';
import { API_BASE } from '../config';
import { toast } from '../components/shared/Toast';

// A conflict Retry that RESTORES R2's newer copy has replaced the user's local
// edit on disk. We must tell them and reload (so the in-memory UI matches the
// restored DB) — but the reload wipes any live toast, so the notice is stashed
// here and surfaced on the next load (surfaceRestoredNoticeIfPending, below).
const RESTORED_NOTICE_KEY = 't5870_restored_notice';

function stashRestoredNotice() {
  try {
    sessionStorage.setItem(RESTORED_NOTICE_KEY, '1');
  } catch {
    /* sessionStorage unavailable — the toast still fires if we reach it live */
  }
}

// Indirected so tests can assert the reload without navigating jsdom.
export function reloadPage() {
  window.location.reload();
}

export const useSyncStore = create((set, get) => ({
  syncState: 'ok', // 'ok' | 'pending' | 'failed' | 'conflict'
  isRetrying: false,
  isOffline: !navigator.onLine,

  // T5960: has THIS session attempted a write? The `.sync_conflict` marker is
  // sticky on the backend — it outlives the session whose write was refused and
  // attaches to whatever session loads next, including a read-only one. We hold
  // the 'conflict' state either way but gate its ALARM on a real write-attempt,
  // so a passive reader never gets told their (never-made) work couldn't save.
  // Ephemeral per-session fact, NOT persisted (no localStorage/SQLite/R2).
  hasAttemptedWrite: false,

  setSyncState: (state) => set({ syncState: state }),
  setOffline: (offline) => set({ isOffline: offline }),
  markWriteAttempted: () => set({ hasAttemptedWrite: true }),

  retrySyncToR2: async () => {
    if (get().isRetrying) return false;
    set({ isRetrying: true });
    try {
      const response = await _originalFetch(`${API_BASE}/api/retry-sync`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.restored) {
        // BLOCKING (round 2): the conflict was resolved by REPLACING the local
        // edit with a newer copy from R2 — the user's unsynced change is gone from
        // disk. NEVER silently flip to 'ok' (the browser still renders the discarded
        // edit, and the next gesture would write into a DB that no longer has it).
        // Tell the user and reload so in-memory state matches the restored DB.
        stashRestoredNotice();
        reloadPage();
        return true;
      }
      if (data.success) {
        // A plain transient recovery. The next response's header confirms 'ok' too.
        set({ syncState: 'ok' });
      }
      return data.success;
    } catch {
      return false;
    } finally {
      set({ isRetrying: false });
    }
  },
}));

/**
 * Surface the "your local changes were replaced" notice if a conflict-restore
 * reload just happened. Called once at module load (post-reload). Persistent
 * (duration 0) so the user cannot miss that work was superseded.
 */
export function surfaceRestoredNoticeIfPending() {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    if (!sessionStorage.getItem(RESTORED_NOTICE_KEY)) return false;
    sessionStorage.removeItem(RESTORED_NOTICE_KEY);
  } catch {
    return false;
  }
  toast.error('Your local changes were replaced', {
    message:
      'A newer version of your work, saved on another device, replaced your unsynced edits.',
    duration: 0,
    dedupKey: 'sync-conflict-restored',
  });
  return true;
}

surfaceRestoredNoticeIfPending();

// Listen for browser online/offline events. Coming back online with a genuine
// failure (failed/conflict) auto-retries. 'pending' is left to the backend
// re-drain — it is not a failure and needs no client action.
// round 2 MINOR-2 (intended): a DURABLE-path failure surfaces via its own 503
// gesture UX (overlay/clip/publish toasts with their own Retry) and leaves only
// .sync_pending on surface A (quiet 'pending'), so it is deliberately NOT part of
// this reconnect auto-retry — the owning gesture is the single retry trigger.
window.addEventListener('offline', () => {
  useSyncStore.getState().setOffline(true);
});

window.addEventListener('online', () => {
  const store = useSyncStore.getState();
  store.setOffline(false);
  if (store.syncState === 'failed' || store.syncState === 'conflict') {
    store.retrySyncToR2();
  }
});

/**
 * Map the X-Sync-Status header onto the store's syncState.
 *
 * @param {Response} response - The fetch Response object
 */
export function checkSyncStatus(response) {
  if (!response || !response.headers) return;

  const header = response.headers.get('X-Sync-Status');
  const next =
    header === 'pending' || header === 'failed' || header === 'conflict'
      ? header
      : 'ok';

  const store = useSyncStore.getState();
  if (store.syncState !== next) {
    store.setSyncState(next);
  }
}

// --- Write-attempt detection (T5960 / T6020) ---
// The interceptor already receives the request args, so this is the single seam
// for "has this session issued a mutating request to our own API" — no flag
// threaded through every call site. Only OUR API can produce a sync conflict; a
// mutating request to a foreign origin (e.g. an R2 presigned upload) must NOT
// arm it, and a GET must never arm it.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// T6020 (+ follow-up): a mutating request only arms the write-attempt gate if it
// COULD produce a user-data sync conflict. The exclusion's real semantic is NOT
// "non-gesture" or "lifecycle" — it's narrower and easy to misjudge:
//
//   this request cannot touch the user's profile SQLite (the thing
//   .sync_conflict / .sync_failed describe), so it can never be the write a
//   stale marker is actually about.
//
// The first cut of this key was named `rbLifecycleWrite` and reasoned about
// "fires without a user gesture". That name actively misled at the auth
// call sites: `POST /api/auth/google` / `verify-otp` / `send-otp` / `logout` /
// `report-problem` ARE user gestures (clicking "Log in", clicking "Log out") but
// still qualify, because they write Postgres auth tables, never the profile
// SQLite — they structurally cannot set `.sync_conflict`/`.sync_failed`. A
// gap in the task's original call-site table left these five unmarked, which
// re-armed the gate on every real login (a supervisor-audit-caught regression
// vs the T5960 baseline, since a login is exactly when a user is most likely
// to be carrying a stale marker from a prior session). Renamed to
// `rbNonDataWrite` so the key states the true semantic instead of a
// gesture/non-gesture distinction that doesn't hold at the auth boundary.
//
// Classification used to be a URL denylist here, but `PATCH
// /api/projects/{id}/state` is BOTH a non-data write (project-open bookkeeping,
// useProjectLoader.js) AND a real user-data gesture (mode-switch, App.jsx) at the
// identical pathname — a pathname-only matcher structurally cannot tell them
// apart. Fixed by inverting the mechanism: each non-data write marks itself
// `rbNonDataWrite: true` in its own fetch options at the call site
// (utils/apiFetch.js passes options straight through to `fetch`, which ignores
// unknown RequestInit keys, so this needs no plumbing). `grep rbNonDataWrite`
// finds every marked call site — see CLAUDE.md Refactoring Rules #6
// (greppability over registry indirection).
//
// The mechanism deliberately fails toward "forgot to mark a non-data write"
// (gate arms spuriously -> stale alarm on a passive load, annoying but
// recoverable) and NOT toward "forgot to allowlist a user-data write" (a real
// writer's conflict is silently suppressed — data-loss-shaped). Do not invert
// this into an allowlist.
const NON_DATA_WRITE_KEY = 'rbNonDataWrite';

// Returns the pathname if `rawUrl` targets our own API, else null.
function ownApiPathname(rawUrl) {
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (!url.pathname.startsWith('/api/')) return null;
    if (url.origin === window.location.origin) return url.pathname;
    if (Boolean(API_BASE) && url.origin === new URL(API_BASE).origin) return url.pathname;
    return null;
  } catch {
    // Unparseable input — fail safe (do not arm on something we can't classify).
    return null;
  }
}

/**
 * Is this a mutating (POST/PUT/PATCH/DELETE) request to our own API that
 * touches USER DATA — i.e. one that could produce a sync conflict?
 *
 * `method` may be lowercase, absent (defaults to GET), or carried on a `Request`
 * object passed as the first fetch arg instead of in the init object. A call
 * site marks itself `init.rbNonDataWrite = true` to declare "this write cannot
 * touch the user's profile SQLite" (see NON_DATA_WRITE_KEY above) — this is
 * NOT the same as "not a user gesture": logging in/out IS a gesture but is
 * still marked, because it writes Postgres auth tables, never the data a sync
 * conflict describes. Everything else mutating to our own API counts as a
 * potential user-data write.
 *
 * @param {RequestInfo|URL} input - fetch's first arg (URL string, URL, or Request)
 * @param {RequestInit} [init] - fetch's second arg
 */
export function isMutatingApiRequest(input, init) {
  const method = (
    init?.method ??
    (input instanceof Request ? input.method : undefined) ??
    'GET'
  ).toUpperCase();
  if (!MUTATING_METHODS.has(method)) return false;

  const rawUrl = input instanceof Request ? input.url : String(input ?? '');
  const pathname = ownApiPathname(rawUrl);
  if (pathname === null) return false;
  return !init?.[NON_DATA_WRITE_KEY];
}

// --- Global fetch interceptor ---
// Wraps window.fetch so every response is automatically checked for the
// X-Sync-Status header. This is infrastructure-level: no individual API
// call sites need to know about sync status.

const _originalFetch = window.fetch.bind(window);

window.fetch = async function (...args) {
  // Arm the write-attempt gate BEFORE awaiting: issuing the request IS the
  // attempt, even if it ultimately fails. Idempotent — set once per session.
  if (isMutatingApiRequest(args[0], args[1])) {
    const store = useSyncStore.getState();
    if (!store.hasAttemptedWrite) store.markWriteAttempted();
  }
  const response = await _originalFetch(...args);
  checkSyncStatus(response);
  return response;
};
