import { useUpdateGateStore } from '../stores/updateGateStore';

/**
 * T5070 — shared version-mismatch check, the single definition of "what
 * counts as a mismatch" for both places that observe the backend's
 * advertised X-App-Version:
 *   - sessionInit.js's fetch interceptor (passive: reads the header off
 *     every API response already in flight, zero extra requests)
 *   - pwaUpdate.js's on-load + visibilitychange poll (active: catches an
 *     idle PWA that made no API calls, reusing the T4150 5-min throttle)
 *
 * The first non-null value seen latches as the boot version.
 *
 * Debounced on purpose: Fly runs multiple backend machines, and a rolling
 * deploy serves a MIXED fleet of old/new COMMIT_SHAs for a window. Gating on
 * a single differing observation would reload-loop a client that happens to
 * alternate machines (v1 -> v2 -> v1 -> v2 -> ...). The gate only fires once
 * the SAME new version is observed on two consecutive checks; a lone blip
 * that reverts back to the boot version resets the candidate.
 *
 * bug39 — the gate re-fired "a ton" and re-blocked on wake/return. Root cause:
 * the comparison keyed ONLY on `bootVersion`, an in-memory value re-latched on
 * every page load. After the user updated onto v2 and reloaded, the fresh boot
 * could latch an OLDER machine's sha (mixed fleet) and then re-detect v2 as a
 * "mismatch", re-gating a build the user had ALREADY accepted. Fix: persist the
 * acknowledged build id (the version the "Update now" gesture reloaded onto) and
 * never re-gate for it. See acknowledgeAppVersion + updateGateStore.runUpdate.
 */

// Device-local record of the build the user last clicked "Update now" onto.
// sessionStorage (per-tab, survives reload / sleep / bfcache restore) mirrors
// the App.jsx `chunk-reload` marker convention: this is NOT user data, so it
// does not go through SQLite/R2, and it must be readable before login. A fresh
// browser session legitimately re-establishes the baseline from a live load, so
// per-tab (not cross-restart) persistence is exactly the right scope.
const ACK_VERSION_KEY = 'rb_ack_app_version';

let bootVersion = null;
let candidateVersion = null;
let candidateCount = 0;
// The version that actually raised the gate, captured at fire-time. Held
// separately from `candidateVersion` because a later mixed-fleet blip (an old
// machine answering between the gate firing and the user's click) resets the
// candidate — but the build we are gating ON, and will acknowledge, must not
// change out from under the user (bug39).
let gatedVersion = null;

// sessionStorage access can throw (Safari private mode / storage disabled) —
// that is an EXTERNAL browser condition, so degrading to in-memory-only is a
// legitimate fallback (CLAUDE.md: fallbacks are for external deps, not our own
// data). In that mode acknowledgement holds for the current page instance only.
function readAckVersion() {
  try {
    return sessionStorage.getItem(ACK_VERSION_KEY) || null;
  } catch {
    return null;
  }
}

let acknowledgedVersion = readAckVersion();

export function checkAppVersion(version) {
  if (!version) return;

  if (bootVersion === null) {
    bootVersion = version;
    candidateVersion = null;
    candidateCount = 0;
    return;
  }

  // A "current" build — either the one this page booted on, or the one the
  // user already acknowledged updating to — must never re-gate. The
  // acknowledged check is what neutralises the mixed-fleet re-latch (boot may
  // land on an older machine's sha, but seeing the accepted version again is
  // not a new update) and the wake/return re-gate (bug39 symptoms 1 & 3).
  if (version === bootVersion || version === acknowledgedVersion) {
    candidateVersion = null;
    candidateCount = 0;
    return;
  }

  if (version === candidateVersion) {
    candidateCount += 1;
  } else {
    candidateVersion = version;
    candidateCount = 1;
  }

  if (candidateCount >= 2) {
    gatedVersion = version;
    useUpdateGateStore.getState().requireUpdate('version-mismatch');
  }
}

/**
 * The user clicked "Update now". Persist the build we are reloading ONTO so a
 * post-reload boot (which, on Fly's mixed fleet, may briefly latch an older
 * machine's sha) does not re-gate for a version already accepted. The target
 * is the candidate that raised the gate; a pure SW update with no observed
 * backend drift falls back to the boot version (acknowledging "current", a
 * harmless no-op).
 *
 * Gesture-driven only — called from updateGateStore.runUpdate's "Update now"
 * handler, NEVER from a reactive effect (CLAUDE.md: gesture-based persistence).
 */
export function acknowledgeAppVersion() {
  const target = gatedVersion || candidateVersion || bootVersion;
  if (!target) return;
  acknowledgedVersion = target;
  try {
    sessionStorage.setItem(ACK_VERSION_KEY, target);
  } catch {
    // storage disabled — the in-memory acknowledgedVersion still covers this
    // page instance (which is the one about to reload).
  }
}
