import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * T5070 — checkAppVersion is the single shared definition of "what counts as
 * a version mismatch", used by both sessionInit.js's passive header check and
 * pwaUpdate.js's active poll. bootVersion/candidate state is intentionally a
 * module-scoped singleton (persists for the page's lifetime) with no reset
 * export, so each test dynamically re-imports a fresh module instance via
 * resetModules.
 *
 * Debounced to 2 consecutive matching observations (M2): a Fly rolling
 * deploy serves a mixed fleet of old/new COMMIT_SHAs, so a client can
 * legitimately see v1 -> v2 -> v1 -> v2 across successive requests. Gating
 * on a single differing observation would reload-loop that client.
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

  it('does NOT raise the gate on a single differing observation (G3: no single-blip gating)', async () => {
    const { checkAppVersion } = await import('./appVersion');
    const { useUpdateGateStore } = await import('../stores/updateGateStore');

    checkAppVersion('abc123'); // latches boot version
    checkAppVersion('def456'); // one differing observation only

    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('raises the gate (reason: version-mismatch) once the SAME new version is observed twice (G3)', async () => {
    const { checkAppVersion } = await import('./appVersion');
    const { useUpdateGateStore } = await import('../stores/updateGateStore');

    checkAppVersion('abc123');
    checkAppVersion('def456');
    checkAppVersion('def456');

    const state = useUpdateGateStore.getState();
    expect(state.isUpdateRequired).toBe(true);
    expect(state.reason).toBe('version-mismatch');
  });

  it('does not gate on a mixed-fleet blip that alternates and never repeats (G3)', async () => {
    const { checkAppVersion } = await import('./appVersion');
    const { useUpdateGateStore } = await import('../stores/updateGateStore');

    checkAppVersion('v1'); // boot
    checkAppVersion('v2'); // candidate v2, count 1
    checkAppVersion('v1'); // back to boot -> candidate reset
    checkAppVersion('v2'); // candidate v2 again, count 1 (not 2)

    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('does not raise the gate when the value repeats the boot version', async () => {
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
    checkAppVersion('def456');
    expect(useUpdateGateStore.getState().reason).toBe('version-mismatch');

    // requireUpdate itself guards on isUpdateRequired, so further drift while
    // the gate is already up is a no-op, not a second state transition.
    checkAppVersion('ghi789');
    checkAppVersion('ghi789');
    expect(useUpdateGateStore.getState().reason).toBe('version-mismatch');
  });
});
