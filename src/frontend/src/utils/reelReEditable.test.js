import { describe, it, expect, vi, beforeEach } from 'vitest';

// allowEnterFraming toasts via the shared Toast singleton; spy on it.
vi.mock('../components/shared/Toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { canReEditReel, allowEnterFraming, LEGACY_MULTICLIP_REFRAME_MESSAGE } from './reelReEditable';
import { toast } from '../components/shared/Toast';

describe('canReEditReel (T11220)', () => {
  it('allows a single-clip reel with an editable project', () => {
    expect(canReEditReel({ project_id: 7, clip_count: 1 })).toBe(true);
  });

  it('allows an unknown clip_count reel (NULL/undefined — possible legacy single-clip)', () => {
    expect(canReEditReel({ project_id: 7, clip_count: null })).toBe(true);
    expect(canReEditReel({ project_id: 7 })).toBe(true);
  });

  it('BLOCKS a legacy multi-clip reel (clip_count > 1)', () => {
    expect(canReEditReel({ project_id: 7, clip_count: 2 })).toBe(false);
    expect(canReEditReel({ project_id: 7, clip_count: 12 })).toBe(false);
  });

  it('blocks a non-editable export (project_id null/0/absent) regardless of clip_count', () => {
    expect(canReEditReel({ project_id: null, clip_count: 1 })).toBe(false);
    expect(canReEditReel({ project_id: 0, clip_count: 1 })).toBe(false);
    expect(canReEditReel({ clip_count: 1 })).toBe(false);
    expect(canReEditReel(null)).toBe(false);
    expect(canReEditReel(undefined)).toBe(false);
  });
});

// allowEnterFraming is the ONE guard every "enter Framing" gesture passes through
// (header ModeSwitcher, App.handleModeChange, OverlayScreen Reapply/Switch tiles,
// DraftTile). Proving it here proves the shared mechanism those call sites use.
describe('allowEnterFraming (T11220 shared re-frame guard)', () => {
  beforeEach(() => { toast.info.mockClear(); });

  it('REFUSES a legacy multi-clip project (clip_count > 1) and surfaces the clear toast', () => {
    expect(allowEnterFraming({ clip_count: 2 })).toBe(false);
    expect(toast.info).toHaveBeenCalledWith(LEGACY_MULTICLIP_REFRAME_MESSAGE);
  });

  it('allows a single-clip project (clip_count === 1) with no toast', () => {
    expect(allowEnterFraming({ clip_count: 1 })).toBe(true);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('allows unknown/absent clip_count (null/undefined/0) and a missing project', () => {
    expect(allowEnterFraming({ clip_count: null })).toBe(true);
    expect(allowEnterFraming({ clip_count: 0 })).toBe(true);
    expect(allowEnterFraming({})).toBe(true);
    expect(allowEnterFraming(null)).toBe(true);
    expect(allowEnterFraming(undefined)).toBe(true);
    expect(toast.info).not.toHaveBeenCalled();
  });
});
