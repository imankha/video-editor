import { FolderInput, Sparkles, Crop, ArrowLeft, Loader } from 'lucide-react';
import CtaBar from './shared/CtaBar';
import { OVERLAY_PUBLISH } from '../config/displayNames';

/**
 * OverlayPublishActionBar (T9110, re-hierarchized T9590, celebration tiles T10670,
 * on the shared CtaBar T12060) — the `actionBar` footer CollectionPlayer renders for
 * Overlay's post-export completion preview. The Overlay sibling of
 * FocusPublishActionBar: same CtaBar panel, same strictly-presentational contract
 * (all copy/routing lives in OverlayScreen).
 *
 * HIERARCHY tracks PIPELINE POSITION, so the dominant action differs from Focus's on
 * purpose: the spotlight is ALREADY applied and the reel is finished, so the promoted
 * forward action is Publish.
 *
 *   PRIMARY   Publish            — first CtaBar card (solid cyan); carries `loading`
 *                                  (disabled + spinning icon); caption states the audience.
 *   SECONDARY Redo spotlight     — back into Spotlight editing.
 *   SECONDARY Edit framing       — caption carries the paid re-export ("uses credits").
 *   EXIT      Done for now       — CtaBar's ghost exit card, last. No caption.
 *
 * The old inner-button `data-testid="overlay-publish-now"` stays retired: the primary
 * card is addressable as `overlay-choice-primary` or by its name "Finish".
 *
 * @param {Function} onPublishNow     - required. Primary. Publish the finished reel.
 * @param {boolean=} publishLoading   - disables + spins the Publish card only.
 * @param {Function} onReapplyOverlay - required. Redo spotlight.
 * @param {Function} onReapplyFocus   - required. Edit framing (paid re-export).
 * @param {Function} onSaveDraft      - required. Quiet "Done for now" exit.
 */
export function OverlayPublishActionBar({
  onPublishNow,
  publishLoading = false,
  onReapplyOverlay,
  onReapplyFocus,
  onSaveDraft,
}) {
  return (
    <div
      data-testid="overlay-publish-action-bar"
      className="border-t border-gray-800 bg-gray-900 px-4 py-4 sm:px-6 sm:py-6"
    >
      <div className="mx-auto mb-4 flex max-w-md items-center justify-center lg:max-w-4xl">
        <h2 className="text-lg font-semibold text-white sm:text-xl motion-safe:animate-[readyIn_320ms_ease-out_both]">
          {OVERLAY_PUBLISH.HEADLINE}
        </h2>
      </div>

      <div className="mx-auto w-full max-w-4xl">
        <CtaBar
          layout="panel"
          primary={{
            icon: publishLoading ? Loader : FolderInput,
            title: OVERLAY_PUBLISH.PUBLISH_LABEL,
            description: OVERLAY_PUBLISH.PUBLISH_CAPTION,
            onClick: onPublishNow,
            loading: publishLoading,
            testId: 'overlay-choice-primary',
          }}
          secondary={[
            {
              icon: Sparkles,
              title: OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL,
              description: OVERLAY_PUBLISH.REAPPLY_OVERLAY_CAPTION,
              onClick: onReapplyOverlay,
              testId: 'overlay-choice-reapply-overlay',
            },
            {
              icon: Crop,
              title: OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL,
              description: OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION,
              onClick: onReapplyFocus,
              testId: 'overlay-choice-reapply-focus',
            },
          ]}
          exit={{
            icon: ArrowLeft,
            title: OVERLAY_PUBLISH.SAVE_DRAFT_LABEL,
            onClick: onSaveDraft,
            testId: 'overlay-save-draft',
          }}
        />
      </div>

      <style>{`
        @keyframes readyIn {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default OverlayPublishActionBar;
