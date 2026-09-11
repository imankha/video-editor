import { FolderInput, Sparkles, Pencil, Clock } from 'lucide-react';
import { Button } from './shared/Button';
import { FOCUS_PUBLISH } from '../config/displayNames';

/**
 * FocusPublishActionBar (T8390, re-hierarchized T9590) — the `actionBar` footer
 * CollectionPlayer renders for Focus's post-export preview. Strictly
 * presentational (mirrors CollectionPlayer's own contract): all copy/routing
 * lives in the caller (FocusScreen); this component only lays out the choices.
 *
 * HIERARCHY (T9590, 2026-09-10 — DELIBERATELY REVERSES T8390's flat "no single
 * choice looks more important than the others" layout, and the 2026-09-08
 * "Publish Now"/"Add Spotlight Now" pairing that supported it). The product
 * owner recorded the conflict at filing and chose to re-hierarchize anyway:
 *
 *   PRIMARY   Add spotlight             — visually dominant (filled cyan `lg`
 *                                          button, tinted+ringed card). Opens the
 *                                          Spotlight editor and NEVER starts an
 *                                          export on its own (behavior constraint,
 *                                          not just weight — handler is a pure
 *                                          setEditorMode('overlay')).
 *   SECONDARY Publish without spotlight — normal gray card. Publishes the framed
 *                                          reel as-is; caption states audience.
 *   TERTIARY  Edit framing              — quiet outline card. Back into AI Focus;
 *                                          caption carries the paid-re-export
 *                                          ("uses credits") warning BEFORE the tap.
 *   QUIET     Save draft                — NOT a competing card: a small ghost
 *                                          link below the grid. Replaces T8390's
 *                                          fourth "Add Spotlight Later" card (that
 *                                          spotlight-framed destination is gone;
 *                                          this is a generic defer-to-drafts).
 *
 * Tab order follows the visual hierarchy for free: the three cards are in
 * DOM order primary→secondary→tertiary, then the Save-draft link, so keyboard
 * focus lands on the dominant action first (T9590 acceptance) with no tabIndex.
 *
 * GRID (kept from T9110's mechanism, restructured for 3 cards): one CSS grid,
 * one DOM instance per card, same order at every width. `grid-cols-1` stacks
 * on mobile; the full single row is gated at `lg:` (1024px) — the three cards'
 * measured content need (~590px) sits comfortably under 1024, so unlike the
 * four-card bar (which needed `xl:`) there is no overflow risk at `lg:`, and
 * the intermediate 2-up stage is dropped because an odd card count orphans the
 * third cell. The column floor stays `minmax(min-content, 1fr)` (NOT
 * `max-content`: T8390's round-6 landmine — `max-content` sizes columns off the
 * WRAPPABLE caption instead of the title, forcing a real horizontal scrollbar at
 * desktop widths). Titles render inside `<span className="whitespace-nowrap">`
 * so their min-content contribution equals their full unwrapped width; captions
 * wrap freely. There is deliberately NO `overflow-x-auto` safety net (it would
 * fail OPEN, hiding this exact class of overflow bug from tests).
 *
 * `data-tutorial-target="focus-publish"` stays on the Publish button (guided-
 * tutorial rule 30 anchor, must resolve to exactly one element) — invisible, so
 * it carries no visual weight and does not compete with the primary action.
 *
 * Icons match established app conventions: `Sparkles` = Spotlight (Overlay tab),
 * `FolderInput` = publish (DraftTile), `Pencil` = edit-again (CollectionPlayer
 * Re-edit), `Clock` = later/defer (DraftTile in-progress marker).
 *
 * @param {Function} onAddSpotlight  - required. Primary. Opens the Spotlight editor.
 * @param {Function} onPublish       - required. Secondary. Publish without spotlight.
 * @param {boolean=} publishLoading  - spins + disables Publish only.
 * @param {Function} onRefocus       - required. Tertiary "Edit framing" tap handler.
 * @param {Function} onSaveDraft     - required. Quiet defer-to-drafts (was Add Spotlight Later).
 */
export function FocusPublishActionBar({
  onAddSpotlight,
  onPublish,
  publishLoading = false,
  onRefocus,
  onSaveDraft,
}) {
  return (
    <div
      data-testid="focus-publish-action-bar"
      className="border-t border-gray-800 bg-gray-900 px-4 py-6 sm:px-6 sm:py-8"
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-4 lg:max-w-4xl lg:grid-cols-[repeat(3,minmax(min-content,1fr))]">
        {/* PRIMARY — Add spotlight. Dominant: filled cyan lg button in a
            tinted, ringed card. Opens the editor; never exports on its own. */}
        <div
          data-testid="focus-choice-primary"
          className="flex h-full flex-col justify-between gap-4 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-5 text-center ring-1 ring-cyan-500/20"
        >
          <Button variant="cyan" size="lg" icon={Sparkles} onClick={onAddSpotlight} className="w-full">
            <span className="whitespace-nowrap">{FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-300">{FOCUS_PUBLISH.SPOTLIGHT_CAPTION}</p>
        </div>

        {/* SECONDARY — Publish without spotlight. Normal gray card; caption
            states the audience/access BEFORE the tap. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-700 bg-gray-800/40 p-5 text-center">
          <Button
            variant="secondary"
            size="md"
            icon={FolderInput}
            loading={publishLoading}
            onClick={onPublish}
            data-tutorial-target="focus-publish"
            className="w-full"
          >
            <span className="whitespace-nowrap">{FOCUS_PUBLISH.PUBLISH_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{FOCUS_PUBLISH.PUBLISH_CAPTION}</p>
        </div>

        {/* TERTIARY — Edit framing. Quiet outline card; caption carries the
            "uses credits" re-export warning BEFORE the tap. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/20 p-5 text-center">
          <Button variant="outline" size="md" icon={Pencil} onClick={onRefocus} className="w-full">
            <span className="whitespace-nowrap">{FOCUS_PUBLISH.EDIT_FRAMING_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{FOCUS_PUBLISH.EDIT_FRAMING_CAPTION}</p>
        </div>
      </div>

      {/* QUIET — Save draft. A small ghost link below the grid, deliberately not
          a fourth competing card; its caption states the drafts destination. */}
      <div className="mx-auto mt-5 flex max-w-md flex-col items-center gap-1 text-center">
        <Button variant="ghost" size="sm" icon={Clock} onClick={onSaveDraft} data-testid="focus-save-draft">
          <span className="whitespace-nowrap">{FOCUS_PUBLISH.SAVE_DRAFT_LABEL}</span>
        </Button>
        <p className="text-xs text-gray-500">{FOCUS_PUBLISH.SAVE_DRAFT_CAPTION}</p>
      </div>
    </div>
  );
}

export default FocusPublishActionBar;
