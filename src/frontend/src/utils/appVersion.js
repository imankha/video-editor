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
 * The first non-null value seen latches as the boot version; any later
 * value that differs means the backend deployed since this client booted.
 */
let bootVersion = null;

export function checkAppVersion(version) {
  if (!version) return;
  if (bootVersion === null) {
    bootVersion = version;
    return;
  }
  if (version !== bootVersion) {
    useUpdateGateStore.getState().requireUpdate('version-mismatch');
  }
}
