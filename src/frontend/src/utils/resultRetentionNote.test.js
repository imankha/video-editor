import { describe, it, expect } from 'vitest';
import { resultRetentionNote } from './resultRetentionNote';
import { RESULT_RETENTION } from '../config/displayNames';

describe('resultRetentionNote (T9870, AC1 retention honesty + AC4 publish guard)', () => {
  it('returns null when there is no project', () => {
    expect(resultRetentionNote(null)).toBeNull();
    expect(resultRetentionNote(undefined)).toBeNull();
  });

  it('a framing (working-video) completion resolves to the one-word "Saved" chip', () => {
    // No final video yet -> getDraftStatus = DRAFT (Focus completion). T10670: the
    // note is now the chip text ("Saved"), not the old drafts sentence.
    const project = { has_final_video: false, is_published: false };
    expect(resultRetentionNote(project)).toBe(RESULT_RETENTION.PRIVATE_DRAFT);
    expect(resultRetentionNote(project)).toBe('Saved');
  });

  it('a finished private result also resolves to the one-word "Saved" chip', () => {
    // Final video, not published -> getDraftStatus = PRIVATE (Overlay completion).
    const project = { has_final_video: true, is_published: false };
    expect(resultRetentionNote(project)).toBe(RESULT_RETENTION.PRIVATE_READY);
    expect(resultRetentionNote(project)).toBe('Saved');
  });

  it('AC4: an already-published reel is NEVER told "only you can see it" and no visibility change is implied', () => {
    const project = { has_final_video: true, is_published: true };
    const note = resultRetentionNote(project);
    expect(note).toBe(RESULT_RETENTION.PUBLISHED);
    expect(note).not.toMatch(/only you can see it/i);
    // T10670: the published chip stays retention-only and signals no visibility
    // change -- the existing share link is unchanged.
    expect(note).toMatch(/link unchanged/i);
  });
});
