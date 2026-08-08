import { useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import { TextSpecEditor } from '../textspec/TextSpecEditor';
import PositionPresetGrid from './PositionPresetGrid';
import { formatTimeSimple } from '../shared/clipConstants';

/**
 * TextManagementPanel (T6630 round 3/4/5/6) -- the Text tab's body: element
 * management (add/remove ELEMENTS within a region) and settings for the
 * selected element, per the user's direction ("let users add and remove
 * text elements in the Text tab, as well as specify settings for the
 * selected text there"). Whole-REGION creation AND deletion live entirely on
 * the timeline lane (TextLayer.jsx's onAddRegion click handler + its
 * per-block delete button) -- round 6 removed the "Add region" button that
 * used to live here too ("adding and removing regions is done on the
 * timeline", explicit user direction after round 5 kept it as a hedge).
 *
 * MODEL (round 4): a REGION is a time span; it CONTAINS N elements, all
 * rendering simultaneously during it ("a text region can have multiple text
 * elements"). The left list shows the region(s) ACTIVE at the playhead --
 * STRICT range scoping (round 7 item 1: no selectedRegionId exception,
 * unlike TextOverlayPreview.jsx's own burn-in filter) -- caller filters
 * `regions` before passing it in, so this component itself stays a dumb
 * renderer of whatever list it's given. Regions CAN overlap in time (round 7
 * item 2: "depending on where the playhead is, we should show all of the
 * text regions it's over"), so each one renders as its own
 * expand/collapse TREE NODE: a header row (time range, select, delete,
 * expand toggle) with its elements nested underneath when expanded, each
 * with a per-region "+ Add text" (adds an ELEMENT into that region, timing
 * unchanged). One active region auto-expands; several default collapsed
 * (click the chevron to expand) so multiple overlapping regions don't dump
 * every element on screen at once -- the selected region always expands
 * regardless, so selecting an element never hides it.
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

  // T6630 round 7 item 2: tree expand/collapse per region. `overrides` holds
  // only MANUALLY toggled regions (map of id -> expanded); anything not in
  // it falls back to the default rule (one active region -> expanded;
  // several -> collapsed, except the selected one, so selecting an element
  // never hides it). A manual toggle persists for that region even if the
  // active set's size changes later (e.g. the playhead sweeps in a second
  // overlapping region) until toggled again -- deliberately not reset by
  // prop changes, since this is view-only UI state, not reel data.
  const [expandOverrides, setExpandOverrides] = useState(() => new Map());
  const toggleExpanded = (regionId, nextExpanded) => {
    setExpandOverrides((prev) => {
      const next = new Map(prev);
      next.set(regionId, nextExpanded);
      return next;
    });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:h-full">
      {/* LEFT: region list, each showing its elements. Independent scroll. */}
      <div className="lg:w-2/5 flex flex-col gap-3 lg:overflow-y-auto lg:pr-1" data-testid="text-region-list">
        {regions.length === 0 ? (
          <p className="text-xs text-gray-500">No text region under the playhead — click the timeline to add one.</p>
        ) : (
          regions.map((region) => {
            const isRegionSelected = region.id === selectedRegionId;
            const elements = region.elements || [];
            const defaultExpanded = regions.length === 1 || isRegionSelected;
            const isExpanded = expandOverrides.has(region.id) ? expandOverrides.get(region.id) : defaultExpanded;
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
                  <button
                    type="button"
                    data-testid={`text-tab-region-toggle-${region.index}`}
                    aria-expanded={isExpanded}
                    onClick={(e) => { e.stopPropagation(); toggleExpanded(region.id, !isExpanded); }}
                    className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 coarse-pointer:min-w-11 coarse-pointer:min-h-11"
                    title={isExpanded ? 'Collapse region' : 'Expand region'}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <span className="flex-1 min-w-0 text-xs text-gray-400">
                    {/* T6630 round 8 item 5: the region's ordinal number
                        alongside its time range -- user hand-annotated
                        "R1"/"R2" on consecutive rows showing only the time
                        range, with no way to tell them apart at a glance.
                        `region.index` is 0-based (useTextOverlays.js's
                        textOverlaysWithLayout, SAME source TextLayer.jsx's
                        on-lane blocks use), so +1 for a 1-based label. */}
                    Region {region.index + 1} · {formatTimeSimple(region.startTime)}–{formatTimeSimple(region.endTime)}
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

                {isExpanded && (
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
                )}
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
