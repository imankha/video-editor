/**
 * T8310: a probe-confirmed 404 on a SRC_NOT_SUPPORTED error must classify as
 * VIDEO_UNAVAILABLE (source object gone), NOT format-error — so useVideo skips
 * the 3x/6s retry loop and tells the truth instead of "Video format not
 * supported" (bug 50p). Also pins the pre-existing code-4 branches so the new
 * probeStatus arg can't silently change them.
 */
import { describe, it, expect } from 'vitest';
import { classifyVideoError, VideoErrorKind } from './videoErrorClassifier';

const CODE_SRC_NOT_SUPPORTED = 4;

describe('classifyVideoError - T8310 probe-confirmed 404', () => {
  it('classifies a non-blob code-4 with probeStatus 404 as VIDEO_UNAVAILABLE', () => {
    expect(
      classifyVideoError({
        code: CODE_SRC_NOT_SUPPORTED,
        videoSrc: 'https://r2.example.com/games/abc.mp4?sig=x',
        probeStatus: 404,
      })
    ).toBe(VideoErrorKind.VIDEO_UNAVAILABLE);
  });

  it('classifies a non-blob code-4 with probeStatus 410 (source_expired gate) as VIDEO_UNAVAILABLE', () => {
    expect(
      classifyVideoError({
        code: CODE_SRC_NOT_SUPPORTED,
        videoSrc: 'https://app.example.com/api/clips/projects/1/clips/2/stream',
        probeStatus: 410,
      })
    ).toBe(VideoErrorKind.VIDEO_UNAVAILABLE);
  });

  it('keeps a non-blob code-4 with a healthy probe (206) as FORMAT_ERROR', () => {
    expect(
      classifyVideoError({
        code: CODE_SRC_NOT_SUPPORTED,
        videoSrc: 'https://r2.example.com/games/abc.mp4?sig=x',
        probeStatus: 206,
      })
    ).toBe(VideoErrorKind.FORMAT_ERROR);
  });

  it('keeps a non-blob code-4 with no probe result as FORMAT_ERROR (unchanged default)', () => {
    expect(
      classifyVideoError({
        code: CODE_SRC_NOT_SUPPORTED,
        videoSrc: 'https://r2.example.com/games/abc.mp4?sig=x',
      })
    ).toBe(VideoErrorKind.FORMAT_ERROR);
  });

  it('a 404 on a blob URL stays STALE_BLOB (blob scheme wins over probe)', () => {
    expect(
      classifyVideoError({
        code: CODE_SRC_NOT_SUPPORTED,
        videoSrc: 'blob:https://app.example.com/uuid',
        probeStatus: 404,
      })
    ).toBe(VideoErrorKind.STALE_BLOB);
  });

  it('a non-404 probe status (e.g. 500) does not trigger VIDEO_UNAVAILABLE', () => {
    expect(
      classifyVideoError({
        code: CODE_SRC_NOT_SUPPORTED,
        videoSrc: 'https://r2.example.com/games/abc.mp4?sig=x',
        probeStatus: 500,
      })
    ).toBe(VideoErrorKind.FORMAT_ERROR);
  });
});
