import { describe, it, expect, vi, beforeEach } from 'vitest';

// T14970: the deep-link lookup reads one object from another of the user's profiles.
describe('fetch interceptor X-Profile-ID (T14970)', () => {
  let underlying;

  beforeEach(async () => {
    vi.resetModules();
    underlying = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }));
    window.fetch = underlying;
    const { reinstallProfileHeader } = await import('./sessionInit');
    reinstallProfileHeader('aaaaaaaa');
  });

  it('sends the current profile by default', async () => {
    await window.fetch('/api/games/1');
    expect(underlying.mock.calls[0][1].headers['X-Profile-ID']).toBe('aaaaaaaa');
  });

  it("keeps a caller's profile for that one request", async () => {
    await window.fetch('/api/games/1', { headers: { 'X-Profile-ID': 'bbbbbbbb' } });
    await window.fetch('/api/games/2');
    expect(underlying.mock.calls[0][1].headers['X-Profile-ID']).toBe('bbbbbbbb');
    expect(underlying.mock.calls[1][1].headers['X-Profile-ID']).toBe('aaaaaaaa');
  });
});
