import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { TextSpecEditor } from '../textspec/TextSpecEditor';
import PositionPresetGrid from './PositionPresetGrid';
import { formatTimeSimple } from '../shared/clipConstants';

/**
 * TextManagementPanel (T6630 round 3) -- the Text tab's body. The SINGLE surface
 * for add/remove/settings, per the user's direction ("let users add and remove
 * text elements in the Text tab, as well as specify settings for the selected
 * text there"). The timeline lane (TextLayer.jsx) is TIMING ONLY now -- no
 * in-lane add button, no whole-lane click-to-add (both removed; that stray-click
 * behaviour was part of the original "discombobulating" complaint).
 *
 * Selecting a row here sets the SAME `selectedTextId` the timeline/stage read --
 * one selection state, no second source of truth. Add reuses the existing
 * `onAddText` surgical-write path (creates at the current playhead); delete
 * reuses the existing `onDeleteText` path; both are UNCHANGED, just relocated.
 */
export default function TextManagementPanel({
  blocks = [],
  selectedTextId = null,
  currentTime = 0,
  onAddText,
  onSelectText,
  onDeleteText,
  onToggleText,
  onUpdateTextSpec,
}) {
  const selected = selectedTextId ? blocks.find((b) => b.id === selectedTextId) || null : null;

  return (
    <div className="flex flex-col gap-3">
      {/* The ONE add path (T6630 round 3). Adds at the current playhead and
          selects the new block -- same wrappedAddText path as before. */}
      <button
        type="button"
        data-testid="text-tab-add"
        onClick={() => onAddText && onAddText(currentTime)}
        className="w-full flex items-center justify-center gap-1.5 rounded px-3 py-2 text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white transition-colors coarse-pointer:min-h-11"
      >
        <Plus size={14} />
        Add text
      </button>

      {blocks.length === 0 ? (
        <p className="text-xs text-gray-500">No text elements yet — add one above.</p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="text-tab-list">
          {blocks.map((block) => {
            const isSelected = block.id === selectedTextId;
            return (
              <li key={block.id}>
                <div
                  data-testid={`text-tab-row-${block.index}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectText && onSelectText(block.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectText && onSelectText(block.id); }
                  }}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-cyan-900/40 ring-1 ring-cyan-400' : 'bg-gray-800/60 hover:bg-gray-800'
                  }`}
                >
                  <span className="flex-1 min-w-0 truncate text-sm text-gray-100">
                    {block.spec?.text || 'Text block'}
                  </span>
                  <span className="text-[11px] text-gray-500 shrink-0">{formatTimeSimple(block.startTime)}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleText && onToggleText(block.id, block.enabled === false); }}
                    className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 coarse-pointer:min-w-11 coarse-pointer:min-h-11"
                    title={block.enabled === false ? 'Show text' : 'Hide text (keep block)'}
                  >
                    {block.enabled === false ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteText && onDeleteText(block.id); }}
                    className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-red-950/50 coarse-pointer:min-w-11 coarse-pointer:min-h-11"
                    title="Delete text block"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="border-t border-gray-700 pt-3 flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-gray-400">Settings</div>
          {/* T6630 round 3: 9-slot position grid replaces free-dragging the text on
              the stage. Same onUpdateTextSpec write path as every other setting
              here -- one surgical write, no second persistence path. The existing
              per-element Align control stays in TextSpecEditor below (unchanged;
              a preset click also sets a coherent align, but the dropdown remains
              independently editable). */}
          <PositionPresetGrid
            spec={selected.spec}
            onChange={(nextSpec) => onUpdateTextSpec && onUpdateTextSpec(selected.id, nextSpec)}
          />
          <TextSpecEditor
            spec={selected.spec}
            onChange={(nextSpec) => onUpdateTextSpec && onUpdateTextSpec(selected.id, nextSpec)}
          />
        </div>
      )}
    </div>
  );
}
