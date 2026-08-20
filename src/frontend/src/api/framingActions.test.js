import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { addCropKeyframe, setRotation } from './framingActions';

/**
 * T4330 -- characterization coverage for framingActions' CURRENT return shape.
 *
 * There was no dedicated test file for this module before T4330. Once
 * framingActions.js migrates to route through the new `actionClient`
 * (design doc docs/plans/tasks/T4330-design.md section 3.2), its exported
 * functions must keep returning exactly this shape --
 * `{success, refresh_required?, new_clip_id?, error?}` -- so no caller changes.
 *
 * These tests pass against TODAY's code (no migration has happened yet) and
 * must KEEP passing after the actionClient migration lands -- they pin the
 * contract framingActions promises its callers (FramingContainer.jsx).
 */
vi.mock('../config', () => ({ API_BASE: 'http://test.local' }));

const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => apiFetch(...args) }));

const bodyOf = (call) => JSON.parse(call[1].body);

describe('framingActions -- return shape parity (T4330 characterization)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('addCropKeyframe returns {success, refresh_required, new_clip_id} on success', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, refresh_required: false }),
    });

    const result = await addCropKeyframe(7, 42, { frame: 0, x: 0, y: 0, width: 100, height: 100 });

    expect(result).toEqual({ success: true, refresh_required: false });

    const body = bodyOf(apiFetch.mock.calls[0]);
    expect(body.action).toBe('add_crop_keyframe');
  });

  it('addCropKeyframe returns {success:false, error} on failure -- no version/status field today', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: 'Keyframe too close to an existing one' }),
    });

    const result = await addCropKeyframe(7, 42, { frame: 5, x: 0, y: 0, width: 100, height: 100 });

    expect(result).toEqual({ success: false, error: 'Keyframe too close to an existing one' });
    // Pin today's gap explicitly: framingActions does NOT surface response.status
    // yet (unlike overlayActions). If this flips to `true` it means the
    // actionClient migration changed the wrapper's error shape -- the design
    // doc says that must stay backward compatible.
    expect(result).not.toHaveProperty('status');
  });

  it('setRotation (the second framing write path) returns the same shape', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, refresh_required: false }),
    });

    const result = await setRotation(7, 42, 3.5);

    expect(result).toEqual({ success: true, refresh_required: false });
    const body = bodyOf(apiFetch.mock.calls[0]);
    expect(body.action).toBe('set_rotation');
    expect(body.data).toEqual({ rotation: 3.5 });
  });
});
