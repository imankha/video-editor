// Resolve FocusMode through the module barrel (not './FocusMode' directly) so it
// stays behind the single `./focus` mock seam the FocusModeView test suite uses;
// a direct file import would bypass that stub and mount the real timeline.
import { FocusMode } from './index.js';

/**
 * FocusTimelineBlock - the framing timeline block (FocusMode plus its full
 * prop bundle) as a single reusable unit.
 *
 * Extracted (T10830) from FocusModeView, which rendered this exact block twice
 * with an identical prop set -- once for the ordinary layout and once inside the
 * mobile-fullscreen overlay. A third caller (T10840's landscape cockpit) is
 * imminent, so per the house "abstract on the 3rd duplication" rule the block
 * collapses here first, as pure code motion with zero behavior change.
 *
 * This is a transparent forwarder: every prop passes straight through to
 * FocusMode unchanged, so `showSegments` keeps FocusMode's own `true` default
 * for any caller that omits it. Keep it transparent -- callers own the values.
 */
export function FocusTimelineBlock(props) {
  return <FocusMode {...props} />;
}

export default FocusTimelineBlock;
