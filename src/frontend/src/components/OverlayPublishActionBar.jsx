import { useId } from 'react';
import { FolderInput, Sparkles, Crop, ArrowLeft, Check, Loader } from 'lucide-react';
import { Button } from './shared/Button';
import { OVERLAY_PUBLISH } from '../config/displayNames';

/**
 * OverlayPublishActionBar (T9110, re-hierarchized T9590, celebration tiles T10670) —
 * the `actionBar` footer CollectionPlayer renders for Overlay's post-export
 * completion preview. The Overlay sibling of FocusPublishActionBar: same tile shell,
 * same strictly-presentational contract (all copy/routing lives in OverlayScreen).
 *
 * HIERARCHY (T9590, 2026-09-10) is unchanged and tracks PIPELINE POSITION, so the
 * dominant action differs from Focus's on purpose: here the spotlight is ALREADY
 * applied and the reel is finished, so the promoted forward action is Publish.
 * T10670 (2026-09-19, approved V2 "celebration tiles" design) mirrors Focus's tile
 * treatment here:
 *
 *   PRIMARY   Publish           — visually dominant (cyan gradient + glow + a single
 *                                 1.2s pulse); carries publishLoading (aria-disabled
 *                                 + Loader disc); caption states the audience.
 *   SECONDARY Reapply spotlight — quiet tile; back into Spotlight editing.
 *   TERTIARY  Reapply Framing   — quiet tile; caption carries the honest paid-
 *                                 re-export ("uses credits") warning.
 *   QUIET     Done for now      — a small ghost link below the grid, NOT a competing
 *                                 tile; no caption (landing toast names Clips/Reels).
 *
 * T10670 CHANGES vs T9590 (identical to the Focus bar; read its doc comment for the
 * full rationale): the inner pill <Button> is gone (the tile IS the button — one tab
 * stop, aria-labelledby/aria-describedby); the green retention SENTENCE became a
 * one-word "Saved" CHIP beside a new HEADLINE (`data-testid="overlay-retention-note"`
 * stays on the chip); the exit link is "Done for now" (ArrowLeft, no caption).
 *
 * The old inner-button `data-testid="overlay-publish-now"` is RETIRED: the tile is
 * the publish control now, addressable as `overlay-choice-primary` (canonical, kept
 * in lockstep with focus-choice-primary) or by role button "Publish". A single DOM
 * element cannot carry two data-testids, and overlay-publish-now had no readers.
 *
 * GRID / MOTION: shares FocusPublishActionBar's mechanism verbatim — the T8390 grid
 * landmine string is byte-identical (only gap 4 -> 3), titles stay in
 * `whitespace-nowrap`, no `overflow-x-auto`; all keyframes are `motion-safe:` and
 * none loop (tiles stagger 60/120/180ms, one primaryPulse at 400ms). See
 * FocusPublishActionBar's doc comment for why the stagger delay is baked into the
 * arbitrary animate value rather than an inline animationDelay.
 *
 * ABSTRACTION NOTE (still true post-T10670): a shared tiled-choice bar is the
 * natural extraction, but with only TWO call sites it stays premature per the
 * rule-of-three. When a 3rd appears, extract then.
 *
 * Icons match established app conventions: `FolderInput` = publish, `Sparkles` =
 * Spotlight, `Crop` = Focus/framing, `ArrowLeft` = leave/back (replaces the old
 * `Clock`), `Loader` = the publish spinner.
 *
 * @param {Function} onPublishNow     - required. Primary. Publish the finished reel.
 * @param {boolean=} publishLoading   - spins + disables the Publish tile only.
 * @param {Function} onReapplyOverlay - required. Secondary. Back into Spotlight editing.
 * @param {Function} onReapplyFocus   - required. Tertiary. Reframe (paid re-export).
 * @param {Function} onSaveDraft      - required. Quiet "Done for now" exit link.
 * @param {string=}  retentionNote    - the "Saved" chip text derived by the screen via
 *                                       resultRetentionNote; beside the headline,
 *                                       omitted when null.
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
// single, non-looping pulse). See FocusPublishActionBar for why the delay is not inline.
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
 * name). Local to this file (its Focus twin defines its own) — with two call sites a
 * shared extraction stays premature per the rule of three.
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

export function OverlayPublishActionBar({
  onPublishNow,
  publishLoading = false,
  onReapplyOverlay,
  onReapplyFocus,
  onSaveDraft,
  retentionNote,
}) {
  return (
    <div
      data-testid="overlay-publish-action-bar"
      className="border-t border-gray-800 bg-gray-900 px-4 py-4 sm:px-6 sm:py-6"
    >
      {/* Headline + the one-word "Saved" chip (T10670, replaces the green sentence). */}
      <div className="mx-auto mb-4 flex max-w-md items-center justify-center gap-3 lg:max-w-4xl">
        <h2 className="text-lg font-semibold text-white sm:text-xl motion-safe:animate-[readyIn_320ms_ease-out_both]">
          {OVERLAY_PUBLISH.HEADLINE}
        </h2>
        {retentionNote && (
          <span
            data-testid="overlay-retention-note"
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
          icon={FolderInput}
          label={OVERLAY_PUBLISH.PUBLISH_LABEL}
          caption={OVERLAY_PUBLISH.PUBLISH_CAPTION}
          onActivate={onPublishNow}
          loading={publishLoading}
          testId="overlay-choice-primary"
        />
        <Tile
          variant="secondary"
          icon={Sparkles}
          label={OVERLAY_PUBLISH.REAPPLY_OVERLAY_LABEL}
          caption={OVERLAY_PUBLISH.REAPPLY_OVERLAY_CAPTION}
          onActivate={onReapplyOverlay}
        />
        <Tile
          variant="tertiary"
          icon={Crop}
          label={OVERLAY_PUBLISH.REAPPLY_FOCUS_LABEL}
          caption={OVERLAY_PUBLISH.REAPPLY_FOCUS_CAPTION}
          onActivate={onReapplyFocus}
        />
      </div>

      {/* Quiet exit: "Done for now", no caption (the landing toast names the destination). */}
      <div className="mx-auto mt-4 flex max-w-md justify-center">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onSaveDraft} data-testid="overlay-save-draft">
          <span className="whitespace-nowrap">{OVERLAY_PUBLISH.SAVE_DRAFT_LABEL}</span>
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

export default OverlayPublishActionBar;
