import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * T5070 — checkAppVersion is the single shared definition of "what counts as
 * a version mismatch", used by both sessionInit.js's passive header check and
 * pwaUpdate.js's active poll. bootVersion is intentionally a module-scoped
 * singleton (persists for the page's lifetime) with no reset export, so each
 * test dynamically re-imports a fresh module instance via resetModules.
 */
describe('checkAppVersion', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('latches the first non-null version without raising the gate', async () => {
    const { checkAppVersion } = await import('./appVersion');
    const { useUpdateGateStore } = await import('../stores/updateGateStore');

    checkAppVersion('abc123');

    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('raises the gate (reason: version-mismatch) when a later value differs', async () => {
    const { checkAppVersion } = await import('./appVersion');
    const { useUpdateGateStore } = await import('../stores/updateGateStore');

    checkAppVersion('abc123');
    checkAppVersion('def456');

    const state = useUpdateGateStore.getState();
    expect(state.isUpdateRequired).toBe(true);
    expect(state.reason).toBe('version-mismatch');
  });

  it('does not raise the gate when the value repeats', async () => {
    const { checkAppVersion } = await import('./appVersion');
    const { useUpdateGateStore } = await import('../stores/updateGateStore');

    checkAppVersion('abc123');
    checkAppVersion('abc123');
    checkAppVersion('abc123');

    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('ignores a null/undefined version (e.g. a response with no header)', async () => {
    const { checkAppVersion } = await import('./appVersion');
    const { useUpdateGateStore } = await import('../stores/updateGateStore');

    checkAppVersion('abc123');
    checkAppVersion(null);
    checkAppVersion(undefined);

    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('does not overwrite the reason once the gate is already required', async () => {
    const { checkAppVersion } = await import('./appVersion');
    const { useUpdateGateStore } = await import('../stores/updateGateStore');

    checkAppVersion('abc123');
    checkAppVersion('def456');
    expect(useUpdateGateStore.getState().reason).toBe('version-mismatch');

    // requireUpdate itself guards on isUpdateRequired, so a second drift while
    // the gate is already up is a no-op, not a second state transition.
    checkAppVersion('ghi789');
    expect(useUpdateGateStore.getState().reason).toBe('version-mismatch');
  });
});
