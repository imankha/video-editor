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
// actual PATCH/write gesture -- exactly once, on OK. Cancel/X close with no
// write. Enter = OK, Escape = cancel (never commits). T6940: the backdrop
// deliberately does NOT close (project rule: modals never close on backdrop
// click — a mid-flow click outside was silently abandoning selections), and
// leaving with a just-created card still unattached asks first instead of
// silently keeping the old attachment (the "I added a card but the old one
// plays" dead end).
//
// T6670 — inline "create a new card" without leaving the picker. The carousel
// surfaces a "New card" tile (`onCreateNew`); clicking it swaps this modal into
// an inner CREATE view that mounts the SAME editor the library uses
// (IntroCardEditorContainer) on a freshly created row -- the picker stays
// mounted throughout (never cycles `isOpen`), so the reel/collection identity
// and the in-progress selection are never lost. On finishing the edit, we land
// back on the carousel with the new card PRE-SELECTED as the draft; the user's
// OK then fires the caller's existing single attach write -- no second write
// path is introduced. A profile with no consent yet hits the SAME inline
// ConsentGate first (create is 403-gated backend-side too), so this new entry
// point cannot bypass T5230's consent requirement.

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Z } from '../../constants/zLayers';
import { useIntroCardStore, useProfileStore } from '../../stores';
import { IntroCardCarousel } from './IntroCardCarousel';
import { IntroCardEditorContainer } from './IntroCardEditorContainer';
import { ConsentGate } from './ConsentGate';
import { ConfirmationDialog } from '../shared/ConfirmationDialog';
import { buildCreateFields, nextCardName } from './introCardDefaults';
import { toast } from '../shared/Toast';

export function IntroCardPicker({
  isOpen,
  onClose,
  title = 'Athlete Intro Card',
  cards,
  profile,
  selectedId,
  hasConsent,
  onSelect,
  onRequestConsent,
  onEditProfile,
}) {
  const createCard = useIntroCardStore((s) => s.createCard);
  const setIntroConsent = useProfileStore((s) => s.setIntroConsent);
  // The editor reads the LIVE card row from the store (it applies optimistic
  // patches there); look the edited card up from the store, not the `cards`
  // prop, so a freshly-created row is found on the same tick createCard set it
  // and every subsequent surgical edit re-renders the editor.
  const storeCards = useIntroCardStore((s) => s.cards);

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
  // T6670: 'select' shows the carousel; 'create' shows the inline editor (or
  // the consent gate en route to it). Reset to 'select' on every (re)open.
  const [view, setView] = useState('select');
  const [editId, setEditId] = useState(null);
  const [consentError, setConsentError] = useState(null);
  // T6940: the card created via the inline flow THIS open-session. If the user
  // exits while it would be left unattached, we ask instead of silently
  // dropping it (creating is not attaching — the old card would keep playing).
  const [createdId, setCreatedId] = useState(null);
  const [confirmExit, setConfirmExit] = useState(false);
  // Synchronous guard against a double-create from two fast clicks: the
  // `creating` state flips asynchronously, so a ref is what actually blocks the
  // second entry within the same tick.
  const creatingRef = useRef(false);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setDraftId(selectedId);
      setLastSeenSelectedId(selectedId);
      setTouched(false);
      setView('select');
      setEditId(null);
      setConsentError(null);
      setCreatedId(null);
      setConfirmExit(false);
    }
  } else if (isOpen && !touched && view === 'select' && selectedId !== lastSeenSelectedId) {
    setDraftId(selectedId);
    setLastSeenSelectedId(selectedId);
  }

  if (!isOpen) return null;

  const commit = () => {
    onSelect(draftId);
    onClose();
  };
  // T6940: exiting while the just-created card would be left unattached asks
  // first. Two shapes qualify: still in the create view (X during editing), or
  // back on the carousel with the new card as the pending draft. If the user
  // created a card and then deliberately picked a DIFFERENT one before
  // cancelling, that later choice stands — plain close, no prompt.
  const cancel = () => {
    const abandoningNewCard =
      createdId != null && (view === 'create' || draftId === createdId);
    if (abandoningNewCard) {
      setConfirmExit(true);
      return;
    }
    onClose();
  };
  const selectDraft = (cardId) => {
    setTouched(true);
    setDraftId(cardId);
  };

  // T6670: create a fresh card and drop straight into the editor on it. The new
  // row lands in the store (createCard prepends it), so it also appears in the
  // carousel the moment we return. Throws (e.g. the T5230 consent 403) surface
  // as a toast, same as the library's own New-card gesture.
  const doCreate = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const created = await createCard(buildCreateFields({ name: nextCardName(cards || []), profile }));
      setEditId(created.id);
      setCreatedId(created.id);
      setView('create');
    } catch (err) {
      toast.error('Could not create card', { message: err.message });
      setView('select');
    } finally {
      creatingRef.current = false;
    }
  };

  // Gesture: the carousel's "New card" tile. Consent-gated exactly like the
  // library editor -- if this profile has no attestation yet, show the SAME
  // inline ConsentGate BEFORE creating (create is 403-gated server-side too),
  // so this entry point cannot bypass T5230.
  const startCreate = () => {
    if (!hasConsent) {
      setView('create');
      setEditId(null);
      return;
    }
    doCreate();
  };

  // From the inline consent gate: record consent, then proceed to create. After
  // setIntroConsent the profile prop flips `hasConsent` true, so the editor that
  // mounts next renders normally instead of re-gating.
  const grantConsentAndCreate = async () => {
    setConsentError(null);
    try {
      await setIntroConsent(profile.id);
    } catch (err) {
      // Surface a failed consent record inline on the gate (mirrors the library
      // editor's own ConsentGate handling) instead of swallowing the rejection.
      setConsentError(err.message || 'Could not record consent. Please try again.');
      return;
    }
    await doCreate();
  };

  // Finished editing the new card -> back to the carousel with it PRE-SELECTED
  // as the draft (the user built it specifically to use here). `touched` guards
  // it against an incoming selectedId prop clobbering the pick. The actual
  // attach is still the caller's single onSelect, fired on OK -- no second write.
  const finishCreate = () => {
    if (editId != null) {
      setTouched(true);
      setDraftId(editId);
    }
    setEditId(null);
    setView('select');
  };

  const handleKeyDown = (e) => {
    // The editor/consent views own their own inputs and back buttons; the
    // OK/cancel keyboard shortcuts only apply to the selection view. While the
    // exit-confirm dialog is up it owns the keyboard (its own Escape handler);
    // Enter must not bubble here and commit behind it.
    if (confirmExit) return;
    if (view !== 'select') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  const editingCard = editId != null ? storeCards.find((c) => c.id === editId) || null : null;
  const inCreateView = view === 'create';

  // The editor's rail shows an "Add it" link for a ticked fact the profile is
  // missing. Hosts that can open the profile editor pass `onEditProfile`; from
  // the gallery picker there is no such route, so fall back to a hint pointing
  // the user at where facts are edited -- never a dead click (T6530: an action
  // or a reason, never a dead end).
  const editProfileHint =
    onEditProfile ||
    (() => toast.info('Open your profile menu -> Manage Profile to add a position, class, or team.'));

  return createPortal(
    <div
      className={`fixed inset-0 ${Z.MODAL} flex items-center justify-center bg-black/60 backdrop-blur-sm px-4`}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      ref={(node) => node?.focus()}
    >
      <div
        className={`bg-gray-800 rounded-lg shadow-xl w-full border border-gray-700 ${
          inCreateView ? 'max-w-4xl h-[85vh] flex flex-col' : 'max-w-lg'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
          <h3 className="text-base font-semibold text-white">
            {inCreateView ? 'New Athlete Intro Card' : title}
          </h3>
          <button
            onClick={cancel}
            className="text-gray-400 hover:text-white transition-colors p-1 -mr-1 coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {inCreateView ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            {editingCard ? (
              <IntroCardEditorContainer
                card={editingCard}
                profile={profile}
                onBack={finishCreate}
                onEditProfile={editProfileHint}
              />
            ) : !hasConsent ? (
              <ConsentGate onBack={finishCreate} onConsent={grantConsentAndCreate} error={consentError} />
            ) : (
              // Brief interval while createCard resolves (consent just granted).
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                Creating card&hellip;
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="px-5 py-4">
              <IntroCardCarousel
                cards={cards}
                profile={profile}
                selectedId={draftId}
                hasConsent={hasConsent}
                onSelect={selectDraft}
                onRequestConsent={onRequestConsent}
                onCreateNew={startCreate}
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
          </>
        )}
      </div>
      <ConfirmationDialog
        isOpen={confirmExit}
        title="Attach your new card?"
        message={'Your new card was saved to your library, but it is not attached here yet — the previous intro choice would keep playing.'}
        onClose={() => setConfirmExit(false)}
        buttons={[
          {
            label: "Don't attach",
            variant: 'secondary',
            onClick: () => {
              setConfirmExit(false);
              onClose();
            },
          },
          {
            label: 'Attach card',
            variant: 'primary',
            onClick: () => {
              setConfirmExit(false);
              onSelect(createdId);
              onClose();
            },
          },
        ]}
      />
    </div>,
    document.body
  );
}

export default IntroCardPicker;
