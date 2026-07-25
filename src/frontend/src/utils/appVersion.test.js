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
    // Acknowledged-build id persists in sessionStorage across page loads; clear
    // it between tests so each starts from a clean baseline (bug39).
    sessionStorage.clear();
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

  /**
   * bug39 — the acknowledged build id (persisted by the "Update now" gesture)
   * must survive a reload and suppress re-gating for the build the user already
   * accepted, WITHOUT suppressing a genuinely newer build.
   */
  describe('acknowledged-build persistence (bug39)', () => {
    it('acknowledgeAppVersion persists the candidate that raised the gate', async () => {
      const { checkAppVersion, acknowledgeAppVersion } = await import('./appVersion');

      checkAppVersion('v1');   // boot
      checkAppVersion('v2');   // candidate v2, count 1
      checkAppVersion('v2');   // count 2 -> gate raised for v2
      acknowledgeAppVersion(); // user clicked "Update now" onto v2

      expect(sessionStorage.getItem('rb_ack_app_version')).toBe('v2');
    });

    it('symptom 1/3: after acknowledging v2 + reload, a mixed-fleet re-latch of v1 then v2 does NOT re-gate', async () => {
      // Session 1: see the drift to v2 and acknowledge it.
      const first = await import('./appVersion');
      first.checkAppVersion('v1');
      first.checkAppVersion('v2');
      first.checkAppVersion('v2');
      first.acknowledgeAppVersion(); // persists v2 across the reload

      // Reload: fresh module instance, but sessionStorage (acknowledged=v2)
      // survives. The mixed fleet answers with an OLDER machine first, so boot
      // re-latches v1 — the exact bug39 re-latch.
      vi.resetModules();
      const { checkAppVersion } = await import('./appVersion');
      const { useUpdateGateStore } = await import('../stores/updateGateStore');
      useUpdateGateStore.setState({ isUpdateRequired: false, reason: null });

      checkAppVersion('v1'); // boot latches the old machine's sha
      checkAppVersion('v2'); // already acknowledged -> must NOT start a candidate
      checkAppVersion('v2'); // still must NOT gate

      expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
    });

    it('still gates for a genuinely NEWER build after acknowledging v2', async () => {
      const first = await import('./appVersion');
      first.checkAppVersion('v1');
      first.checkAppVersion('v2');
      first.checkAppVersion('v2');
      first.acknowledgeAppVersion(); // acknowledged = v2

      vi.resetModules();
      const { checkAppVersion } = await import('./appVersion');
      const { useUpdateGateStore } = await import('../stores/updateGateStore');
      useUpdateGateStore.setState({ isUpdateRequired: false, reason: null });

      checkAppVersion('v2'); // boot on the acknowledged build
      checkAppVersion('v3'); // a real new deploy, candidate v3 count 1
      checkAppVersion('v3'); // count 2 -> gate

      const state = useUpdateGateStore.getState();
      expect(state.isUpdateRequired).toBe(true);
      expect(state.reason).toBe('version-mismatch');
    });
  });
});
