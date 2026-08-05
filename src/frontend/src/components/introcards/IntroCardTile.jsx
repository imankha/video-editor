// T5205 — one library tile. Presentational: the browser preview at the card's
// aspect (portrait 9:16, the product's primary output) plus the always-visible
// action set (edit / duplicate / set-default / delete). No hover-only
// affordances (UI style guide: discoverable, never hover-only).

import { Star, Copy, Trash2, Pencil } from 'lucide-react';
import { IntroCardPreview } from './IntroCardPreview';

const TILE_W = 150;
const TILE_H = Math.round((TILE_W * 16) / 9); // 9:16 portrait

export function IntroCardTile({ card, profile, onEdit, onDuplicate, onSetDefault, onDelete }) {
  const isDefault = !!card.is_default;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => onEdit(card)}
        aria-label={`Edit ${card.name}`}
        className="group relative rounded-lg overflow-hidden border border-gray-700 hover:border-blue-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        style={{ width: `${TILE_W}px`, height: `${TILE_H}px` }}
      >
        <IntroCardPreview card={card} profile={profile} boxWidth={TILE_W} boxHeight={TILE_H} />

        {/* Default marker */}
        {isDefault && (
          <span
            className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[11px] font-semibold text-yellow-300"
            title="Default card"
            aria-label="Default card"
          >
            <Star size={10} fill="currentColor" /> Default
          </span>
        )}

        {/* Name scrim */}
        <div className="absolute inset-x-0 bottom-0 px-2 pt-6 pb-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent text-left">
          <h3 className="text-white text-xs font-medium line-clamp-2">{card.name}</h3>
        </div>
      </button>

      {/* Actions — always visible, coarse-pointer friendly */}
      <div className="flex items-center gap-1" style={{ width: `${TILE_W}px` }}>
        <TileAction label={`Edit ${card.name}`} onClick={() => onEdit(card)} title="Edit">
          <Pencil size={14} />
        </TileAction>
        <TileAction label={`Duplicate ${card.name}`} onClick={() => onDuplicate(card)} title="Duplicate">
          <Copy size={14} />
        </TileAction>
        <TileAction
          label={`Set ${card.name} as default`}
          onClick={() => onSetDefault(card)}
          title={isDefault ? 'Already the default' : 'Set as default'}
          disabled={isDefault}
        >
          <Star size={14} fill={isDefault ? 'currentColor' : 'none'} className={isDefault ? 'text-yellow-400' : ''} />
        </TileAction>
        <TileAction label={`Delete ${card.name}`} onClick={() => onDelete(card)} title="Delete" danger>
          <Trash2 size={14} />
        </TileAction>
      </div>
    </div>
  );
}

function TileAction({ children, label, onClick, title, disabled = false, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={`flex-1 flex items-center justify-center py-1.5 rounded coarse-pointer:min-h-[44px] transition-colors ${
        disabled
          ? 'text-gray-600 cursor-default'
          : danger
            ? 'text-gray-300 hover:text-red-400 hover:bg-gray-700'
            : 'text-gray-300 hover:text-white hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

export default IntroCardTile;
