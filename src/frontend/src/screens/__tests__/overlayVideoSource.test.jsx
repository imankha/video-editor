import { describe, it, expect } from 'vitest';
import { deriveOverlayVideoSource } from '../OverlayScreen';

// T9150: pins the invariant that closes the T9100 bug class -- one video's url must
// never be paired with a DIFFERENT video's metadata (the source clip's
// framingMetadata). T4490: the input is projectDataStore's one working-video slice
// ({status, videoId, video, error}); only a 'ready' slice for this project's
// working_video_id is used, and a 'ready' slice always carries url + metadata.

const REEL_URL = 'https://r2.example.com/reel.mp4';
const REEL_METADATA = { width: 810, height: 1440, duration: 12, fps: 30 };
const SOURCE_CLIP_URL = 'https://r2.example.com/source-clip.mp4';
const SOURCE_CLIP_METADATA = { width: 1920, height: 1080, duration: 900, fps: 30 };

const slice = (status, videoId, video = null) => ({ status, projectId: 1, videoId, video, error: null });
const IDLE = slice('idle', null);
const READY = slice('ready', 70, { file: null, url: REEL_URL, metadata: REEL_METADATA });
const derive = (workingVideo, projectWorkingVideoId) => deriveOverlayVideoSource({
  workingVideo,
  projectWorkingVideoId,
  framingVideoUrl: SOURCE_CLIP_URL,
  framingMetadata: SOURCE_CLIP_METADATA,
});

describe('deriveOverlayVideoSource (T9150, T4490 slice)', () => {
  it('uses the working video when the slice is ready for this working_video_id', () => {
    const result = derive(READY, 70);
    expect(result.workingVideoUsable).toBe(true);
    expect(result.effectiveOverlayVideoUrl).toBe(REEL_URL);
    expect(result.effectiveOverlayMetadata).toBe(REEL_METADATA);
    expect(result.shouldWaitForWorkingVideo).toBe(false);
  });

  it('falls back to the source clip (pass-through) only when there is no working video at all', () => {
    const result = derive(IDLE, null);
    expect(result.workingVideoUsable).toBe(false);
    expect(result.effectiveOverlayVideoUrl).toBe(SOURCE_CLIP_URL);
    expect(result.effectiveOverlayMetadata).toBe(SOURCE_CLIP_METADATA);
  });

  it.each([
    ['idle (the frame before the load starts)', IDLE],
    ['loading', slice('loading', 70)],
    ['error', slice('error', 70)],
    ['missing', slice('missing', 70)],
    ['ready for an OLDER render', { ...READY, videoId: 69 }],
  ])('waits (returns nulls) while the slice is %s, never falling through to the source clip', (_label, workingVideo) => {
    const result = derive(workingVideo, 70);
    expect(result.shouldWaitForWorkingVideo).toBe(true);
    expect(result.workingVideoUsable).toBe(false);
    expect(result.effectiveOverlayVideoUrl).toBeNull();
    expect(result.effectiveOverlayMetadata).toBeNull();
  });
});
