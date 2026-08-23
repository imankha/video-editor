import { describe, it, expect } from 'vitest';
import { describeHighlightCarryNote } from './highlightCarryNote';

describe('describeHighlightCarryNote (T4350)', () => {
  it('returns null for no note / clean carry', () => {
    expect(describeHighlightCarryNote(null)).toBeNull();
    expect(describeHighlightCarryNote(undefined)).toBeNull();
    expect(describeHighlightCarryNote('')).toBeNull();
  });

  it('describes a single dropped highlight (singular)', () => {
    const msg = describeHighlightCarryNote('dropped:1');
    expect(msg).toMatch(/1 highlight fell outside/);
    expect(msg).not.toMatch(/highlights fell/);
  });

  it('describes multiple dropped highlights (plural)', () => {
    expect(describeHighlightCarryNote('dropped:3')).toMatch(/3 highlights fell outside/);
  });

  it('ignores a non-positive / malformed dropped count', () => {
    expect(describeHighlightCarryNote('dropped:0')).toBeNull();
    expect(describeHighlightCarryNote('dropped:x')).toBeNull();
  });

  it('describes the multi-clip reset', () => {
    expect(describeHighlightCarryNote('multiclip_reset')).toMatch(/reset after a multi-clip change/);
  });

  it('describes the legacy-uncertain case', () => {
    expect(describeHighlightCarryNote('legacy_uncertain')).toMatch(/double-check your highlight positions/);
  });

  it('returns null for an unknown code', () => {
    expect(describeHighlightCarryNote('something_else')).toBeNull();
    expect(describeHighlightCarryNote(42)).toBeNull();
  });
});
