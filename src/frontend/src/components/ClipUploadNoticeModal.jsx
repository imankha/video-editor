import { Info, Plus } from 'lucide-react';
import { Button } from './shared/Button';
import { CLIP_UPLOAD } from '../config/displayNames';
import Guide from './instructions/Guide';
import { resolveGuide } from './instructions/resolveGuide';
import { GuideScope } from './instructions/GuideScope';
import { GUIDE_PULSE } from './instructions/guideTargets';

/**
 * T8380: one-time consequence notice shown BEFORE the "Add Video" file picker
 * opens (once per flow, never once per file). A directly-uploaded clip has no
 * game association (raw_clips.game_id NULL), so it will not be part of a game
 * the user can build future highlights from -- this warns about that, without
 * hard-gating the action (Cancel / Continue). Copy is user-approved and lives
 * in displayNames.CLIP_UPLOAD.
 *
 * Reuses AttachVideoModal's modal shell (backdrop + gray-800 card) but with a
 * blue Info header -- a friendly heads-up, not a warning (softened 2026-10-21).
 */
export function ClipUploadNoticeModal({ isOpen, onCancel, onContinue }) {
  if (!isOpen) return null;

  const guide = resolveGuide({ screen: 'modal', local: { modal: 'clip-upload-notice' } });

  return (
    <GuideScope guides={[guide]}>
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="clip-notice-title"
        className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700"
      >
        <div className="flex items-start gap-3 p-5 border-b border-gray-700">
          <div className="p-2 bg-blue-600/20 rounded-lg shrink-0">
            <Info size={20} className="text-blue-400" />
          </div>
          <h2 id="clip-notice-title" className="text-lg font-semibold text-white mt-1">
            {CLIP_UPLOAD.NOTICE_TITLE}
          </h2>
        </div>

        <div className="p-5">
          <Guide guide={guide} inline testId="modal-guide" />
          <p className="text-sm text-gray-300 leading-relaxed">{CLIP_UPLOAD.NOTICE_BODY}</p>
        </div>

        <div className="p-4 border-t border-gray-700 flex gap-3 justify-end">
          <Button variant="secondary" size="md" onClick={onCancel}>
            {CLIP_UPLOAD.NOTICE_CANCEL}
          </Button>
          <Button variant="success" size="md" icon={Plus} onClick={onContinue} data-testid={GUIDE_PULSE.CLIP_NOTICE_CONTINUE} guideTarget={GUIDE_PULSE.CLIP_NOTICE_CONTINUE}>
            {CLIP_UPLOAD.NOTICE_CONTINUE}
          </Button>
        </div>
      </div>
    </div>
    </GuideScope>
  );
}

export default ClipUploadNoticeModal;
