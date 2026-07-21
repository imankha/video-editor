import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config + apiFetch so the beacon can be exercised without a real network.
vi.mock('../config', () => ({ API_BASE: 'https://api.test' }));
const apiFetchMock = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('./apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

import { stripUrlSignature, reportVideoError } from './videoErrorBeacon';

describe('stripUrlSignature', () => {
  it('returns null for empty / non-string input', () => {
    expect(stripUrlSignature(null)).toBeNull();
    expect(stripUrlSignature(undefined)).toBeNull();
    expect(stripUrlSignature('')).toBeNull();
    expect(stripUrlSignature(123)).toBeNull();
  });

  it('marks blob URLs as "blob" (never leaks the object URL)', () => {
    expect(stripUrlSignature('blob:https://x/abc-123')).toBe('blob');
  });

  it('drops the presigned query signature, keeping only the path', () => {
    const url =
      'https://r2.example.com/staging/users/u/profiles/p/raw_clips/auto_3_4.mp4' +
      '?X-Amz-Signature=deadbeef&X-Amz-Credential=secret';
    expect(stripUrlSignature(url)).toBe(
      '/staging/users/u/profiles/p/raw_clips/auto_3_4.mp4'
    );
  });

  it('keeps the path for a same-origin proxy stream URL', () => {
    expect(stripUrlSignature('/api/clips/projects/5/clips/4/stream?token=x'))
      .toBe('/api/clips/projects/5/clips/4/stream');
  });
});

describe('reportVideoError', () => {
  beforeEach(() => apiFetchMock.mockClear());

  it('POSTs the diagnostic (with userAgent) to the beacon endpoint', () => {
    reportVideoError({ errorCode: 4, retries: 3, srcKey: '/x.mp4' });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = apiFetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/client-errors/video');
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);
    const body = JSON.parse(opts.body);
    expect(body.errorCode).toBe(4);
    expect(body.retries).toBe(3);
    expect(body).toHaveProperty('userAgent');
  });

  it('never throws even if apiFetch rejects (fire-and-forget)', () => {
    apiFetchMock.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    expect(() => reportVideoError({ errorCode: 4 })).not.toThrow();
  });

  it('never throws even if apiFetch throws synchronously', () => {
    apiFetchMock.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => reportVideoError({ errorCode: 4 })).not.toThrow();
  });
});
