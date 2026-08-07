// T5215 — modal chrome around the shared IntroCardCarousel, for hosts that
// are NOT already a dialog (the reel kebab menu). Portaled to document.body
// (mirrors ReelTile's own kebab-menu portal) so it escapes any transformed/
// clipped ancestor (ReelTile's root has `hover:scale-[1.03]`, which would
// otherwise trap a `fixed`-positioned child instead of covering the viewport).
// The collection share dialog is already a modal, so it embeds
// IntroCardCarousel directly instead of wrapping it in this chrome.
//
// ROUND 3 (user, 2026-08-07): "SELECT -> PREVIEW -> CONFIRM ... an explicit
// OK button commits the selection: the ONE surgical write now traces to the
// OK click, not the card click." The carousel below only ever reports a
// DRAFT (it plays the motion preview on every click); this component buffers
// that draft in `draftId` and calls the caller's real `onSelect` -- the
// actual PATCH/write gesture -- exactly once, on OK. Cancel/X/backdrop close
// with no write. Enter = OK, Escape = cancel (never commits).

import { useState } from 'react';
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
  // This component stays mounted across open/close (hosts pass `isOpen`
  // rather than conditionally rendering it), so hooks must run every render
  // -- the visibility check happens after them, not before. Reset the draft
  // to the caller's current value the moment the picker (re)opens, using the
  // "adjust state during render" pattern instead of a useEffect (this is
  // local UI state, not persistence).
  //
  // The collection host opens the picker BEFORE its own async resolve GET
  // completes (it opens with selectedId=null, then the GET lands a moment
  // later) -- so `selectedId` can still change WHILE already open. Adopt a
  // later `selectedId` too, but only until the user actually touches a tile
  // (`touched`); once they've made their own pick, an incoming prop update
  // must never clobber it.
  const [draftId, setDraftId] = useState(selectedId);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const [lastSeenSelectedId, setLastSeenSelectedId] = useState(selectedId);
  const [touched, setTouched] = useState(false);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setDraftId(selectedId);
      setLastSeenSelectedId(selectedId);
      setTouched(false);
    }
  } else if (isOpen && !touched && selectedId !== lastSeenSelectedId) {
    setDraftId(selectedId);
    setLastSeenSelectedId(selectedId);
  }

  if (!isOpen) return null;

  const commit = () => {
    onSelect(draftId);
    onClose();
  };
  const cancel = () => onClose();
  const selectDraft = (cardId) => {
    setTouched(true);
    setDraftId(cardId);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 ${Z.MODAL} flex items-center justify-center bg-black/60 backdrop-blur-sm px-4`}
      onClick={cancel}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(node) => node?.focus()}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl max-w-lg w-full border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button
            onClick={cancel}
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
            selectedId={draftId}
            hasConsent={hasConsent}
            onSelect={selectDraft}
            onRequestConsent={onRequestConsent}
          />
        </div>
        <div className="px-5 py-3.5 border-t border-gray-700 flex items-center justify-end gap-2">
          <button
            onClick={cancel}
            className="px-3.5 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors coarse-pointer:min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="px-4 py-2 rounded-md bg-purple-600 hover:bg-purple-500 text-sm font-medium text-white transition-colors coarse-pointer:min-h-[44px]"
          >
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default IntroCardPicker;
