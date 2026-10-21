import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigStore } from './configStore';

// T13080: the clip size limit is read ONLY from /api/bootstrap `upload_limits`
// (App.jsx passes data.upload_limits). A mock that sets max_clip_upload_bytes at the
// top level of the bootstrap body never reaches the gate - that was the T12590
// walk's test-setup artifact, not a product bug.
describe('configStore.setFromBootstrap (T13080)', () => {
  beforeEach(() => useConfigStore.setState({ maxClipUploadBytes: null, maxClipDurationS: null }));

  it('reads the limit from the bootstrap upload_limits shape', () => {
    const body = { upload_limits: { max_clip_upload_bytes: 1048576, max_clip_duration_s: 600 } };
    useConfigStore.getState().setFromBootstrap(body.upload_limits);
    expect(useConfigStore.getState().maxClipUploadBytes).toBe(1048576);
    expect(useConfigStore.getState().maxClipDurationS).toBe(600);
  });

  it('a top-level max_clip_upload_bytes (wrong mock shape) leaves the limit unset', () => {
    const body = { max_clip_upload_bytes: 1048576 };
    useConfigStore.getState().setFromBootstrap(body.upload_limits);
    expect(useConfigStore.getState().maxClipUploadBytes).toBeNull();
  });
});
