import { FolderInput, Sparkles } from 'lucide-react';
import { Button } from './shared/Button';
import { FOCUS_PUBLISH } from '../config/displayNames';

/**
 * FocusPublishActionBar (T8390, redesigned 2026-09-08) — the `actionBar`
 * footer CollectionPlayer renders for Focus's post-export preview. Strictly
 * presentational (mirrors CollectionPlayer's own contract): all copy/routing
 * lives in the caller (FocusScreen), this component only lays out the four
 * choices.
 *
 * VISUAL HIERARCHY, three stacked zones, same DOM/visual order at every
 * width (no `order-*` juggling needed — the old design reordered Refocus
 * from bottom-on-mobile to leftmost-on-desktop to fit a single crammed row;
 * this design never puts all four choices on one row, so there is nothing to
 * reorder, which is itself the fix for the "everything crammed into one
 * dense strip" complaint):
 *
 *   1. Publish Now   — primary. Own cyan-tinted card, full-width `lg` button,
 *                       carries `data-tutorial-target="focus-publish"` (guided
 *                       tutorial rule 30 anchors here; must resolve to exactly
 *                       one element regardless of viewport).
 *   2. Add Spotlight Now / Add Spotlight Later — secondary. Paired inside one
 *                       neutral card under their shared caption; stacked full-
 *                       width on mobile, side-by-side (`flex-1` each) at `sm:`.
 *   3. Refocus       — quiet ghost link, divider-separated, deliberately the
 *                       least visually prominent (it costs credits and is not
 *                       the happy path — keep the parenthetical cost warning).
 *
 * The whole stack sits in a `max-w-md mx-auto` column so it stays a
 * comfortable, legible width and reads as intentional centered whitespace
 * even inside CollectionPlayer's much wider desktop modal (`md:inset-12`),
 * instead of the old right-justified row leaving a lopsided empty gutter.
 *
 * Icons match existing app conventions rather than inventing new ones:
 * `FolderInput` is the app's established "publish" icon (DraftTile's Publish
 * button); `Sparkles` is the established "Spotlight" icon (Overlay mode's
 * tab uses the same icon for the same word).
 *
 * @param {Function} onPublish            - required. Publish Now tap handler.
 * @param {boolean=} publishLoading       - spins + disables Publish Now.
 * @param {Function} onAddSpotlight       - required.
 * @param {Function} onAddSpotlightLater  - required.
 * @param {Function} onRefocus            - required.
 */
export function FocusPublishActionBar({
  onPublish,
  publishLoading = false,
  onAddSpotlight,
  onAddSpotlightLater,
  onRefocus,
}) {
  return (
    <div
      data-testid="focus-publish-action-bar"
      className="border-t border-gray-800 bg-gray-900 px-4 py-6 sm:px-8 sm:py-8"
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-5">
        {/* 1. Publish Now — primary choice, elevated in its own tinted card. */}
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-center">
          <Button
            variant="cyan"
            size="lg"
            icon={FolderInput}
            loading={publishLoading}
            onClick={onPublish}
            data-tutorial-target="focus-publish"
            className="w-full"
          >
            {FOCUS_PUBLISH.PUBLISH_LABEL}
          </Button>
          <p className="mt-2 text-sm text-gray-300">
            {FOCUS_PUBLISH.PUBLISH_CAPTION}
          </p>
        </div>

        {/* 2. Spotlight choices — secondary, paired under one shared caption. */}
        <div className="rounded-xl border border-gray-800 bg-gray-800/40 p-4">
          <p className="text-center text-xs text-gray-400">
            {FOCUS_PUBLISH.SPOTLIGHT_CAPTION}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-3">
            <Button
              variant="secondary"
              size="md"
              icon={Sparkles}
              onClick={onAddSpotlight}
              className="w-full sm:w-auto sm:flex-1"
            >
              {FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL}
            </Button>
            <Button
              variant="secondary"
              size="md"
              icon={Sparkles}
              onClick={onAddSpotlightLater}
              className="w-full sm:w-auto sm:flex-1"
            >
              {FOCUS_PUBLISH.ADD_SPOTLIGHT_LATER_LABEL}
            </Button>
          </div>
        </div>

        {/* 3. Refocus — quiet ghost, divider-separated, least prominent. */}
        <div className="border-t border-gray-800 pt-4 text-center">
          <button
            type="button"
            onClick={onRefocus}
            className="text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            {FOCUS_PUBLISH.REFOCUS_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}

export default FocusPublishActionBar;
