import { describe, it, expect, vi, afterEach } from 'vitest';
import { clipFramerate } from './clipSelectors';

/**
 * T4540: the one clip frame-rate accessor. The clip's stored rate (GET /clips
 * `fps`, working_clips.fps else game_videos.fps) or null -- never a guessed 30 --
 * and a missing rate is reported loudly.
 */
describe('clipFramerate (T4540)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the stored rate of a 60 fps clip', () => {
    expect(clipFramerate({ id: 1, fps: 60 })).toBe(60);
    expect(clipFramerate({ id: 2, fps: 29.97 })).toBe(29.97);
  });

  it('returns null (not 30) and logs an error when the rate is missing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(clipFramerate({ id: 3, fps: null })).toBeNull();
    expect(clipFramerate({ id: 4 })).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls[0][0]).toContain('id=3');
  });

  it('returns null for no clip without logging', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(clipFramerate(null)).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
