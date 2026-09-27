import { Crop } from 'lucide-react';
import { Disc } from '../modes/annotate/components/PlayProgressBadges';
import { BADGE_STATE } from '../modes/annotate/playProgress';
import { clipIsFramed } from '../utils/clipSelectors';
import { ANNOTATE, EDITOR_PANELS } from '../config/displayNames';
import { EDITOR_MODES } from '../stores';

/**
 * FramingHeaderStatus (T11240 R9) — the Focus header's framed/unframed badge.
 *
 * Replaces the deleted ClipSelectorSidebar's per-clip framing badge (T10980):
 * with exactly one clip, the badge's only home is the header. Mounted via
 * UnifiedHeader's `extraControls` slot (App.jsx), FRAMING only. Read-only
 * derivation off the same store-backed clip the export gate reads — no state,
 * no persistence.
 */
export function FramingHeaderStatus({ editorMode, clip }) {
  if (editorMode !== EDITOR_MODES.FRAMING || !clip) return null;

  const framed = clipIsFramed(clip);
  const state = framed ? BADGE_STATE.DONE : BADGE_STATE.UNDONE;

  return (
    <span
      role="img"
      data-testid="clip-framing-badge"
      data-state={state}
      className="ml-2 flex-shrink-0 inline-flex items-center"
      title={framed ? EDITOR_PANELS.CLIP_FRAMED : EDITOR_PANELS.FRAME_CLIP_HINT}
      aria-label={framed ? EDITOR_PANELS.CLIP_FRAMED : ANNOTATE.FRAME_CLIP}
    >
      <Disc state={state} size="sm" Icon={Crop} />
    </span>
  );
}
