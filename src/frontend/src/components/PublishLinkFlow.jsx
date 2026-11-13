import { Loader, Link2, Share2 } from 'lucide-react';
import { Button } from './shared/Button';
import { LinkReadyCard } from './LinkReadyCard';
import { RESULT_PUBLISH } from '../config/displayNames';
import { GUIDE_PULSE } from './instructions/guideTargets';

/**
 * PublishLinkFlow (T10180 design §3.2) - presentational render of the publish
 * -> visibility-review -> link-ready state machine (design §2.2), rendered
 * into CollectionPlayer's `actionBar` slot by DraftReelPreview. Owns NO
 * state/fetching/store access -- every value and gesture is a prop from the
 * parent (data-always-ready: the parent owns the phase machine, this is a
 * pure one-branch-per-phase view).
 *
 * `failed` renders nothing here -- DraftReelPreview's own `statusBanner` slot
 * (the amber retry strip) carries that state; the link is never created on
 * failure, so there is no link-ready UI to show either.
 *
 * @param {'idle'|'review'|'publishing'|'ready'|'failed'} phase
 * @param {string}   reelName    - for REVIEW_TITLE(name)
 * @param {string|null} shareUrl - the minted share URL, once phase === 'ready'
 * @param {boolean}  isMobile    - coarse pointer -> native share entry instead
 *                                  of the selectable input
 * @param {boolean}  copied      - Copy button shows a check for 2s (caller-timed)
 * @param {Function} onPublishClick - idle -> review (no write)
 * @param {Function} onCancel       - review -> idle (no write)
 * @param {Function} onConfirm      - review -> publishing (the write gesture)
 * @param {Function} onCopy         - ready (fine pointer): copy the share URL
 * @param {Function} onNativeShare  - ready (coarse pointer): share the link
 *                                     (navigator.share with a url, no files)
 * @param {Function=} onShareVideo  - ready (coarse pointer), only when
 *                                     `canShareFile`: share the raw video
 *                                     file (navigator.share with files, no
 *                                     url) -- for posting to Reels/TikTok.
 * @param {boolean}  canShareFile   - FULL capability (file sharing works);
 *                                     LINK_ONLY devices collapse to a single
 *                                     full-width Share link button (D6).
 * @param {Function=} onGetLink     - ready (fine pointer) with shareUrl still
 *                                     null (R5 alreadyPublished capability):
 *                                     mints the link on the first click.
 *                                     Forwarded straight to LinkReadyCard.
 */
export function PublishLinkFlow({
  phase,
  reelName,
  shareUrl = null,
  isMobile = false,
  canShareFile = false,
  copied = false,
  onPublishClick,
  onCancel,
  onConfirm,
  onCopy,
  onNativeShare,
  onShareVideo,
  onGetLink,
}) {
  if (phase === 'idle') {
    return (
      <div className="flex items-center justify-center px-3 py-2">
        <Button variant="cyan" size="sm" className="coarse-pointer:min-h-11" onClick={onPublishClick} data-testid="finished-get-link" guideTarget={GUIDE_PULSE.GET_LINK}>
          {RESULT_PUBLISH.PUBLISH_GET_LINK}
        </Button>
      </div>
    );
  }

  if (phase === 'review') {
    return (
      <div className="flex flex-col gap-2 px-3 py-2 bg-gray-800/80">
        <p className="text-sm font-medium text-white">{RESULT_PUBLISH.REVIEW_TITLE(reelName)}</p>
        <p className="text-xs text-gray-300">{RESULT_PUBLISH.REVIEW_BODY}</p>
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" className="coarse-pointer:min-h-11" onClick={onCancel}>
            {RESULT_PUBLISH.REVIEW_CANCEL}
          </Button>
          <Button variant="cyan" size="sm" className="coarse-pointer:min-h-11" onClick={onConfirm}>
            {RESULT_PUBLISH.REVIEW_CONFIRM}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'publishing') {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-300">
        <Loader size={14} className="animate-spin" />
        <span>{RESULT_PUBLISH.PUBLISHING}</span>
      </div>
    );
  }

  if (phase === 'ready') {
    return (
      <div className="flex flex-col gap-2 px-3 py-2">
        <p className="text-sm font-medium text-white">
          {shareUrl ? RESULT_PUBLISH.LINK_READY : RESULT_PUBLISH.SHARE_HEADING}
        </p>
        {isMobile ? (
          <>
            {shareUrl && (
              <LinkReadyCard link={shareUrl} copied={copied} onCopy={onCopy} />
            )}
            {canShareFile ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="cyan" size="sm" icon={Link2} className="w-full coarse-pointer:min-h-11" onClick={onNativeShare}>
                  {RESULT_PUBLISH.SHARE_LINK}
                </Button>
                <Button variant="secondary" size="sm" icon={Share2} className="w-full coarse-pointer:min-h-11" onClick={onShareVideo}>
                  {RESULT_PUBLISH.SHARE_VIDEO}
                </Button>
              </div>
            ) : (
              <Button variant="cyan" size="sm" icon={Link2} fullWidth className="coarse-pointer:min-h-11" onClick={onNativeShare}>
                {RESULT_PUBLISH.SHARE_LINK}
              </Button>
            )}
            <p className="text-xs text-gray-400">{RESULT_PUBLISH.SHARE_CHOICE_HINT}</p>
          </>
        ) : (
          <LinkReadyCard link={shareUrl} onGetLink={onGetLink} triggerLabel={RESULT_PUBLISH.PUBLISH_GET_LINK} copied={copied} onCopy={onCopy} />
        )}
      </div>
    );
  }

  // 'failed' — no link-ready UI (the link is never created on failure); the
  // amber retry banner lives in DraftReelPreview's statusBanner slot instead.
  return null;
}

export default PublishLinkFlow;
