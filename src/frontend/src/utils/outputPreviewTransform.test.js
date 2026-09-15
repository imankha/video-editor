import { describe, it, expect } from 'vitest';
import { computeOutputPreviewTransform } from './outputPreviewTransform';

describe('computeOutputPreviewTransform (T9950 Slice 3)', () => {
  it('returns a scale/translate that maps the crop screen rect onto the whole container', () => {
    // Video (1920x1080) letterboxed by width inside a 640-wide container: scale = 640/1920 = 1/3.
    const displayRect = { offsetX: 0, offsetY: 60, width: 640, height: 360, scaleX: 1 / 3, scaleY: 1 / 3 };
    const containerWidth = 640;
    const containerHeight = 480; // 60px letterbox top+bottom (offsetY=60 each side, panOffset=0)
    const crop = { x: 300, y: 150, width: 600, height: 900 }; // some 2:3-ish crop, video-space

    const result = computeOutputPreviewTransform({ crop, displayRect, containerWidth, containerHeight });
    expect(result).not.toBeNull();

    // cropScreen = { x: 300/3, y: 60 + 150/3, width: 600/3, height: 900/3 } = { x:100, y:110, width:200, height:300 }
    const expectedScale = containerWidth / 200; // 3.2
    expect(result.scale).toBeCloseTo(expectedScale, 5);
    expect(result.transformOrigin).toBe('0 0');
    expect(result.transform).toBe(`scale(${expectedScale}) translate(-100px, -110px)`);
  });

  it('fills the box exactly when the crop screen rect already matches the container size', () => {
    const displayRect = { offsetX: 0, offsetY: 0, width: 400, height: 400, scaleX: 1, scaleY: 1 };
    const crop = { x: 0, y: 0, width: 400, height: 400 };
    const result = computeOutputPreviewTransform({ crop, displayRect, containerWidth: 400, containerHeight: 400 });
    expect(result.scale).toBeCloseTo(1, 5);
    expect(result.transform).toBe('scale(1) translate(0px, 0px)');
  });

  it('handles a letterboxed source (video narrower than the output-aspect container)', () => {
    // Portrait output container (900 wide x 1600 tall) showing a landscape source
    // letterboxed by width: displayRect.width === containerWidth, big vertical offset.
    const displayRect = { offsetX: 0, offsetY: 550, width: 900, height: 500, scaleX: 900 / 1920, scaleY: 500 / 1080 };
    const containerWidth = 900;
    const containerHeight = displayRect.height + 2 * displayRect.offsetY; // 1600
    const crop = { x: 660, y: 0, width: 600, height: 1080 }; // 9:16 crop of the 1920x1080 source

    const result = computeOutputPreviewTransform({ crop, displayRect, containerWidth, containerHeight });
    expect(result).not.toBeNull();
    // cropScreen.width = 600 * (900/1920) = 281.25 -> scale = 900/281.25 = 3.2
    expect(result.scale).toBeCloseTo(3.2, 5);
  });

  it('fails closed (returns null) on incomplete inputs', () => {
    const displayRect = { offsetX: 0, offsetY: 0, width: 400, height: 400, scaleX: 1, scaleY: 1 };
    const crop = { x: 0, y: 0, width: 400, height: 400 };
    expect(computeOutputPreviewTransform({ crop: null, displayRect, containerWidth: 400, containerHeight: 400 })).toBeNull();
    expect(computeOutputPreviewTransform({ crop, displayRect: null, containerWidth: 400, containerHeight: 400 })).toBeNull();
    expect(computeOutputPreviewTransform({ crop, displayRect, containerWidth: 0, containerHeight: 400 })).toBeNull();
    expect(computeOutputPreviewTransform({ crop, displayRect, containerWidth: 400, containerHeight: 0 })).toBeNull();
    expect(computeOutputPreviewTransform({ crop: { x: 0, y: 0, width: 0, height: 400 }, displayRect, containerWidth: 400, containerHeight: 400 })).toBeNull();
  });
});
