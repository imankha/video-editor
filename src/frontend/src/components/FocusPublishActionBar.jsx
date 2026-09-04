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
 * Mobile (column, top -> bottom): Publish, [Add Spotlight | Add Spotlight
 * Later], divider, Refocus.
 * Desktop (row, left -> right): Refocus (pushed left), [Add Spotlight | Add
 * Spotlight Later], Publish (rightmost primary).
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
      {/* Refocus — mobile: bottom (order-4); desktop: leftmost, pushed away
          from the rest via ml-auto on its sibling group (order-1). */}
      <div className="order-4 border-t border-gray-800 pt-3 sm:order-1 sm:border-t-0 sm:pt-0">
        <button
          type="button"
          onClick={onRefocus}
          className="w-full text-center text-xs text-gray-500 hover:text-gray-300 sm:w-auto sm:text-left"
        >
          {FOCUS_PUBLISH.REFOCUS_LABEL}
        </button>
      </div>

      {/* Add Spotlight / Add Spotlight Later — equal-weight pair. Same order
          (2) on both breakpoints; only direction/sizing changes. */}
      <div className="order-2 sm:ml-auto">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
          <Button variant="secondary" size="md" onClick={onAddSpotlight} className="w-full sm:w-auto">
            {FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL}
          </Button>
          <Button variant="secondary" size="md" onClick={onAddSpotlightLater} className="w-full sm:w-auto">
            {FOCUS_PUBLISH.ADD_SPOTLIGHT_LATER_LABEL}
          </Button>
        </div>
        <p className="mt-1 text-center text-xs text-gray-400 sm:text-right">
          {FOCUS_PUBLISH.SPOTLIGHT_CAPTION}
        </p>
      </div>

      {/* Publish — primary. Mobile: top (order-1), full-width. Desktop:
          rightmost (order-3). */}
      <div className="order-1 sm:order-3">
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
    </div>
  );
}

export default FocusPublishActionBar;
