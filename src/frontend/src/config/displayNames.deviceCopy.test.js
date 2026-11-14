import { describe, it, expect } from 'vitest';
import { FOCUS_HINTS, UPLOAD } from './displayNames';

// T15620: copy that renders on desktop and iPad (not just phones) must not say
// "phone". ROTATE_TITLE shows on any `isMobile` device (useIsMobile matches
// touch tablets too, not just narrow phones); NO_VIDEO_TOGGLE shows in the
// Upload game modal on every device, desktop included.
describe('T15620 device-neutral copy', () => {
  it('RotateNudge title does not say phone', () => {
    expect(FOCUS_HINTS.ROTATE_TITLE.toLowerCase()).not.toContain('phone');
  });

  it('No-video-help toggle does not say phone', () => {
    expect(UPLOAD.NO_VIDEO_TOGGLE.toLowerCase()).not.toContain('phone');
  });
});
