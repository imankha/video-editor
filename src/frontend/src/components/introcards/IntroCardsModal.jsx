// T5205 — the intro-card library + editor SCREEN (MVC top layer). Owns data
// fetching (the Zustand card store), the data guard, and the grid<->editor
// navigation. It holds NO card fields itself — the store is the single source of
// truth for the card list; the editor reads the live row from it by id.
//
// Rendered as a full-surface modal reached from ManageProfilesModal / the
// profile menu (intro cards are per-profile, not per-project, so this is not an
// editor MODE).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { useIntroCardStore, useCurrentProfile } from '../../stores';
import { Z } from '../../constants/zLayers';
import { IntroCardGrid } from './IntroCardGrid';
import { IntroCardEditorContainer } from './IntroCardEditorContainer';
import { buildCreateFields } from './introCardDefaults';

export function IntroCardsModal({ isOpen, onClose, onEditProfile }) {
  const profile = useCurrentProfile();
  const cards = useIntroCardStore((s) => s.cards);
  const isLoading = useIntroCardStore((s) => s.isLoading);
  const isInitialized = useIntroCardStore((s) => s.isInitialized);
  const error = useIntroCardStore((s) => s.error);
  const fetchCards = useIntroCardStore((s) => s.fetchCards);
  const createCard = useIntroCardStore((s) => s.createCard);
  const setDefault = useIntroCardStore((s) => s.setDefault);
  const deleteCard = useIntroCardStore((s) => s.deleteCard);

  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) fetchCards();
  }, [isOpen, fetchCards]);

  // Escape closes the grid (the editor's own back button handles the editor).
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !editingId) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, editingId, onClose]);

  if (!isOpen) return null;

  const editingCard = editingId ? cards.find((c) => c.id === editingId) || null : null;

  const handleNew = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const name = `New card ${cards.length + 1}`;
      const created = await createCard(buildCreateFields({ name, profile }));
      if (created) setEditingId(created.id);
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async (card) => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await createCard({
        name: `${card.name} copy`,
        treatment: card.treatment,
        shown_fields: card.shown_fields || [],
        title_text: card.title_text,
        subtitle_text: card.subtitle_text, // free text travels with the copy (T6570)
        image_key: card.image_key,
        image_cutout_key: card.image_cutout_key,
        focal_x: card.focal_x,
        focal_y: card.focal_y,
        zoom: card.zoom,
        text_elements: card.text_elements || {},
        duration: card.duration,
      });
      if (created) setEditingId(created.id);
    } finally {
      setBusy(false);
    }
  };

  // T6600 z-order fix. This modal is opened as a CHILD of ManageProfilesModal,
  // which lives inside the app's `fixed top-4 right-4 z-30` header — so rendered
  // inline it is TRAPPED in that stacking context and its root-level ceiling is
  // the header's z, NOT the value it sets. DraftTile portals its hover overlays to
  // document.body at Z.OVERLAY_BACKDROP/Z.PLAYER (its hover:scale transform breaks
  // fixed descendants), so those tile overlays paint OVER a trapped modal with
  // undimmed buttons, ABOVE the scrim — which no backdrop opacity can cover (the
  // bug mis-fixed twice in T6540/T6580 by deepening the scrim).
  //
  // Fix: portal to document.body (escape the trap) and sit at Z.MODAL_ELEVATED,
  // the nested-modal rung ABOVE the tile portal layer. The delete-card
  // ConfirmationDialog is a DESCENDANT of this subtree, so it keeps its own MODAL
  // rung and still renders above the grid (see constants/zLayers § nested modals).
  // The scrim/blur/max-w-6xl panel treatment from T6580 is unchanged.
  return createPortal(
    <div data-testid="intro-cards-modal" className={`fixed inset-0 ${Z.MODAL_ELEVATED} flex items-center justify-center bg-black/90 backdrop-blur-md p-4`}>
      <div className="bg-gray-900 rounded-lg shadow-xl border border-gray-700 w-full max-w-6xl h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-white">Intro cards</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-white p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {!isInitialized && isLoading ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : error && cards.length === 0 ? (
            <div className="text-center text-red-400 text-sm py-10">
              Could not load your cards. {error}
            </div>
          ) : editingCard ? (
            <IntroCardEditorContainer
              card={editingCard}
              profile={profile}
              onBack={() => setEditingId(null)}
              onEditProfile={onEditProfile}
            />
          ) : editingId && !editingCard ? (
            // The edited card vanished (deleted elsewhere) — fall back to the grid.
            <FallbackToGrid onDone={() => setEditingId(null)} />
          ) : (
            <IntroCardGrid
              cards={cards}
              profile={profile}
              onNew={handleNew}
              onEdit={(card) => setEditingId(card.id)}
              onDuplicate={handleDuplicate}
              onSetDefault={(card) => setDefault(card.id)}
              onDelete={(card) => deleteCard(card.id)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function FallbackToGrid({ onDone }) {
  useEffect(() => { onDone(); }, [onDone]);
  return null;
}

export default IntroCardsModal;
