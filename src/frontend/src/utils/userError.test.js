import { describe, it, expect, vi, afterEach } from 'vitest';
import { UserFacingError, plainServerDetail, serverError, userErrorMessage, exportFailureCopy } from './userError';
import { ERROR_COPY } from '../config/displayNames';

describe('T14530: userError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows text written for a parent', () => {
    expect(userErrorMessage(new UserFacingError('Too many codes.'), 'fallback')).toBe('Too many codes.');
  });

  it('logs developer text and shows the fallback', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = new Error('Failed to fetch video: 403');
    expect(userErrorMessage(raw, 'fallback')).toBe('fallback');
    expect(logged).toHaveBeenCalledWith('[userError]', raw);
  });

  it.each([
    [{ detail: 'Plain reason.' }, 'Plain reason.'],
    [{ detail: { message: 'Plain reason.', required: 2 } }, 'Plain reason.'],
    [{ message: 'Plain reason.' }, 'Plain reason.'],
    [{ detail: [{ loc: ['body', 'x'], msg: 'field required' }] }, null],
    [{ detail: { code: 'weird_shape' } }, null],
    [null, null],
  ])('reads %j as %j', (body, expected) => {
    expect(plainServerDetail(body)).toBe(expected);
  });

  it('serverError logs the status and falls back when the server wrote no reason', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = serverError({ status: 500, url: '/x' }, {}, 'fallback');
    expect(err).toBeInstanceOf(UserFacingError);
    expect(err.message).toBe('fallback');
    expect(String(logged.mock.calls[0][0])).toContain('500');
  });

  it('exportFailureCopy tells a failed save from a failed render', () => {
    expect(exportFailureCopy({ retryable: true })).toBe(ERROR_COPY.SAVE_HIGHLIGHT);
    expect(exportFailureCopy({ error: 'raw' })).toBe(ERROR_COPY.MAKE_HIGHLIGHT);
  });
});
