import { describe, it, expect } from 'vitest';
import { resultRetentionNote } from './resultRetentionNote';
import { RESULT_RETENTION } from '../config/displayNames';

describe('resultRetentionNote (T9870, AC1 retention honesty + AC4 publish guard)', () => {
  it('returns null when there is no project', () => {
    expect(resultRetentionNote(null)).toBeNull();
    expect(resultRetentionNote(undefined)).toBeNull();
  });

  it('a framing (working-video) completion reads as saved-to-drafts, only you can see it', () => {
    // No final video yet -> getDraftStatus = DRAFT (Focus completion).
    const project = { has_final_video: false, is_published: false };
    expect(resultRetentionNote(project)).toBe(RESULT_RETENTION.PRIVATE_DRAFT);
  });

  it('a finished private result reads as private and ready to watch', () => {
    // Final video, not published -> getDraftStatus = PRIVATE (Overlay completion).
    const project = { has_final_video: true, is_published: false };
    expect(resultRetentionNote(project)).toBe(RESULT_RETENTION.PRIVATE_READY);
  });

  it('AC4: an already-published reel is NEVER told "only you can see it" and no visibility change is implied', () => {
    const project = { has_final_video: true, is_published: true };
    const note = resultRetentionNote(project);
    expect(note).toBe(RESULT_RETENTION.PUBLISHED);
    expect(note).not.toMatch(/only you can see it/i);
    // The reassurance is retention-only; it must not describe a publish/share action.
    expect(note).toMatch(/already published/i);
  });
});
