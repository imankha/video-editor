/**
 * T11500: DEV-only fresh-account login. Only ever imported behind
 * `import.meta.env.DEV`, so production bundles never contain it.
 * Login is a user gesture (picker click or ?dev_account= link), never reactive.
 */
import { API_BASE } from '../config';
import apiFetch from './apiFetch';
import { clearProfileHeader } from './sessionInit';

export const DEV_ACCOUNT_PARAM = 'dev_account';

/** GET the preset list. Returns {presets, stackId} on 200, else null. */
export async function probeDevAccounts() {
  try {
    const res = await apiFetch(`${API_BASE}/api/auth/dev-accounts`);
    if (res.status !== 200) return null;
    const data = await res.json();
    return { presets: data.presets, stackId: data.stack_id };
  } catch {
    return null;
  }
}

export function currentUrlWithout(param) {
  const url = new URL(window.location.href);
  url.searchParams.delete(param);
  return url.pathname + url.search + url.hash;
}

/** POST a preset login; on 200 navigate away, on failure throw the backend detail. */
export async function loginAsDevPreset(preset) {
  const res = await apiFetch(`${API_BASE}/api/auth/dev-accounts/${encodeURIComponent(preset)}`, {
    method: 'POST',
    rbNonDataWrite: true, // T6020: auth gesture, not user-data write
  });
  if (!res.ok) {
    let detail = `Dev login failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.code ? `${body.code}: ${body.detail}` : body.detail;
    } catch { /* keep default */ }
    throw new Error(detail);
  }
  clearProfileHeader();
  window.location.replace(currentUrlWithout(DEV_ACCOUNT_PARAM));
}

/** Handle ?dev_account=<preset>. Success navigates away; failure strips the param and returns the error message. */
export async function loginFromUrlParam() {
  const preset = new URLSearchParams(window.location.search).get(DEV_ACCOUNT_PARAM);
  if (!preset) return null;
  try {
    await loginAsDevPreset(preset);
    return null;
  } catch (err) {
    window.history.replaceState({}, '', currentUrlWithout(DEV_ACCOUNT_PARAM));
    return err.message;
  }
}
