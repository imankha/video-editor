import { describe, it, expect, vi, beforeEach } from 'vitest';

// T8900 — patchPlacement is the SOLE post-insert writer of offset_seconds and
// the single-write contract for the Fix-timing "Done" gesture: exactly ONE
// PATCH carrying the FINAL offset. Mock apiFetch so we assert the call shape.

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { patchPlacement } from './AnnotateContainer';

describe('patchPlacement (T8900 single-write contract)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('fires exactly one PATCH with the final offset_seconds in the body', async () => {
    apiFetch.mockResolvedValue({ ok: true });
    await patchPlacement(42, 3, 12.5);

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toMatch('/api/games/42/videos/3/placement');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ offset_seconds: 12.5 });
  });

  it('sends a negative offset verbatim (video recorded before game zero)', async () => {
    apiFetch.mockResolvedValue({ ok: true });
    await patchPlacement(7, 2, -30);
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ offset_seconds: -30 });
  });

  it('throws on a non-2xx so the Done handler can surface the failure (no silent success)', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(patchPlacement(1, 1, 0)).rejects.toThrow(/500/);
  });
});
