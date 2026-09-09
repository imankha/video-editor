import { describe, it, expect } from 'vitest';
import { deriveOverlayVideoSource } from '../OverlayScreen';

// T9150: pins the invariant that closes the T9100 bug class -- a half-populated
// workingVideo record (url present, metadata missing, or vice versa) must never
// pair one video's url with a DIFFERENT video's metadata (the source clip's
// framingMetadata). This is the exact shape T8390's reviewer-fix commit produced
// (setWorkingVideo({ file: null, url: previewUrl, metadata: null })), which
// silently poisoned the video->screen transform and starved the settings panel.

const REEL_URL = 'https://r2.example.com/reel.mp4';
const REEL_METADATA = { width: 810, height: 1440, duration: 12, fps: 30 };
const SOURCE_CLIP_URL = 'https://r2.example.com/source-clip.mp4';
const SOURCE_CLIP_METADATA = { width: 1920, height: 1080, duration: 900, fps: 30 };

describe('deriveOverlayVideoSource (T9150)', () => {
  it('never pairs a usable url with a DIFFERENT video\'s metadata when workingVideo.metadata is missing', () => {
    const result = deriveOverlayVideoSource({
      workingVideo: { file: null, url: REEL_URL, metadata: null },
      projectWorkingVideoUrl: REEL_URL,
      isLoadingWorkingVideo: false,
      framingVideoUrl: SOURCE_CLIP_URL,
      framingMetadata: SOURCE_CLIP_METADATA,
    });
    // The dangerous outcome this bug class produces: reel's url + source clip's metadata.
    expect(result.effectiveOverlayVideoUrl === REEL_URL && result.effectiveOverlayMetadata === SOURCE_CLIP_METADATA).toBe(false);
    // The record must be refused entirely (both null, waiting for the loader to repair it),
    // never partially trusted.
    expect(result.workingVideoUsable).toBe(false);
    expect(result.effectiveOverlayVideoUrl).toBeNull();
    expect(result.effectiveOverlayMetadata).toBeNull();
    expect(result.shouldWaitForWorkingVideo).toBe(true);
  });

  it('never pairs a usable metadata with a DIFFERENT video\'s url when workingVideo.url is missing', () => {
    const result = deriveOverlayVideoSource({
      workingVideo: { file: null, url: null, metadata: REEL_METADATA },
      projectWorkingVideoUrl: REEL_URL,
      isLoadingWorkingVideo: false,
      framingVideoUrl: SOURCE_CLIP_URL,
      framingMetadata: SOURCE_CLIP_METADATA,
    });
    expect(result.workingVideoUsable).toBe(false);
    expect(result.effectiveOverlayVideoUrl).toBeNull();
    expect(result.effectiveOverlayMetadata).toBeNull();
  });

  it('uses the working video when the record is fully populated', () => {
    const result = deriveOverlayVideoSource({
      workingVideo: { file: null, url: REEL_URL, metadata: REEL_METADATA },
      projectWorkingVideoUrl: REEL_URL,
      isLoadingWorkingVideo: false,
      framingVideoUrl: SOURCE_CLIP_URL,
      framingMetadata: SOURCE_CLIP_METADATA,
    });
    expect(result.workingVideoUsable).toBe(true);
    expect(result.effectiveOverlayVideoUrl).toBe(REEL_URL);
    expect(result.effectiveOverlayMetadata).toBe(REEL_METADATA);
    expect(result.shouldWaitForWorkingVideo).toBe(false);
  });

  it('falls back to the source clip (pass-through) only when there is no working video at all', () => {
    const result = deriveOverlayVideoSource({
      workingVideo: null,
      projectWorkingVideoUrl: null,
      isLoadingWorkingVideo: false,
      framingVideoUrl: SOURCE_CLIP_URL,
      framingMetadata: SOURCE_CLIP_METADATA,
    });
    expect(result.workingVideoUsable).toBe(false);
    expect(result.effectiveOverlayVideoUrl).toBe(SOURCE_CLIP_URL);
    expect(result.effectiveOverlayMetadata).toBe(SOURCE_CLIP_METADATA);
  });

  it('waits (returns nulls) while a working video is loading, never falling through to the source clip', () => {
    const result = deriveOverlayVideoSource({
      workingVideo: null,
      projectWorkingVideoUrl: REEL_URL,
      isLoadingWorkingVideo: true,
      framingVideoUrl: SOURCE_CLIP_URL,
      framingMetadata: SOURCE_CLIP_METADATA,
    });
    expect(result.shouldWaitForWorkingVideo).toBe(true);
    expect(result.effectiveOverlayVideoUrl).toBeNull();
    expect(result.effectiveOverlayMetadata).toBeNull();
  });

  it('negative control: the banned independent-fallback shape WOULD produce the poisoned pairing', () => {
    // This reproduces the exact pre-fix expression (two separate `||` fallbacks) to prove
    // the test above is a real regression guard, not a tautology.
    const workingVideo = { file: null, url: REEL_URL, metadata: null };
    const shouldWaitBuggy = !workingVideo && (REEL_URL || false);
    const buggyUrl = workingVideo?.url || (shouldWaitBuggy ? null : SOURCE_CLIP_URL);
    const buggyMetadata = workingVideo?.metadata || (shouldWaitBuggy ? null : SOURCE_CLIP_METADATA);
    expect(buggyUrl).toBe(REEL_URL);
    expect(buggyMetadata).toBe(SOURCE_CLIP_METADATA);
    // ^ this is the bug: reel url paired with source clip metadata. deriveOverlayVideoSource
    // (tested above) refuses this pairing entirely.
  });
});
