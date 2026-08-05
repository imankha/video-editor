// T5205 — the intro-card library + editor SCREEN (MVC top layer). Owns data
// fetching (the Zustand card store), the data guard, and the grid<->editor
// navigation. It holds NO card fields itself — the store is the single source of
// truth for the card list; the editor reads the live row from it by id.
//
// Rendered as a full-surface modal reached from ManageProfilesModal / the
// profile menu (intro cards are per-profile, not per-project, so this is not an
// editor MODE).

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useIntroCardStore, useCurrentProfile } from '../../stores';
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 rounded-lg shadow-xl border border-gray-700 w-full max-w-5xl h-[85vh] flex flex-col">
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
    </div>
  );
}

function FallbackToGrid({ onDone }) {
  useEffect(() => { onDone(); }, [onDone]);
  return null;
}

export default IntroCardsModal;
