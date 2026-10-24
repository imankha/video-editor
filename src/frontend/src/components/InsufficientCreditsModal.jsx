import { useEffect, useRef } from 'react';
import { X, Coins } from 'lucide-react';
import { Button } from './shared/Button';
import { CREDITS } from '../config/displayNames';
import { formatLength, PRECISION } from '../utils/timeFormat';
import Guide from './instructions/Guide';
import { resolveGuide } from './instructions/resolveGuide';
import { GuideScope } from './instructions/GuideScope';
import { GUIDE_PULSE } from './instructions/guideTargets';
import { recordFunnelEvent, FUNNEL_EVENTS } from '../utils/funnelEvents';

/**
 * InsufficientCreditsModal - Blocking modal shown when user lacks credits (T530)
 *
 * Props:
 *   required: number - credits needed for the export
 *   available: number - user's current balance
 *   videoSeconds: number - video duration in seconds
 *   onClose: () => void - close handler
 *   onBuyCredits: () => void - open BuyCreditsModal (T525)
 *
 * T9480 review fix (MINOR #9): the real caller (ProjectsScreen, game-upload
 * storage credits) always passes `description` -- the `videoSeconds` fallback
 * below is not exercised in production today, but is single-sourced via
 * CREDITS/formatLength (not a bare Math.round with no stated rule) so it
 * can't drift if a future export-credits caller relies on it. The old
 * unconditional "1 credit = 1 second of exported video" footer was REMOVED:
 * it stated the per-second export rule even when this modal is showing a
 * storage-credit (not export) shortfall, and was already stale versus
 * T9750's round-half-up rule (BuyCreditsModal fixed its own copy of this
 * exact line; this sibling was missed).
 */
export function InsufficientCreditsModal({ required, available, videoSeconds, description, onClose, onBuyCredits }) {
  const detail = description
    || `This generation requires ${required} credits for ${formatLength(videoSeconds, PRECISION.TENTH)} of video (${CREDITS.PER_SECOND_RULE}).`;

  const guide = resolveGuide({ screen: 'modal', local: { modal: 'insufficient-credits' } });

  // T13330: the user hit the paywall. Analytics beacon on the modal open (the
  // gesture is the action that opened it), once per open: the ref survives
  // StrictMode's dev double-effect. Not editor persistence; no store/DB write.
  const beaconed = useRef(false);
  useEffect(() => {
    if (beaconed.current) return;
    beaconed.current = true;
    recordFunnelEvent(FUNNEL_EVENTS.PAYWALL_SHOWN);
  }, []);

  return (
    <GuideScope guides={[guide]}>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Coins size={20} className="text-yellow-400" />
            Insufficient Credits
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <Guide guide={guide} inline testId="modal-guide" />

        <div className="space-y-3 text-gray-300 text-sm">
          <p>{detail}</p>
          <p>
            Your balance:{' '}
            <strong className="text-white">{available} credits</strong>.
          </p>
        </div>

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              console.log('[InsufficientCreditsModal] Buy Credits clicked');
              onClose();
              onBuyCredits?.();
            }}
            className="flex-1"
            icon={Coins}
            data-testid={GUIDE_PULSE.INSUFFICIENT_BUY}
            guideTarget={GUIDE_PULSE.INSUFFICIENT_BUY}
          >
            Buy Credits
          </Button>
        </div>
      </div>
    </div>
    </GuideScope>
  );
}
