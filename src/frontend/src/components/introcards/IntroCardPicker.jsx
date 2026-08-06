// T5215 — modal chrome around the shared IntroCardCarousel, for hosts that
// are NOT already a dialog (the reel kebab menu). Portaled to document.body
// (mirrors ReelTile's own kebab-menu portal) so it escapes any transformed/
// clipped ancestor (ReelTile's root has `hover:scale-[1.03]`, which would
// otherwise trap a `fixed`-positioned child instead of covering the viewport).
// The collection share dialog is already a modal, so it embeds
// IntroCardCarousel directly instead of wrapping it in this chrome.

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Z } from '../../constants/zLayers';
import { IntroCardCarousel } from './IntroCardCarousel';

export function IntroCardPicker({
  isOpen,
  onClose,
  title = 'Intro card',
  cards,
  profile,
  selectedId,
  hasConsent,
  onSelect,
  onRequestConsent,
}) {
  if (!isOpen) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${Z.MODAL} flex items-center justify-center bg-black/60 backdrop-blur-sm px-4`}
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl max-w-lg w-full border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 -mr-1 coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">
          <IntroCardCarousel
            cards={cards}
            profile={profile}
            selectedId={selectedId}
            hasConsent={hasConsent}
            onSelect={(cardId) => {
              onSelect(cardId);
              onClose();
            }}
            onRequestConsent={onRequestConsent}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

export default IntroCardPicker;
