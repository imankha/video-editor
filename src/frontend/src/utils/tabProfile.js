import { API_BASE } from '../config';

/**
 * The profile this tab is on. A leaf module, so pure code can name the profile on a URL without
 * importing sessionInit, which installs the axios and fetch interceptors.
 */
let tabProfileId = null;

export function getTabProfileId() {
  return tabProfileId;
}

export function setTabProfileId(profileId) {
  tabProfileId = profileId;
}

/**
 * T14970: name this tab's profile on a same-origin media URL. <video> and <img> cannot send
 * X-Profile-ID, so without this they read the ACTIVE profile's row for the same id. Always
 * named, even when the tab matches the active profile now: another tab can switch the account
 * at any moment, and this one would not hear about it.
 */
export function withTabProfile(url) {
  if (!tabProfileId) return url;
  const isSameOrigin = url.startsWith('/') || (API_BASE && url.startsWith(API_BASE));
  if (!isSameOrigin) return url;
  const [path, fragment] = url.split('#');
  const joined = `${path}${path.includes('?') ? '&' : '?'}profile_id=${tabProfileId}`;
  return fragment ? `${joined}#${fragment}` : joined;
}
