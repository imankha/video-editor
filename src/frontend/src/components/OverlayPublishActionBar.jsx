import { FolderInput, Sparkles, Crop, Clock } from 'lucide-react';
import { Button } from './shared/Button';
import { OVERLAY_PUBLISH } from '../config/displayNames';

/**
 * OverlayPublishActionBar (T9110) — the `actionBar` footer CollectionPlayer
 * renders for Overlay's post-export completion preview. The Overlay sibling of
 * FocusPublishActionBar (T8390): same preview-first shell, same strictly-
 * presentational contract (all copy/routing lives in the caller, OverlayScreen).
 *
 * The four choices differ from Focus's (Publish Now / Reapply Overlay / Reapply
 * Focus / Publish Later), but the LAYOUT is an exact mirror of
 * FocusPublishActionBar — read that component's doc comment for the full,
 * authoritative rationale behind the flat/no-hierarchy decision, the three-stage
 * responsive grid, the `min-content` (NOT `max-content`) column floor, the
 * `whitespace-nowrap` title span, and why there is deliberately no
 * `overflow-x-auto` safety net. Those are hard-won T8390 decisions; this
 * component reproduces them verbatim rather than re-deriving them.
 *
 * ABSTRACTION NOTE (T9110): a shared `<FlatChoiceActionBar>` taking a list of
 * `{icon, label, caption, onClick}` is the natural extraction, but with only
 * TWO call sites (Focus + Overlay) it would be premature per the project's
 * rule-of-three (abstract on the 3rd duplication, never the 1st/2nd — premature
 * indirection hides code paths from grep). When a 3rd flat action bar appears,
 * extract then and fold both of these onto it. Until then the layout lives in
 * two places on purpose.
 *
 * DELIBERATELY FLAT / NO HIERARCHY (same product decision as T8390 round 2): all
 * four choices render as the SAME `Button variant="secondary" size="lg"` inside
 * identically-styled cards (title + caption). Nothing is bigger, brighter, or
 * more saturated than anything else; the only differentiators are icon + text.
 *
 * Icons match established app conventions rather than inventing new ones:
 * `FolderInput` is the app's "publish" icon (DraftTile), `Sparkles` the
 * "Spotlight" icon (Overlay tab / ModeSwitcher), `Crop` the Focus/framing icon
 * (DraftTile "Open in Focus", ModeSwitcher), `Clock` the "later/defer" icon
 * (DraftTile's in-progress marker).
 *
 * NO TITLE MAY EVER WRAP at `sm:` and up; captions MAY wrap freely — enforced by
 * the two complementary mechanisms documented on FocusPublishActionBar (the
 * `whitespace-nowrap` title span + the `minmax(min-content, 1fr)` column floor).
 * The single-row stage is gated at `xl:` (1280px), NOT `sm:` — verified via live
 * DOM measurement for this bar's own copy (see the T9110 QA log), same reason
 * Focus's bar uses `xl:`.
 *
 * @param {Function} onPublishNow      - required. Publish Now tap handler.
 * @param {boolean=} publishLoading    - spins + disables Publish Now.
 * @param {Function} onReapplyOverlay  - required. Back into Overlay editing.
 * @param {Function} onReapplyFocus    - required. Back into Focus (reframe).
 * @param {Function} onPublishLater    - required. Defer; lands on drafts.
 */
export function OverlayPublishActionBar({
  onPublishNow,
  publishLoading = false,
  onReapplyOverlay,
  onReapplyFocus,
  onPublishLater,
}) {
  return (
    <div
      data-testid="overlay-publish-action-bar"
      className="border-t border-gray-800 bg-gray-900 px-4 py-6 sm:px-6 sm:py-8"
    >
      <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:max-w-2xl sm:grid-cols-[repeat(2,minmax(min-content,1fr))] sm:gap-4 xl:max-w-5xl xl:grid-cols-[repeat(4,minmax(min-content,1fr))]">
        {/* Publish Now — same weight as the rest; leads by position only. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-5 text-center">
          <Button
            variant="secondary"
            size="lg"
            icon={FolderInput}
            loading={publishLoading}
            onClick={onPublishNow}
            data-testid="overlay-publish-now"
            className="w-full"
          >
            <span className="whitespace-nowrap">{OVERLAY_PUBLISH.PUBLISH_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{OVERLAY_PUBLISH.PUBLISH_CAPTION}</p>
        </div>

        {/* Reapply Overlay — go back and redo the spotlight. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-5 text-center">
          <Button variant="secondary" size="lg" icon={Sparkles} onClick={onReapplyOverlay} className="w-full">
            <span className="whitespace-nowrap">{OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{OVERLAY_PUBLISH.REAPPLY_OVERLAY_CAPTION}</p>
        </div>

        {/* Reapply Focus — reframe; caption carries the honest cost warning. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-5 text-center">
          <Button variant="secondary" size="lg" icon={Crop} onClick={onReapplyFocus} className="w-full">
            <span className="whitespace-nowrap">{OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION}</p>
        </div>

        {/* Publish Later — defer; lands on the drafts surface. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-5 text-center">
          <Button variant="secondary" size="lg" icon={Clock} onClick={onPublishLater} className="w-full">
            <span className="whitespace-nowrap">{OVERLAY_PUBLISH.PUBLISH_LATER_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{OVERLAY_PUBLISH.PUBLISH_LATER_CAPTION}</p>
        </div>
      </div>
    </div>
  );
}

export default OverlayPublishActionBar;
