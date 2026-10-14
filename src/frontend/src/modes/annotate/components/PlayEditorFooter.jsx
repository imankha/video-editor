import { ANNOTATE } from '../../../config/displayNames';
import { DeletePlayButton } from './DeletePlayButton';
import { useGuidePulse } from '../../../components/instructions/GuideScope';
import { GUIDE_PULSE } from '../../../components/instructions/guideTargets';

/**
 * PlayEditorFooter -- T12070: the ONE play-editor footer, shared by all four
 * layouts (strip, landscape-inline, portrait-strip, inline). Done is the
 * primary and comes first; Delete play is the ghost-destructive control and
 * comes last. The inline confirm swap stays in DeletePlayButton.
 *
 * Callers own the wrapper (padding, border, sticky) and pass only the actions.
 */
export function PlayEditorFooter({ onDelete, onDone }) {
  const donePulse = useGuidePulse(GUIDE_PULSE.PLAY_EDITOR_DONE);
  return (
    <div data-testid="play-editor-footer" className="grid grid-cols-2 gap-2">
      <button
        onClick={onDone}
        data-testid="play-editor-done"
        className={`flex-none whitespace-nowrap px-4 py-2 coarse-pointer:min-h-[44px] bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors ${donePulse}`}
      >
        {ANNOTATE.DONE}
      </button>
      <div className="min-w-0">
        <DeletePlayButton onDelete={onDelete} />
      </div>
    </div>
  );
}

export default PlayEditorFooter;
