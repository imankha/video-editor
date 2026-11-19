import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../components/shared/Toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { allowEnterFraming, LEGACY_MULTICLIP_REFRAME_MESSAGE } from './reelReEditable';
import { toast } from '../components/shared/Toast';

// T17840 C2: the refusal for an old multi-play highlight is one short sentence,
// in today's words, and stays up long enough to read.
describe('T17840 multi-play refusal toast', () => {
  beforeEach(() => { toast.info.mockClear(); });

  it('is one sentence of at most 12 words, without "Focus" or "clip"', () => {
    const msg = LEGACY_MULTICLIP_REFRAME_MESSAGE;
    expect(msg.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(12);
    expect(msg.match(/[.!?](\s|$)/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(msg).not.toMatch(/focus/i);
    expect(msg).not.toMatch(/clip/i);
    expect(msg).toMatch(/several plays/);
    expect(msg).toMatch(/no longer supported/);
  });

  it('stays on screen at least 6 seconds', () => {
    allowEnterFraming({ clip_count: 3 });
    expect(toast.info).toHaveBeenCalledTimes(1);
    const [title, options] = toast.info.mock.calls[0];
    expect(title).toBe(LEGACY_MULTICLIP_REFRAME_MESSAGE);
    expect(options?.duration).toBeGreaterThanOrEqual(6000);
  });
});
