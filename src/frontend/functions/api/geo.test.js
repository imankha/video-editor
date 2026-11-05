// T15100: the edge is the only place that knows the viewer's country.
import { describe, it, expect } from 'vitest';
import { onRequestGet } from './geo.js';

describe('GET /api/geo', () => {
  it('returns the edge country, never cached', async () => {
    const res = await onRequestGet({ request: { cf: { country: 'DE' } } });
    expect(await res.json()).toEqual({ country: 'DE' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns null when the runtime gives no country', async () => {
    const res = await onRequestGet({ request: {} });
    expect(await res.json()).toEqual({ country: null });
  });
});
