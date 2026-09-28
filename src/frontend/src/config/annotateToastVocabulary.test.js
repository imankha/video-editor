import { describe, it, expect } from 'vitest';
import { ANNOTATE } from './displayNames';

/**
 * T11150 — the Annotate error-path toasts (ghost-game save failure + import
 * failure, fired from AnnotateContainer) must use Highlight-flow vocabulary:
 * "play"/"plays", never "clip"/"clips". These were inline "clip" literals on
 * base 486054654; the fix single-sources them here as ANNOTATE constants.
 * Red on base (constants absent -> undefined), green on the fix.
 */
describe('Annotate error-toast vocabulary (T11150)', () => {
  it('ghost-game save-failure message uses "play", no "clip"', () => {
    expect(ANNOTATE.GHOST_GAME_SAVE_MESSAGE).toContain('play');
    expect(ANNOTATE.GHOST_GAME_SAVE_MESSAGE).not.toMatch(/clip/i);
  });

  it('import-failure title + message use "plays", no "clip"', () => {
    expect(ANNOTATE.IMPORT_FAILED_TITLE).toBe('Plays not saved');
    expect(ANNOTATE.IMPORT_FAILED_TITLE).not.toMatch(/clip/i);
    expect(ANNOTATE.IMPORT_FAILED_MESSAGE).toContain('plays');
    expect(ANNOTATE.IMPORT_FAILED_MESSAGE).not.toMatch(/clip/i);
  });
});
