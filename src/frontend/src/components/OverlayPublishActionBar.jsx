import { FolderInput, Sparkles, Crop, Clock } from 'lucide-react';
import { Button } from './shared/Button';
import { OVERLAY_PUBLISH } from '../config/displayNames';

/**
 * OverlayPublishActionBar (T9110, re-hierarchized T9590) — the `actionBar`
 * footer CollectionPlayer renders for Overlay's post-export completion preview.
 * The Overlay sibling of FocusPublishActionBar: same preview-first shell, same
 * strictly-presentational contract (all copy/routing lives in OverlayScreen).
 *
 * HIERARCHY (T9590, 2026-09-10). Both bars re-hierarchize together — leaving one
 * flat while the other is tiered recreates the exact inconsistency this task
 * removes (REVERSES T9110's flat four-equal-weight mirror of T8390). The hierarchy
 * tracks PIPELINE POSITION, so the dominant action differs from Focus's on
 * purpose: here the spotlight is ALREADY applied and the reel is finished, so the
 * promoted forward action is Publish (Focus promotes "Add spotlight" instead,
 * because on that screen the spotlight hasn't been added yet):
 *
 *   PRIMARY   Publish           — visually dominant (filled cyan `lg` button in a
 *                                 tinted+ringed card); caption states the audience.
 *   SECONDARY Reapply spotlight — normal gray card; back into Spotlight editing.
 *   TERTIARY  Reapply AI Focus  — quiet outline card; reframe. Caption carries the
 *                                 honest paid-re-export ("uses credits") warning.
 *   QUIET     Save draft        — a small ghost link below the grid, NOT a fourth
 *                                 competing card. Replaces T9110's "Publish Later".
 *
 * Tab order follows the visual hierarchy for free (DOM order primary→secondary→
 * tertiary, then the Save-draft link — dominant action focused first).
 *
 * GRID: shares FocusPublishActionBar's mechanism verbatim — one CSS grid,
 * `grid-cols-1` stacked on mobile, the full 3-across row gated at `lg:` (1024px,
 * the three cards' content need sits well under it), a `minmax(min-content, 1fr)`
 * column floor (NOT `max-content`: the T8390 round-6 scrollbar landmine), titles
 * in `<span className="whitespace-nowrap">`, and deliberately NO `overflow-x-auto`
 * safety net. Read FocusPublishActionBar's doc comment for the full rationale.
 *
 * ABSTRACTION NOTE (still true post-T9590): a shared `<TieredChoiceActionBar>` is
 * the natural extraction, but with only TWO call sites it stays premature per the
 * rule-of-three. When a 3rd tiered action bar appears, extract then.
 *
 * Icons match established app conventions: `FolderInput` = publish (DraftTile),
 * `Sparkles` = Spotlight (Overlay tab), `Crop` = Focus/framing (ModeSwitcher),
 * `Clock` = later/defer (DraftTile in-progress marker).
 *
 * @param {Function} onPublishNow     - required. Primary. Publish the finished reel.
 * @param {boolean=} publishLoading   - spins + disables Publish only.
 * @param {Function} onReapplyOverlay - required. Secondary. Back into Spotlight editing.
 * @param {Function} onReapplyFocus   - required. Tertiary. Reframe (paid re-export).
 * @param {Function} onSaveDraft      - required. Quiet defer-to-drafts (was Publish Later).
 */
export function OverlayPublishActionBar({
  onPublishNow,
  publishLoading = false,
  onReapplyOverlay,
  onReapplyFocus,
  onSaveDraft,
}) {
  return (
    <div
      data-testid="overlay-publish-action-bar"
      className="border-t border-gray-800 bg-gray-900 px-4 py-6 sm:px-6 sm:py-8"
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-4 lg:max-w-4xl lg:grid-cols-[repeat(3,minmax(min-content,1fr))]">
        {/* PRIMARY — Publish. Dominant: filled cyan lg button, tinted+ringed
            card; caption states the audience/access BEFORE the tap. */}
        <div
          data-testid="overlay-choice-primary"
          className="flex h-full flex-col justify-between gap-4 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-5 text-center ring-1 ring-cyan-500/20"
        >
          <Button
            variant="cyan"
            size="lg"
            icon={FolderInput}
            loading={publishLoading}
            onClick={onPublishNow}
            data-testid="overlay-publish-now"
            className="w-full"
          >
            <span className="whitespace-nowrap">{OVERLAY_PUBLISH.PUBLISH_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-300">{OVERLAY_PUBLISH.PUBLISH_CAPTION}</p>
        </div>

        {/* SECONDARY — Reapply spotlight. Normal gray card; redo the spotlight. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-700 bg-gray-800/40 p-5 text-center">
          <Button variant="secondary" size="md" icon={Sparkles} onClick={onReapplyOverlay} className="w-full">
            <span className="whitespace-nowrap">{OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{OVERLAY_PUBLISH.REAPPLY_OVERLAY_CAPTION}</p>
        </div>

        {/* TERTIARY — Reapply AI Focus. Quiet outline card; caption carries the
            honest "uses credits" re-export warning BEFORE the tap. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/20 p-5 text-center">
          <Button variant="outline" size="md" icon={Crop} onClick={onReapplyFocus} className="w-full">
            <span className="whitespace-nowrap">{OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION}</p>
        </div>
      </div>

      {/* QUIET — Save draft. Small ghost link below the grid; caption states the
          drafts destination. */}
      <div className="mx-auto mt-5 flex max-w-md flex-col items-center gap-1 text-center">
        <Button variant="ghost" size="sm" icon={Clock} onClick={onSaveDraft} data-testid="overlay-save-draft">
          <span className="whitespace-nowrap">{OVERLAY_PUBLISH.SAVE_DRAFT_LABEL}</span>
        </Button>
        <p className="text-xs text-gray-500">{OVERLAY_PUBLISH.SAVE_DRAFT_CAPTION}</p>
      </div>
    </div>
  );
}

export default OverlayPublishActionBar;
