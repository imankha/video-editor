import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('./apiFetch', () => ({ default: (...args) => apiFetchMock(...args) }));

import { acknowledgeExportJob } from './acknowledgeExportJob';

// T9790: extracted from FocusCompletionRecovery's private helper so the live
// path (FocusScreen's four gesture handlers) and the recovered path share one
// implementation. Only `acknowledged_at` is affected server-side — the body is
// just the job id list.
describe('acknowledgeExportJob', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ acknowledged: 1 }) });
  });

  it('POSTs the job id as a single-element array to /api/exports/acknowledge', async () => {
    await acknowledgeExportJob('job-xyz');

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = apiFetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/exports/acknowledge');
    expect(opts).toMatchObject({ method: 'POST' });
    expect(opts.body).toBe(JSON.stringify(['job-xyz']));
  });

  it('swallows a failure loudly (logs) instead of throwing — a failed ack just re-prompts next load', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiFetchMock.mockRejectedValue(new Error('network down'));

    await expect(acknowledgeExportJob('job-err')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
