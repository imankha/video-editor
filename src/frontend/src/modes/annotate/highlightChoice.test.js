import { describe, it, expect } from 'vitest';
import { offersHighlightChoice } from './highlightChoice';

// Staging 2026-10-17: Done on a 5-star play while the game was still uploading
// offered "Make highlight now", which opened Focus on a source that doesn't
// exist yet ("Source video expired"). An unfinished upload never offers it.
describe('offersHighlightChoice', () => {
  it('offers the choice for a 5-star play that is not a highlight yet', () => {
    expect(offersHighlightChoice({ rating: 5, autoProjectId: null }, { gameUploading: false })).toBe(true);
  });

  it('never offers it while the game is still uploading', () => {
    expect(offersHighlightChoice({ rating: 5, autoProjectId: null }, { gameUploading: true })).toBe(false);
  });

  it('does not offer it below 5 stars or once the play is a highlight', () => {
    expect(offersHighlightChoice({ rating: 4, autoProjectId: null }, { gameUploading: false })).toBe(false);
    expect(offersHighlightChoice({ rating: 5, autoProjectId: 12 }, { gameUploading: false })).toBe(false);
    expect(offersHighlightChoice(undefined, { gameUploading: false })).toBe(false);
  });
});
