import { Button } from './shared/Button';
import { FOCUS_PUBLISH } from '../config/displayNames';

/**
 * FocusPublishActionBar (T8390) — the `actionBar` footer CollectionPlayer
 * renders for Focus's post-export preview. Strictly presentational (mirrors
 * CollectionPlayer's own contract): all copy/routing lives in the caller
 * (FocusScreen), this component only lays out the four choices.
 *
 * Layout is ONE DOM instance per choice, reordered per breakpoint via
 * `order-*` utilities (never `flex-col-reverse` — T8390 explicitly moves off
 * that pattern; see the corrected comments on ConfirmationDialog.jsx and the
 * old FocusScreen completion card). A single instance also matters for
 * `data-tutorial-target="focus-publish"`: guided-path rule 30 anchors on it,
 * so it must resolve to exactly one element regardless of viewport, never a
 * duplicated mobile+desktop pair.
 *
 * Mobile (column, top -> bottom) and desktop (row, left -> right) both read:
 * Add Spotlight, Publish, Add Spotlight Later, divider, Refocus. Publish
 * sits CENTER, flanked by the two spotlight choices — still visually primary
 * (cyan, `data-tutorial-target`) but no longer the lone full-width action.
 * Refocus is unaffected by the reorder (quiet ghost row, pushed away from
 * the three main choices via `sm:ml-auto` on the Add Spotlight item, the
 * first of the three in desktop visual order).
 *
 * @param {Function} onPublish            - required. Publish tap handler.
 * @param {boolean=} publishLoading       - spins + disables Publish.
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
      className="flex flex-col gap-4 border-t border-gray-800 bg-gray-900 p-4 sm:flex-row sm:items-center sm:gap-3"
    >
      {/* Refocus — mobile: bottom (order-4); desktop: leftmost (order-1),
          pushed away from the rest via sm:ml-auto on the Add Spotlight item. */}
      <div className="order-4 border-t border-gray-800 pt-3 sm:order-1 sm:border-t-0 sm:pt-0">
        <button
          type="button"
          onClick={onRefocus}
          className="w-full text-center text-xs text-gray-500 hover:text-gray-300 sm:w-auto sm:text-left"
        >
          {FOCUS_PUBLISH.REFOCUS_LABEL}
        </button>
      </div>

      {/* Add Spotlight — first of the three main choices. sm:ml-auto pushes
          this item (and Publish/Add Spotlight Later after it) away from
          Refocus on desktop. Carries the shared spotlight caption. */}
      <div className="order-1 sm:order-2 sm:ml-auto">
        <Button variant="secondary" size="md" onClick={onAddSpotlight} className="w-full sm:w-auto">
          {FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL}
        </Button>
        <p className="mt-1 text-center text-xs text-gray-400 sm:text-right">
          {FOCUS_PUBLISH.SPOTLIGHT_CAPTION}
        </p>
      </div>

      {/* Publish — primary, CENTER position on both breakpoints. */}
      <div className="order-2 sm:order-3">
        <Button
          variant="cyan"
          size="md"
          loading={publishLoading}
          onClick={onPublish}
          data-tutorial-target="focus-publish"
          className="w-full sm:w-auto"
        >
          {FOCUS_PUBLISH.PUBLISH_LABEL}
        </Button>
        <p className="mt-1 text-center text-xs text-gray-400 sm:text-right">
          {FOCUS_PUBLISH.PUBLISH_CAPTION}
        </p>
      </div>

      {/* Add Spotlight Later — third of the three main choices. */}
      <div className="order-3 sm:order-4">
        <Button variant="secondary" size="md" onClick={onAddSpotlightLater} className="w-full sm:w-auto">
          {FOCUS_PUBLISH.ADD_SPOTLIGHT_LATER_LABEL}
        </Button>
      </div>
    </div>
  );
}

export default FocusPublishActionBar;
