// T5205 — the library grid view. Presentational: renders the profile's cards as
// tiles plus a "New card" affordance, and owns only the ephemeral delete-confirm
// dialog state. All persistence is delegated to the handlers the Screen passes.

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { IntroCardTile } from './IntroCardTile';
import { ConfirmationDialog } from '../shared/ConfirmationDialog';

const TILE_W = 150;
const TILE_H = Math.round((TILE_W * 16) / 9);

export function IntroCardGrid({ cards, profile, onNew, onEdit, onDuplicate, onDelete }) {
  const [pendingDelete, setPendingDelete] = useState(null);

  const confirmDelete = async () => {
    const card = pendingDelete;
    setPendingDelete(null);
    if (card) await onDelete(card);
  };

  return (
    <div>
      {cards.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          <p className="mb-4 text-sm">No Athlete Intro Cards yet. Create one to open a reel with your player.</p>
          <NewCardButton onClick={onNew} />
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          {cards.map((card) => (
            <IntroCardTile
              key={card.id}
              card={card}
              profile={profile}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onDelete={setPendingDelete}
            />
          ))}
          <NewCardButton onClick={onNew} />
        </div>
      )}

      <ConfirmationDialog
        isOpen={!!pendingDelete}
        title={`Delete "${pendingDelete?.name || ''}"?`}
        message="Any reel set to use this card will fall back to no intro. This cannot be undone."
        onClose={() => setPendingDelete(null)}
        buttons={[
          { label: 'Cancel', onClick: () => setPendingDelete(null), variant: 'secondary' },
          { label: 'Delete card', onClick: confirmDelete, variant: 'danger' },
        ]}
      />
    </div>
  );
}

function NewCardButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-600 text-gray-400 hover:border-blue-500 hover:text-white transition-colors"
      style={{ width: `${TILE_W}px`, height: `${TILE_H}px` }}
    >
      <Plus size={28} />
      <span className="text-sm font-medium">New card</span>
    </button>
  );
}

export default IntroCardGrid;
