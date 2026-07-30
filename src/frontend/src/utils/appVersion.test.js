import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkServerVersion,
  setBundleProbe,
  __setClientBuildForTest,
  __resetProbeStateForTest,
} from './appVersion';
import { useUpdateGateStore } from '../stores/updateGateStore';

/**
 * Tbug40p — checkServerVersion raises the blocking update gate when the deployed
 * server's build number is STRICTLY GREATER than this running client's baked build
 * number. No latch, no debounce, no ack.
 *
 * Tbug41s — AND only when a newer client bundle is actually obtainable. The build
 * comparison alone proves the SERVER moved, not that there is anything newer to
 * load; with path-filtered deploy workflows a backend-only commit makes it true
 * forever, stranding the user in a modal whose only exit is a bundle that does not
 * exist.
 *
 * The client build is a build-time constant; __setClientBuildForTest injects a
 * deterministic value so each case controls the client/server relationship.
 */
describe('checkServerVersion', () => {
  beforeEach(() => {
    useUpdateGateStore.setState({ isUpdateRequired: false, needsMigration: false });
    __setClientBuildForTest(100);
    __resetProbeStateForTest();
    // Default for the Tbug40p cases: a newer bundle IS available, so those cases
    // exercise the build comparison in isolation. Tbug41s cases override this.
    setBundleProbe(async () => true);
  });

  it('(a) does NOT gate when the server build equals the client build (steady version, Safari resume)', async () => {
    await checkServerVersion(100);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('(a) never re-gates no matter how many times an equal build is observed (kills bug40 re-nag)', async () => {
    await checkServerVersion(100);
    await checkServerVersion(100);
    await checkServerVersion(100);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('(b) gates when the server build is strictly newer AND a bundle is waiting (a real deploy)', async () => {
    await checkServerVersion(101);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
    // App-code bump routes to a clean reload, not the heavy data-migration path.
    expect(useUpdateGateStore.getState().needsMigration).toBe(false);
  });

  it('(b) gates on the FIRST strictly-newer observation — no 2-observation debounce needed', async () => {
    await checkServerVersion(150);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
  });

  it('(c) does NOT gate on an older straggler backend machine (mixed-fleet safe)', async () => {
    // Client is on 100; a lagging Fly machine still answers with 99.
    await checkServerVersion(99);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('(c) a straggler blip between current observations still never gates', async () => {
    await checkServerVersion(99); // straggler
    await checkServerVersion(100); // current
    await checkServerVersion(99); // straggler again
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('accepts the header as a numeric string (headers are strings)', async () => {
    await checkServerVersion('101');
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
  });

  it('ignores a missing/absent header (null/undefined) — never gates', async () => {
    await checkServerVersion(null);
    await checkServerVersion(undefined);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('ignores a non-numeric header (garbage / very old server) — never gates', async () => {
    await checkServerVersion('not-a-number');
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('a server that forgot the build-arg (advertises 0) never gates a real client', async () => {
    // clientBuild 100 (real deployed client) vs a mis-configured server sending 0.
    await checkServerVersion(0);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });
});

/**
 * Tbug41s regression pins. Each of these gated under Tbug40p and produced an
 * unescapable modal: the gate's exit condition (reload onto a higher build) was
 * unreachable because no higher build existed to reload onto.
 */
describe('checkServerVersion — Tbug41s: never gate without an obtainable bundle', () => {
  beforeEach(() => {
    useUpdateGateStore.setState({ isUpdateRequired: false, needsMigration: false });
    __resetProbeStateForTest();
  });

  it('THE BUG: backend-only deploy (server ahead, no newer bundle) must NOT gate', async () => {
    // Staging 2026-07-30, the exact observed numbers: bundle b130803b = 3163, backend
    // a442ad49 = 3165. Commits 3164-3165 touched zero files under src/frontend, so
    // deploy-frontend.yml never ran and 3163 is the newest bundle that exists.
    __setClientBuildForTest(3163);
    setBundleProbe(async () => false);

    await checkServerVersion(3165);

    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('THE BUG, repeated: clicking "Update now" reloads onto the same bundle and STILL must not gate', async () => {
    __setClientBuildForTest(3163);
    setBundleProbe(async () => false);

    // Each iteration stands for one reload landing back on 3163.
    for (let i = 0; i < 5; i++) {
      __resetProbeStateForTest();
      setBundleProbe(async () => false);
      await checkServerVersion(3165);
    }

    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('no probe registered at all (no ServiceWorker) must NOT gate — unprovable claim', async () => {
    __setClientBuildForTest(100);
    // __resetProbeStateForTest cleared it and nothing re-registered: this is the
    // SW-unsupported / private-mode / failed-registration client.
    await checkServerVersion(101);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('a probe that rejects (offline) must NOT gate', async () => {
    __setClientBuildForTest(100);
    setBundleProbe(async () => {
      throw new Error('offline');
    });
    await checkServerVersion(101);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('once a bundle IS available, the very next check gates (fix does not break real deploys)', async () => {
    __setClientBuildForTest(3163);
    setBundleProbe(async () => false);
    await checkServerVersion(3165);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);

    // The frontend workflow finally runs and publishes 3167.
    __resetProbeStateForTest();
    setBundleProbe(async () => true);
    await checkServerVersion(3167);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
  });

  it('throttles: a server permanently ahead does not fire a probe per API response', async () => {
    __setClientBuildForTest(3163);
    const probe = vi.fn(async () => false);
    setBundleProbe(probe);

    // 10 API responses in quick succession, all carrying X-App-Build: 3165.
    for (let i = 0; i < 10; i++) await checkServerVersion(3165);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('skips the probe entirely once the gate is already up', async () => {
    __setClientBuildForTest(100);
    const probe = vi.fn(async () => true);
    setBundleProbe(probe);

    await checkServerVersion(101);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);

    await checkServerVersion(102);
    await checkServerVersion(103);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
