import { describe, it, expect, beforeEach } from 'vitest';
import { checkServerVersion, __setClientBuildForTest } from './appVersion';
import { useUpdateGateStore } from '../stores/updateGateStore';

/**
 * Tbug40p — checkServerVersion is the whole gate decision: raise the blocking
 * update gate IFF the deployed server's build number is STRICTLY GREATER than
 * this running client's baked build number. No latch, no debounce, no ack.
 *
 * The client build is a build-time constant; __setClientBuildForTest injects a
 * deterministic value so each case controls the client/server relationship.
 */
describe('checkServerVersion', () => {
  beforeEach(() => {
    useUpdateGateStore.setState({ isUpdateRequired: false, needsMigration: false });
    __setClientBuildForTest(100);
  });

  it('(a) does NOT gate when the server build equals the client build (steady version, Safari resume)', () => {
    checkServerVersion(100);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('(a) never re-gates no matter how many times an equal build is observed (kills bug40 re-nag)', () => {
    checkServerVersion(100);
    checkServerVersion(100);
    checkServerVersion(100);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('(b) gates when the server build is strictly newer (a real deploy)', () => {
    checkServerVersion(101);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
    // App-code bump routes to a clean reload, not the heavy data-migration path.
    expect(useUpdateGateStore.getState().needsMigration).toBe(false);
  });

  it('(b) gates on the FIRST strictly-newer observation — no 2-observation debounce needed', () => {
    checkServerVersion(150);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
  });

  it('(c) does NOT gate on an older straggler backend machine (mixed-fleet safe)', () => {
    // Client is on 100; a lagging Fly machine still answers with 99.
    checkServerVersion(99);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('(c) a straggler blip between current observations still never gates', () => {
    checkServerVersion(99); // straggler
    checkServerVersion(100); // current
    checkServerVersion(99); // straggler again
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('accepts the header as a numeric string (headers are strings)', () => {
    checkServerVersion('101');
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(true);
  });

  it('ignores a missing/absent header (null/undefined) — never gates', () => {
    checkServerVersion(null);
    checkServerVersion(undefined);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('ignores a non-numeric header (garbage / very old server) — never gates', () => {
    checkServerVersion('not-a-number');
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });

  it('a server that forgot the build-arg (advertises 0) never gates a real client', () => {
    // clientBuild 100 (real deployed client) vs a mis-configured server sending 0.
    checkServerVersion(0);
    expect(useUpdateGateStore.getState().isUpdateRequired).toBe(false);
  });
});
