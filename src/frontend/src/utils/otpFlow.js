/**
 * T13470: state of an email-code sign-in in progress, shared by OtpAuthForm (which writes it)
 * and the update gate (which must not reload the page under it).
 *
 * A signed-out page reloads itself ~30 s after load when a newer bundle is waiting
 * (updateGateStore.isQuiescent). A parent who taps Send Code and then waits for the email
 * is idle by then, so the reload landed mid-flow and the card came back at the email step.
 */

// The server accepts a code for this long (_OTP_EXPIRY_MINUTES in routers/auth.py).
export const OTP_CODE_TTL_MS = 10 * 60 * 1000;

const PENDING_KEY = 'rb_otp_pending_email';
let inFlight = 0;

/** The sent-code entry ({ email, sentAt }) while its code can still be valid, else null. */
export function readPendingOtp(now = Date.now()) {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (typeof entry?.email !== 'string' || !entry.email || !(now - entry.sentAt < OTP_CODE_TTL_MS)) return null;
    return entry;
  } catch {
    return null; // storage unavailable or an unreadable entry: the step just won't survive a remount
  }
}

export function writePendingOtp(email) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ email, sentAt: Date.now() })); } catch { /* see readPendingOtp */ }
}

export function clearPendingOtp() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* see readPendingOtp */ }
}

/** Run a send-otp / verify-otp request while counting it as sign-in activity. */
export async function trackOtpRequest(request) {
  inFlight += 1;
  try {
    return await request();
  } finally {
    inFlight -= 1;
  }
}

/** True while a request is in flight or a sent code is still waiting to be entered. */
export function isOtpFlowActive(now = Date.now()) {
  return inFlight > 0 || readPendingOtp(now) !== null;
}
