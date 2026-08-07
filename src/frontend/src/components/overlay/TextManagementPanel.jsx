import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { TextSpecEditor } from '../textspec/TextSpecEditor';
import PositionPresetGrid from './PositionPresetGrid';
import { formatTimeSimple } from '../shared/clipConstants';

/**
 * TextManagementPanel (T6630 round 3/4) -- the Text tab's body. The SINGLE
 * surface for add/remove/settings, per the user's direction ("let users add
 * and remove text elements in the Text tab, as well as specify settings for
 * the selected text there"). The timeline lane (TextLayer.jsx) is TIMING
 * ONLY -- no in-lane add, no whole-lane click-to-add.
 *
 * MODEL (round 4): a REGION is a time span; it CONTAINS N elements, all
 * rendering simultaneously during it ("a text region can have multiple text
 * elements"). The left list shows regions, each with its own nested elements
 * and a per-region "+ Add text" (adds an ELEMENT into that region, timing
 * unchanged); "+ Add region" (top) creates a brand new time span.
 *
 * LAYOUT (round 4 item 3): TWO COLUMNS -- the region/element list on the
 * left scrolls independently; the settings column on the right is a FIXED
 * box whose bounding position never changes when the left list grows (no
 * more "adding a text element moves the settings"). Columns stack at <lg
 * (matches every other lg:/hidden-lg breakpoint in this screen); desktop
 * (lg+, where this two-column layout actually renders) never needs a
 * vertical scrollbar at typical content sizes because each column scrolls
 * on its own.
 *
 * Selecting a region/element sets the SAME selectedRegionId/selectedElementId
 * the timeline/stage read -- one selection state, no second source of truth.
 */
export default function TextManagementPanel({
  regions = [],
  selectedRegionId = null,
  selectedElementId = null,
  currentTime = 0,
  onAddRegion,
  onAddElement,
  onSelectRegion,
  onSelectElement,
  onDeleteText,
  onDeleteTextRegion,
  onToggleText,
  onUpdateTextSpec,
}) {
  const selectedRegion = selectedRegionId ? regions.find((r) => r.id === selectedRegionId) || null : null;
  const selectedElement = selectedRegion && selectedElementId
    ? (selectedRegion.elements || []).find((el) => el.id === selectedElementId) || null
    : null;

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:h-full">
      {/* LEFT: region list, each showing its elements. Independent scroll. */}
      <div className="lg:w-2/5 flex flex-col gap-3 lg:overflow-y-auto lg:pr-1" data-testid="text-region-list">
        {/* The ONE "new time span" gesture. Element-append lives per-region below. */}
        <button
          type="button"
          data-testid="text-tab-add-region"
          onClick={() => onAddRegion && onAddRegion(currentTime)}
          className="w-full flex items-center justify-center gap-1.5 rounded px-3 py-2 text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white transition-colors coarse-pointer:min-h-11"
        >
          <Plus size={14} />
          Add region
        </button>

        {regions.length === 0 ? (
          <p className="text-xs text-gray-500">No text yet — add a region above.</p>
        ) : (
          regions.map((region) => {
            const isRegionSelected = region.id === selectedRegionId;
            const elements = region.elements || [];
            return (
              <div
                key={region.id}
                data-testid={`text-tab-region-${region.index}`}
                className={`rounded border transition-colors ${
                  isRegionSelected ? 'border-cyan-400 bg-cyan-900/10' : 'border-gray-700 bg-gray-800/40'
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectRegion && onSelectRegion(region.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectRegion && onSelectRegion(region.id); }
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                >
                  <span className="flex-1 min-w-0 text-xs text-gray-400">
                    {formatTimeSimple(region.startTime)}–{formatTimeSimple(region.endTime)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteTextRegion && onDeleteTextRegion(region.id); }}
                    className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-red-950/50 coarse-pointer:min-w-11 coarse-pointer:min-h-11"
                    title="Delete region (and all its text)"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <ul className="flex flex-col gap-1 px-2 pb-2">
                  {elements.map((element) => {
                    const isElementSelected = isRegionSelected && element.id === selectedElementId;
                    return (
                      <li key={element.id}>
                        <div
                          data-testid={`text-tab-element-${element.id}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => onSelectElement && onSelectElement(element.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectElement && onSelectElement(element.id); }
                          }}
                          className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                            isElementSelected ? 'bg-cyan-900/40 ring-1 ring-cyan-400' : 'bg-gray-800/60 hover:bg-gray-800'
                          }`}
                        >
                          <span className="flex-1 min-w-0 truncate text-sm text-gray-100">
                            {element.spec?.text || 'Text'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onToggleText && onToggleText(element.id, element.enabled === false); }}
                            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 coarse-pointer:min-w-11 coarse-pointer:min-h-11"
                            title={element.enabled === false ? 'Show text' : 'Hide text (keep element)'}
                          >
                            {element.enabled === false ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onDeleteText && onDeleteText(element.id); }}
                            className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-red-950/50 coarse-pointer:min-w-11 coarse-pointer:min-h-11"
                            title="Delete text block"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                  <li>
                    {/* "Add text" WITH a region already known: appends an
                        ELEMENT into THIS region -- timing untouched, no
                        second time span created (the bug this replaces). */}
                    <button
                      type="button"
                      data-testid={`text-tab-add-element-${region.index}`}
                      onClick={() => onAddElement && onAddElement(region.id)}
                      className="w-full flex items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-cyan-300 hover:text-cyan-200 hover:bg-cyan-900/20 transition-colors coarse-pointer:min-h-11"
                    >
                      <Plus size={12} />
                      Add text
                    </button>
                  </li>
                </ul>
              </div>
            );
          })
        )}
      </div>

      {/* RIGHT: settings for the SELECTED element -- a FIXED box that never
          moves/resizes when the left list grows (round 4 item 3). */}
      <div
        className="lg:w-3/5 flex flex-col lg:overflow-y-auto lg:border-l lg:border-gray-700 lg:pl-4"
        data-testid="text-settings-panel"
      >
        {selectedElement ? (
          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wide text-gray-400">Settings</div>
            {/* 9-slot position grid replaces free-dragging the text on the
                stage. Same onUpdateTextSpec write path as every other
                setting here -- one surgical write, no second persistence
                path. The existing per-element Align control stays in
                TextSpecEditor below (unchanged; a preset click also sets a
                coherent align, but the dropdown remains independently
                editable). */}
            <PositionPresetGrid
              spec={selectedElement.spec}
              onChange={(nextSpec) => onUpdateTextSpec && onUpdateTextSpec(selectedElement.id, nextSpec)}
            />
            <TextSpecEditor
              spec={selectedElement.spec}
              onChange={(nextSpec) => onUpdateTextSpec && onUpdateTextSpec(selectedElement.id, nextSpec)}
            />
          </div>
        ) : (
          <p className="text-xs text-gray-500">Select a text element to edit its settings.</p>
        )}
      </div>
    </div>
  );
}
