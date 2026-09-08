import { FolderInput, Sparkles, Pencil } from 'lucide-react';
import { Button } from './shared/Button';
import { FOCUS_PUBLISH } from '../config/displayNames';

/**
 * FocusPublishActionBar (T8390) — the `actionBar` footer CollectionPlayer
 * renders for Focus's post-export preview. Strictly presentational (mirrors
 * CollectionPlayer's own contract): all copy/routing lives in the caller
 * (FocusScreen), this component only lays out the four choices.
 *
 * DELIBERATELY FLAT / NO HIERARCHY (product owner, round 2: "no single
 * choice should look more important than the others" — overrides the
 * original T8390 design, which made Publish the sole full-width primary and
 * Refocus a quiet de-emphasized ghost link). All four choices — Add
 * Spotlight Now, Publish Now, Add Spotlight Later, Refocus — render as the
 * SAME `Button` variant/size inside identically-styled cards, each with a
 * title (the Button) and a caption (`<p>` below it). Nothing is bigger,
 * brighter, or more saturated than anything else; the only differentiators
 * are icon + label/caption text.
 *
 * Layout: one CSS grid, ONE DOM instance per choice, same DOM/visual order
 * at every width — no `order-*` classes, no duplicate mobile/desktop trees,
 * nothing to reorder, ever. Three stages of the SAME four nodes: `grid-cols-1`
 * stacks them (below `sm`), `sm:` pairs them 2-up, `xl:` lays out the full
 * single row. Reading order: Add Spotlight Now, Publish Now, Add Spotlight
 * Later, Refocus — Add Spotlight Now leads because the product owner named it
 * the conceptually-expected choice, but it leads only by POSITION, never by
 * size or color (the "UX designer places them" ask, round 2).
 *
 * The single-row stage is gated at `xl:` (1280px), not `sm:` (640px) —
 * Reviewer-caught bug (round 6 fix): the row's real measured content need is
 * ~930px, but `sm:` triggers at 640px, so a naive `sm:grid-cols-4` (or even
 * the `min-content`-floored version below) would overflow on every real
 * width from 640px up to roughly 1030px — iPad portrait (768px) included —
 * reintroducing the exact horizontal-scroll bug this component was just
 * fixed for, just at a different width. `sm:` and `lg:` both get the 2-up
 * stage instead, which only needs about half the row's width and comfortably
 * fits from 640px up. `xl:` (1280px) is the first breakpoint verified (via
 * live DOM measurement, not eyeballing) to actually fit the four-across row.
 *
 * `data-tutorial-target="focus-publish"` lives on the Publish Now button
 * (guided-tutorial rule 30 anchor, must resolve to exactly one element at
 * any viewport) — an invisible attribute, so it carries no visual weight.
 *
 * Icons match existing app conventions rather than inventing new ones:
 * `FolderInput` is the app's established "publish" icon (DraftTile's
 * Publish button); `Sparkles` is the established "Spotlight" icon (Overlay
 * mode's tab); `Pencil` is the established "edit again" icon
 * (CollectionPlayer's Re-edit button) — Refocus is conceptually the same
 * action (reframe = edit again).
 *
 * Captions: every card has one, all styled identically (`text-sm italic
 * leading-relaxed text-gray-400` — bigger and qualitatively distinct from
 * the bold/white/upright button title, not just smaller). `SPOTLIGHT_CAPTION`
 * is shown under BOTH spotlight buttons (shared meaning; splitting it across
 * only one of the two would make that card visibly shorter than its twin).
 * `REFOCUS_CAPTION` ("Reframe and export again, uses credits.") carries the
 * cost warning that used to be crammed as a parenthetical into the Refocus
 * button's own label — round 5 split it into a real caption so Refocus's
 * card structure finally matches the other three exactly (title + caption),
 * closing an asymmetry that was contributing to uneven card contents.
 *
 * NO TITLE MAY EVER WRAP, at `sm:` and up (product owner, round 5 — a
 * harder requirement than "shouldn't usually wrap"); captions MAY wrap
 * freely (product owner, round 6: "you can wrap the description text, just
 * dont wrap the title"). Two mechanisms, and they are COMPLEMENTARY, not
 * redundant — mechanism 2 only works because of mechanism 1:
 *   1. Each title renders inside `<span className="whitespace-nowrap">` —
 *      CSS cannot break the line inside that span. This is what makes the
 *      title's own min-content contribution equal its FULL unwrapped width
 *      (without it, min-content would collapse to the title's longest single
 *      word, and mechanism 2 below would stop protecting against wrapping).
 *   2. Every grid stage's column-sizing floor is `minmax(min-content, 1fr)`,
 *      deliberately `min-content`, NOT `max-content`. Round 6 landmine
 *      (found via live DOM measurement, not visual inspection): `max-content`
 *      measures a card's intrinsic width as if NOTHING inside it could wrap,
 *      including the caption `<p>` — so with `max-content` the (wrappable)
 *      caption sentence was silently setting the column floor instead of the
 *      (non-wrappable) title, forcing every column ~150-200px wider than the
 *      title actually needed and causing a real horizontal scrollbar at
 *      1440px viewport width. `min-content` correctly reduces the caption's
 *      contribution to its longest unbreakable word while the title's own
 *      `white-space: nowrap` still forces ITS min-content to equal its full
 *      unwrapped width — so the column floor is driven by the title alone,
 *      exactly as intended, and the caption wraps to fit.
 * There is deliberately no `overflow-x-auto` safety net: Reviewer flagged
 * that an overflow-absorbing scroll container makes this exact class of bug
 * undetectable by any test that only checks the document/viewport for
 * overflow (a permissive fallback that fails OPEN) — so a future regression
 * must show up as an actual failure (visible clipping/scroll), not something
 * silently absorbed. `sm:max-w-5xl` is an upper aesthetic cap so the row
 * doesn't stretch to extreme widths on ultra-wide monitors; `sm:px-6` outer
 * padding matches the UI style guide's documented "Modal section: px-6 py-4".
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
      className="border-t border-gray-800 bg-gray-900 px-4 py-6 sm:px-6 sm:py-8"
    >
      <div className="mx-auto grid w-full max-w-xl grid-cols-1 gap-3 sm:max-w-2xl sm:grid-cols-[repeat(2,minmax(min-content,1fr))] sm:gap-4 xl:max-w-5xl xl:grid-cols-[repeat(4,minmax(min-content,1fr))]">
        {/* Add Spotlight Now — first in reading order (the conceptually-
            expected choice), but same size/color as the other three. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-5 text-center">
          <Button variant="secondary" size="lg" icon={Sparkles} onClick={onAddSpotlight} className="w-full">
            <span className="whitespace-nowrap">{FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{FOCUS_PUBLISH.SPOTLIGHT_CAPTION}</p>
        </div>

        {/* Publish Now — same weight as the rest; only the tutorial-anchor
            attribute (invisible) marks it as different. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-5 text-center">
          <Button
            variant="secondary"
            size="lg"
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

        {/* Add Spotlight Later — same caption as Add Spotlight Now (shared
            meaning), kept for card parity across the grid. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-5 text-center">
          <Button variant="secondary" size="lg" icon={Sparkles} onClick={onAddSpotlightLater} className="w-full">
            <span className="whitespace-nowrap">{FOCUS_PUBLISH.ADD_SPOTLIGHT_LATER_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{FOCUS_PUBLISH.SPOTLIGHT_CAPTION}</p>
        </div>

        {/* Refocus — a real equal-weight button now (was a quiet ghost
            link). Cost-warning copy moved to its own caption (round 5), so
            this card's structure finally matches the other three exactly. */}
        <div className="flex h-full flex-col justify-between gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-5 text-center">
          <Button variant="secondary" size="lg" icon={Pencil} onClick={onRefocus} className="w-full">
            <span className="whitespace-nowrap">{FOCUS_PUBLISH.REFOCUS_LABEL}</span>
          </Button>
          <p className="text-sm italic leading-relaxed text-gray-400">{FOCUS_PUBLISH.REFOCUS_CAPTION}</p>
        </div>
      </div>
    </div>
  );
}

export default FocusPublishActionBar;
