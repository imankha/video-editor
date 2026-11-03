// T14530: which error text may a parent read?
//
// An ordinary Error holds developer text (status codes, exception messages), so it goes
// to the console and the parent reads the caller's fallback. UserFacingError marks text
// written for a parent: our own copy, or the reason the server wrote in `detail`.
import { ERROR_COPY } from '../config/displayNames';

export class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserFacingError';
  }
}

// The reason the server wrote for the user, or null. A validation array or an object
// without a message is developer text, so it never qualifies.
export function plainServerDetail(body) {
  const detail = body?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (typeof detail?.message === 'string' && detail.message) return detail.message;
  if (typeof body?.message === 'string' && body.message) return body.message;
  return null;
}

// For a failed response: logs the status and body, keeps only what a parent can read.
export function serverError(response, body, fallback) {
  console.error(`[userError] ${response.status} ${response.url ?? ''}`, body);
  return new UserFacingError(plainServerDetail(body) || fallback);
}

// For a catch block: the text to show. Anything not written for a parent is logged.
export function userErrorMessage(err, fallback) {
  if (err instanceof UserFacingError) return err.message;
  console.error('[userError]', err);
  return fallback;
}

// A failed export's stored `error` is raw server text, so every surface shows this.
export function exportFailureCopy(failure) {
  return failure?.retryable ? ERROR_COPY.SAVE_HIGHLIGHT : ERROR_COPY.MAKE_HIGHLIGHT;
}
