import { FolderInput, Sparkles, Pencil, ArrowLeft, Loader } from 'lucide-react';
import CtaBar from './shared/CtaBar';
import { FOCUS_PUBLISH } from '../config/displayNames';

/**
 * FocusPublishActionBar (T8390, re-hierarchized T9590, celebration tiles T10670,
 * on the shared CtaBar T12060) — the `actionBar` footer CollectionPlayer renders for
 * Focus's post-export completion preview. Strictly presentational: all copy/routing
 * lives in the caller (FocusScreen); this component only lays out the choices.
 *
 *   PRIMARY   Add spotlight        — first CtaBar card (solid cyan), opens the Spotlight
 *                                    editor and never starts an export on its own.
 *   SECONDARY Finish without spotlight — publishes the framed reel as-is; carries
 *                                    `loading` (disabled + spinning icon) and the
 *                                    guided-tutorial anchor (data-tutorial-target).
 *   SECONDARY Edit framing         — caption carries the paid-re-export ("uses credits").
 *   EXIT      Done for now         — CtaBar's ghost exit card, last. No caption (the
 *                                    landing toast names Clips/Reels).
 *
 * The panel is CtaBar layout="panel": CtaBar owns CTA order (primary first, exit last),
 * one disc size, and publishes --cta-bar-h so the stage above can cap itself. This file
 * keeps only the headline and the panel frame. The Tile copy that duplicated the Overlay
 * bar is gone; both bars now share one layout.
 *
 * @param {Function} onAddSpotlight  - required. Primary. Opens the Spotlight editor.
 * @param {Function} onPublish       - required. Finish without spotlight.
 * @param {boolean=} publishLoading  - disables + spins the Publish card only.
 * @param {Function} onRefocus       - required. Edit framing.
 * @param {Function} onSaveDraft     - required. Quiet "Done for now" exit.
 */
export function FocusPublishActionBar({
  onAddSpotlight,
  onPublish,
  publishLoading = false,
  onRefocus,
  onSaveDraft,
}) {
  return (
    <div
      data-testid="focus-publish-action-bar"
      className="border-t border-gray-800 bg-gray-900 px-4 py-4 sm:px-6 sm:py-6"
    >
      <div className="mx-auto mb-4 flex max-w-md items-center justify-center lg:max-w-4xl">
        <h2 className="text-lg font-semibold text-white sm:text-xl motion-safe:animate-[readyIn_320ms_ease-out_both]">
          {FOCUS_PUBLISH.HEADLINE}
        </h2>
      </div>

      <div className="mx-auto w-full max-w-4xl">
        <CtaBar
          layout="panel"
          primary={{
            icon: Sparkles,
            title: FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL,
            description: FOCUS_PUBLISH.SPOTLIGHT_CAPTION,
            onClick: onAddSpotlight,
            testId: 'focus-choice-primary',
          }}
          secondary={[
            {
              icon: publishLoading ? Loader : FolderInput,
              title: FOCUS_PUBLISH.PUBLISH_LABEL,
              description: FOCUS_PUBLISH.PUBLISH_CAPTION,
              onClick: onPublish,
              loading: publishLoading,
              testId: 'focus-choice-publish',
              tutorialTarget: 'focus-publish',
            },
            {
              icon: Pencil,
              title: FOCUS_PUBLISH.EDIT_FRAMING_LABEL,
              description: FOCUS_PUBLISH.EDIT_FRAMING_CAPTION,
              onClick: onRefocus,
              testId: 'focus-choice-edit-framing',
            },
          ]}
          exit={{
            icon: ArrowLeft,
            title: FOCUS_PUBLISH.SAVE_DRAFT_LABEL,
            onClick: onSaveDraft,
            testId: 'focus-save-draft',
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

export default FocusPublishActionBar;
