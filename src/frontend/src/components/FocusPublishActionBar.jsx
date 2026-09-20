import { useId } from 'react';
import { FolderInput, Sparkles, Pencil, ArrowLeft, Check, Loader } from 'lucide-react';
import { Button } from './shared/Button';
import { FOCUS_PUBLISH } from '../config/displayNames';

/**
 * FocusPublishActionBar (T8390, re-hierarchized T9590, celebration tiles T10670) —
 * the `actionBar` footer CollectionPlayer renders for Focus's post-export
 * completion preview. Strictly presentational (mirrors CollectionPlayer's own
 * contract): all copy/routing lives in the caller (FocusScreen); this component
 * only lays out the choices.
 *
 * HIERARCHY (T9590, 2026-09-10) is unchanged; T10670 (2026-09-19, approved V2
 * "celebration tiles" design) reshapes the presentation:
 *
 *   PRIMARY   Add spotlight             — visually dominant (cyan gradient + glow +
 *                                          a single 1.2s pulse). Opens the Spotlight
 *                                          editor and NEVER starts an export on its
 *                                          own (handler is a pure setEditorMode).
 *   SECONDARY Publish without spotlight — publishes the framed reel as-is; caption
 *                                          states audience; carries publishLoading
 *                                          (aria-disabled + Loader disc) and the
 *                                          guided-tutorial anchor.
 *   TERTIARY  Edit framing              — quiet tile; caption carries the paid-
 *                                          re-export ("uses credits") warning.
 *   QUIET     Done for now              — a small ghost link below the grid, NOT a
 *                                          competing tile; no caption (the landing
 *                                          toast names Clips/Reels).
 *
 * T10670 CHANGES vs T9590:
 * - The inner pill <Button> is GONE. Each tile IS the button: the tile <div>
 *   carries role="button", tabIndex={0}, handleCardKeyDown (Enter/Space), and its
 *   accessible name/description via aria-labelledby (title span) + aria-describedby
 *   (caption span). Exactly ONE tab stop and ONE accessible name per choice; the
 *   "button inside a button" that read as a form is gone.
 * - `data-tutorial-target="focus-publish"` MOVED from the pill to the Publish tile
 *   (guided rule 30 anchor, still exactly one element, still the Publish gesture).
 * - The green retention SENTENCE above the grid became a one-word "Saved" CHIP
 *   beside a new HEADLINE ("Your clip is ready"). `data-testid="focus-retention-note"`
 *   stays on the chip.
 * - The exit link is "Done for now" with an ArrowLeft icon and NO caption
 *   (SAVE_DRAFT_CAPTION was deleted from displayNames).
 *
 * GRID (T8390 landmine, preserved byte-for-byte): one CSS grid, `grid-cols-1`
 * stacked on mobile, the full 3-across row gated at `lg:` (1024px). The column floor
 * stays `minmax(min-content, 1fr)` (NOT `max-content`: T8390's round-6 landmine sized
 * columns off the WRAPPABLE caption, forcing a real horizontal scrollbar at desktop
 * widths). Titles render inside `<span className="whitespace-nowrap">` so their
 * min-content contribution equals their full unwrapped width; captions wrap freely.
 * There is deliberately NO `overflow-x-auto` safety net (it would fail OPEN). Only
 * the gap changed (4 -> 3); everything else in the grid string is untouched.
 *
 * MOTION: all keyframes below are gated by `motion-safe:` and NONE loop. Tiles rise
 * in staggered (60/120/180ms); the primary alone gets a single `primaryPulse` 400ms
 * after mount. The per-tile stagger delay is baked into the arbitrary `animate-[...]`
 * value rather than an inline `animationDelay` (an inline animation-delay longhand
 * would clobber the primary's SECOND animation, forcing the pulse to fire at the
 * stagger offset instead of 400ms). Keyframes live in a <style> block, same pattern
 * as collectionPlayerTitleFade in CollectionPlayer.
 *
 * Icons match established app conventions: `Sparkles` = Spotlight, `FolderInput` =
 * publish, `Pencil` = edit-again, `ArrowLeft` = leave/back (replaces the old
 * `Clock`, whose "later" vocabulary is retired), `Loader` = the publish spinner.
 *
 * @param {Function} onAddSpotlight  - required. Primary. Opens the Spotlight editor.
 * @param {Function} onPublish       - required. Secondary. Publish without spotlight.
 * @param {boolean=} publishLoading  - spins + disables the Publish tile only.
 * @param {Function} onRefocus       - required. Tertiary "Edit framing" tap handler.
 * @param {Function} onSaveDraft     - required. Quiet "Done for now" exit link.
 * @param {string=}  retentionNote   - the "Saved" chip text derived by the screen via
 *                                      resultRetentionNote; rendered beside the
 *                                      headline, omitted when null.
 */
function handleCardKeyDown(handler) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

const TILE_BASE =
  'group flex h-full flex-row items-center gap-4 rounded-xl p-4 text-left cursor-pointer select-none '
  + 'transition-[transform,box-shadow,border-color,background-color] duration-150 ease-out '
  + 'lg:flex-col lg:items-center lg:gap-3 lg:p-5 lg:text-center '
  + 'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 '
  + 'motion-reduce:transform-none';

const DISC_BASE =
  'flex shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-150';

// One motion-safe animate value per tile (stagger baked in; the primary also gets a
// single, non-looping pulse). See the doc comment for why the delay is not inline.
const ANIMATE = {
  primary: 'motion-safe:animate-[tileIn_320ms_ease-out_60ms_both,primaryPulse_1.2s_ease-out_400ms_1]',
  secondary: 'motion-safe:animate-[tileIn_320ms_ease-out_120ms_both]',
  tertiary: 'motion-safe:animate-[tileIn_320ms_ease-out_180ms_both]',
};

const TILE_VARIANTS = {
  primary: {
    tile:
      'border border-cyan-400/50 bg-gradient-to-b from-cyan-500/20 to-cyan-500/5 '
      + 'shadow-[0_12px_40px_-14px_rgba(34,211,238,0.45)] '
      + 'hover:-translate-y-0.5 hover:border-cyan-300/80 hover:from-cyan-500/30 hover:shadow-[0_16px_48px_-14px_rgba(34,211,238,0.6)] '
      + 'focus-visible:ring-cyan-300 active:translate-y-0 active:scale-[0.98]',
    disabled: 'opacity-60 cursor-not-allowed hover:translate-y-0 hover:shadow-none',
    disc: 'bg-cyan-500/20 text-cyan-300 ring-cyan-400/40 group-hover:bg-cyan-500/30 group-hover:text-cyan-200',
    discSize: 'h-12 w-12 lg:h-14 lg:w-14',
    iconSize: 28,
    title: 'text-cyan-50',
    caption: 'text-cyan-100/80',
  },
  secondary: {
    tile:
      'border border-gray-700 bg-gray-800/60 '
      + 'hover:-translate-y-0.5 hover:border-gray-500 hover:bg-gray-800 hover:shadow-[0_12px_32px_-14px_rgba(0,0,0,0.7)] '
      + 'focus-visible:ring-gray-300 active:translate-y-0 active:scale-[0.98]',
    disabled: 'opacity-60 cursor-not-allowed hover:translate-y-0 hover:shadow-none',
    disc: 'bg-gray-700/70 text-gray-100 ring-gray-600 group-hover:bg-gray-700',
    discSize: 'h-12 w-12 lg:h-14 lg:w-14',
    iconSize: 26,
    title: 'text-white',
    caption: 'text-gray-400',
  },
  tertiary: {
    tile:
      'border border-gray-800 bg-transparent '
      + 'hover:border-gray-600 hover:bg-gray-800/40 '
      + 'focus-visible:ring-gray-400 active:scale-[0.98]',
    disabled: '',
    disc: 'bg-gray-800 text-gray-300 ring-gray-700 group-hover:text-white',
    discSize: 'h-11 w-11 lg:h-12 lg:w-12',
    iconSize: 22,
    title: 'text-white',
    caption: 'text-gray-400',
  },
};

/**
 * One completion choice. The whole tile is the accessible button (one tab stop, one
 * name). Local to this file (its Overlay twin defines its own) — with two call sites
 * a shared extraction stays premature per the rule of three.
 */
function Tile({ variant, icon: Icon, label, caption, onActivate, loading = false, testId, tutorialTarget }) {
  const titleId = useId();
  const captionId = useId();
  const v = TILE_VARIANTS[variant];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-labelledby={titleId}
      aria-describedby={captionId}
      aria-disabled={loading || undefined}
      data-testid={testId}
      data-tutorial-target={tutorialTarget}
      onClick={loading ? undefined : onActivate}
      onKeyDown={loading ? undefined : handleCardKeyDown(onActivate)}
      className={`${TILE_BASE} ${v.tile} ${loading ? v.disabled : ''} ${ANIMATE[variant]}`}
    >
      <span className={`${DISC_BASE} ${v.discSize} ${v.disc}`}>
        {loading
          ? <Loader size={v.iconSize} className="animate-spin" aria-hidden="true" />
          : <Icon size={v.iconSize} aria-hidden="true" />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 lg:items-center">
        <span id={titleId} className={`whitespace-nowrap text-base font-semibold ${v.title}`}>{label}</span>
        <span id={captionId} className={`text-xs leading-snug ${v.caption}`}>{caption}</span>
      </span>
    </div>
  );
}

export function FocusPublishActionBar({
  onAddSpotlight,
  onPublish,
  publishLoading = false,
  onRefocus,
  onSaveDraft,
  retentionNote,
}) {
  return (
    <div
      data-testid="focus-publish-action-bar"
      className="border-t border-gray-800 bg-gray-900 px-4 py-4 sm:px-6 sm:py-6"
    >
      {/* Headline + the one-word "Saved" chip (T10670, replaces the green sentence). */}
      <div className="mx-auto mb-4 flex max-w-md items-center justify-center gap-3 lg:max-w-4xl">
        <h2 className="text-lg font-semibold text-white sm:text-xl motion-safe:animate-[readyIn_320ms_ease-out_both]">
          {FOCUS_PUBLISH.HEADLINE}
        </h2>
        {retentionNote && (
          <span
            data-testid="focus-retention-note"
            className="inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-300 motion-safe:animate-[chipIn_240ms_ease-out_120ms_both]"
          >
            <Check size={12} aria-hidden="true" />{retentionNote}
          </span>
        )}
      </div>

      {/* Grid: class string byte-identical to T9590 (gap 4 -> 3 the only change). */}
      <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-3 lg:max-w-4xl lg:grid-cols-[repeat(3,minmax(min-content,1fr))]">
        <Tile
          variant="primary"
          icon={Sparkles}
          label={FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL}
          caption={FOCUS_PUBLISH.SPOTLIGHT_CAPTION}
          onActivate={onAddSpotlight}
          testId="focus-choice-primary"
        />
        <Tile
          variant="secondary"
          icon={FolderInput}
          label={FOCUS_PUBLISH.PUBLISH_LABEL}
          caption={FOCUS_PUBLISH.PUBLISH_CAPTION}
          onActivate={onPublish}
          loading={publishLoading}
          tutorialTarget="focus-publish"
        />
        <Tile
          variant="tertiary"
          icon={Pencil}
          label={FOCUS_PUBLISH.EDIT_FRAMING_LABEL}
          caption={FOCUS_PUBLISH.EDIT_FRAMING_CAPTION}
          onActivate={onRefocus}
        />
      </div>

      {/* Quiet exit: "Done for now", no caption (the landing toast names the destination). */}
      <div className="mx-auto mt-4 flex max-w-md justify-center">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onSaveDraft} data-testid="focus-save-draft">
          <span className="whitespace-nowrap">{FOCUS_PUBLISH.SAVE_DRAFT_LABEL}</span>
        </Button>
      </div>

      <style>{`
        @keyframes readyIn {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes chipIn {
          0% { opacity: 0; transform: scale(0.7); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes tileIn {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes primaryPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); }
          50% { box-shadow: 0 0 0 6px rgba(34, 211, 238, 0.35); }
        }
      `}</style>
    </div>
  );
}

export default FocusPublishActionBar;
