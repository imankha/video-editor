import { describe, it, expect, beforeEach, vi } from 'vitest';

// T11500: editorStore canonicalizes the URL at module load; it must not strip
// ?dev_account= before initSession() reads it (the link login never ran).
describe('editorStore URL canonicalization keeps ?dev_account', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete window.__popstateHandler;
    vi.resetModules();
  });

  it('preserves dev_account through module-load canonicalization', { timeout: 30000 }, async () => {
    window.history.pushState({}, '', '/?dev_account=full');
    await import('./editorStore');
    expect(new URLSearchParams(window.location.search).get('dev_account')).toBe('full');
  });

  it('still canonicalizes the path and drops other params', async () => {
    window.history.pushState({}, '', '/?foo=1');
    await import('./editorStore');
    expect(window.location.search).toBe('');
  });
});
