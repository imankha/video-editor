// T14530: every message the upload pipeline emits can reach a parent (the footage row
// prints progress.message), so none may name the mechanism.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../stores/questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));

import { hashAndAnalyze } from './uploadManager';

describe('T14530: upload progress copy', () => {
  it('T14530:C5 hashing and analysis report plain progress', async () => {
    const messages = [];
    const file = new File([new Uint8Array(2048)], 'game.mp4', { type: 'video/mp4' });
    await hashAndAnalyze(file, ({ message }) => messages.push(message));
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message).not.toMatch(/hash|analyz|\d+%/i);
    }
  });
});
