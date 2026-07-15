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
 */
let bootVersion = null;
let candidateVersion = null;
let candidateCount = 0;

export function checkAppVersion(version) {
  if (!version) return;

  if (bootVersion === null) {
    bootVersion = version;
    candidateVersion = null;
    candidateCount = 0;
    return;
  }

  if (version === bootVersion) {
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
    useUpdateGateStore.getState().requireUpdate('version-mismatch');
  }
}
