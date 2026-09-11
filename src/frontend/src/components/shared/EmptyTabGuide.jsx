import { ChevronRight, Plus } from 'lucide-react';
import { Button } from './Button';
import { GAME, REEL, HIGHLIGHT, PUBLISHED } from '../../config/themeColors';
import { CLIP_UPLOAD, LIBRARY_ACTIONS } from '../../config/displayNames';
import { FLOW_STEPS, EMPTY_TAB_GUIDE, PARTIAL_TAB_GUIDE } from '../../config/emptyStates';

/**
 * EmptyTabGuide (T8980, revised T9390) - the shared empty state rendered by all
 * four home tabs (Games / In Progress Clips / In Progress Reels / Published) when
 * they have nothing in them. One activation surface: a compact flow strip (sm+
 * only) showing where this tab sits on the path to a published reel, a headline +
 * one short line, an action block, and (Games only) a footer hint.
 *
 * T9390 (Decision 1): the strip is a 3-node NUMBERED path (Games/Clips/Published)
 * with Reels demoted to an unnumbered, dashed "optional" pill between Clips and
 * Published. The strip renders at sm+ only -- below sm it is dropped entirely (the
 * lit tab bar directly above already orients the user; the "Reels is optional"
 * message now lives in the Reels body line, not only in a graphic).
 *
 * T9390 (Decision 3): Clips at zero games shows Add Video ALONE (no cross-tab Add
 * Game). Reels and Published are gated at the tab bar (ProjectManager) on hasClips,
 * so the Reels empty guide's Build New Reel is always enabled here and the old
 * "no clips" branch is gone; Published's zero-everything branch is gone too.
 *
 * @param {'games'|'clips'|'reels'|'published'} tab - which empty state to render
 * @param {number} gamesCount - the account's game count (branches Clips)
 * @param {number} clipCount  - single-clip drafts in progress (Reels "N ready",
 *                              Published "N in progress"); single source = the
 *                              same clipDrafts count the In Progress Clips badge uses
 * @param {(navId: string) => void} onNavigate - setActiveTab (frozen tab ids)
 * @param {() => void} onAddGame  - open the Add Game flow (Games tab only)
 * @param {() => void} onAddVideo - open the direct clip-upload (Add Video) flow
 * @param {() => void} onBuildReel - open the Build New Reel assembly modal
 * @param {'empty'|'partial'} variant - 'empty' (default) is the full-panel state
 *                              rendered when a tab is completely empty; 'partial'
 *                              (T8990) is the compact, tile-shaped state kept until
 *                              the first row fills (a lone game cell, or a carousel
 *                              filler). The two are separate copy sets + layouts.
 * @param {string} className - extra classes for the partial variant's outer aside,
 *                              so the caller sizes it for its slot (a grid cell's
 *                              `aspect-video self-stretch`, or a carousel filler's
 *                              `h-full`). Ignored by the empty variant.
 * @param {() => void} onAction - the partial variant's single CTA (Games "Open
 *                              game"); tabs whose action sits above the row pass none.
 */
export function EmptyTabGuide({
  tab,
  gamesCount = 0,
  clipCount = 0,
  onNavigate,
  onAddGame,
  onAddVideo,
  onBuildReel,
  variant = 'empty',
  className = '',
  onAction,
}) {
  if (variant === 'partial') {
    return <PartialTabGuide tab={tab} className={className} onAction={onAction} />;
  }

  const copy = EMPTY_TAB_GUIDE[tab];
  if (!copy) return null;

  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto py-4">
      <FlowStrip tab={tab} />
      <h2 className="text-lg font-semibold text-white mb-2">{copy.headline}</h2>
      <p className="text-sm text-gray-400 mb-5">{copy.body}</p>

      <div className="w-full mb-4">
        {tab === 'games' && <GamesActions onAddGame={onAddGame} />}
        {tab === 'clips' && (
          <ClipsActions gamesCount={gamesCount} onNavigate={onNavigate} onAddVideo={onAddVideo} />
        )}
        {tab === 'reels' && <ReelsActions clipCount={clipCount} onBuildReel={onBuildReel} />}
        {tab === 'published' && (
          <PublishedActions clipCount={clipCount} onNavigate={onNavigate} />
        )}
      </div>

      <Footer tab={tab} onNavigate={onNavigate} />
    </div>
  );
}

// The current tab lit in its own themeColors tab color; others muted. Colors are
// complete Tailwind class names (purge-safe) sourced from themeColors.js.
const STEP_COLORS = {
  games: GAME.bg,
  clips: REEL.bg,
  reels: HIGHLIGHT.bg,
  published: PUBLISHED.bg,
};

// T9390: decorative top accent border for the partial card, one per tab color.
// Full class names (purge-safe); mirrors STEP_COLORS' hues as border-top colors.
const STEP_ACCENT_BORDER = {
  games: 'border-t-green-600',
  clips: 'border-t-cyan-600',
  reels: 'border-t-violet-600',
  published: 'border-t-amber-600',
};

// Flow strip: sm+ only. T9530 (N46, 2026-09-10) removed the step NUMBERS: the
// numbered 1-2-3 nodes read as a mandatory pipeline ("a clip must pass through a
// reel before it can be published"), which is false — a single clip publishes on
// its own. The four destinations now render as unnumbered peer labels
// (Games . Clips . Reels . Published), the active one lit in its tab color, so the
// strip orients without prescribing a required order. Reels keeps its dashed
// "optional" pill (it is a genuine detour, not part of the single-clip path).
// Dropped entirely below sm -- the lit tab bar above already orients the user.
function FlowStrip({ tab }) {
  return (
    <div className="mb-6 w-full">
      <ol className="hidden sm:flex items-center justify-center gap-1.5">
        {FLOW_STEPS.map((step, i) => {
          const active = step.key === tab;
          const isLast = i === FLOW_STEPS.length - 1;
          const nextOptional = !isLast && FLOW_STEPS[i + 1].optional;
          const dimChevron = step.optional || nextOptional;

          if (step.optional) {
            return (
              <li key={step.key} className="flex items-center gap-1.5">
                <span
                  className={`flex items-center gap-1 border border-dashed border-gray-600 rounded-full px-2.5 py-1 ${
                    active ? `${STEP_COLORS[step.key]} text-white` : 'text-gray-500'
                  }`}
                >
                  <span className="text-sm font-medium">{step.label}</span>
                  {/* "optional" stays muted even when the pill is lit -- the point
                      is that it never disappears, including on the Reels tab. */}
                  <span className="text-[10px] text-gray-500 uppercase tracking-wide">· optional</span>
                </span>
                {!isLast && <ChevronRight size={16} className="text-gray-700" />}
              </li>
            );
          }

          return (
            <li key={step.key} className="flex items-center gap-1.5">
              <span
                className={`text-sm font-medium px-2.5 py-1 rounded-full ${
                  active ? `${STEP_COLORS[step.key]} text-white` : 'text-gray-500'
                }`}
              >
                {step.label}
              </span>
              {!isLast && (
                <ChevronRight size={16} className={dimChevron ? 'text-gray-700' : 'text-gray-600'} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function GamesActions({ onAddGame }) {
  const c = EMPTY_TAB_GUIDE.games;
  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant="success" size="lg" icon={Plus} onClick={onAddGame}>
        {LIBRARY_ACTIONS.UPLOAD_GAME}
      </Button>
      <p className="text-xs text-gray-500">{c.addGameCaption}</p>
    </div>
  );
}

function ClipsActions({ gamesCount, onNavigate, onAddVideo }) {
  const c = EMPTY_TAB_GUIDE.clips;

  // T9390 (Decision 3): at zero games, Add Video is the ONLY path -- no cross-tab
  // "Add Game" create action, just a caption stating a game is not a prerequisite.
  // The clips-add-video tutorial anchor lives on this single button (T8380
  // invariant: exactly one such node per render).
  if (gamesCount === 0) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Button
          variant="success"
          size="lg"
          icon={Plus}
          onClick={onAddVideo}
          data-tutorial-target="clips-add-video"
        >
          {CLIP_UPLOAD.UPLOAD_CLIP}
        </Button>
        <p className="text-xs text-gray-500">{c.noGameCaption}</p>
      </div>
    );
  }

  // games > 0: a navigation link to the (existing) Games tab AND the Add Video
  // upload path. A cross-tab NAV link to an existing tab was never the complaint;
  // only surfacing a foreign tab's CREATE action was.
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-gray-400">{c.openGameText}</p>
        <Button variant="secondary" size="lg" onClick={() => onNavigate('games')}>
          Go to Games
        </Button>
      </div>

      <div className="flex items-center gap-3 w-full my-1">
        <div className="h-px flex-1 bg-gray-700" />
        <span className="text-xs text-gray-600 uppercase tracking-wide">or</span>
        <div className="h-px flex-1 bg-gray-700" />
      </div>

      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-gray-400">{c.uploadText}</p>
        <Button
          variant="success"
          size="lg"
          icon={Plus}
          onClick={onAddVideo}
          data-tutorial-target="clips-add-video"
        >
          {CLIP_UPLOAD.UPLOAD_CLIP}
        </Button>
      </div>
    </div>
  );
}

// T9390 (Decision 3): the Reels tab is gated on hasClips at the tab bar, so this
// empty guide only renders when a clip exists -- Build New Reel is always enabled
// and the old "no clips" reason + cross-tab button branch was deleted as dead code.
function ReelsActions({ clipCount, onBuildReel }) {
  const c = EMPTY_TAB_GUIDE.reels;
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <Button
        variant="cyan"
        size="lg"
        icon={Plus}
        onClick={onBuildReel}
        className="w-full max-w-xs"
      >
        {LIBRARY_ACTIONS.CREATE_REEL}
      </Button>
      <p className="text-xs text-gray-500">{c.hasClipsCaption(clipCount)}</p>
    </div>
  );
}

// T9390 (Decision 3): Published is gated on hasClips at the tab bar, so games (or
// a clip) are guaranteed here -- the old zero-everything "Add Game" branch was
// deleted as dead code. Two branches remain: drafts in progress, or "cut your
// first clip" pointing back to Games.
function PublishedActions({ clipCount, onNavigate }) {
  const c = EMPTY_TAB_GUIDE.published;
  if (clipCount > 0) {
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <p className="text-sm text-gray-400">{c.draftsText(clipCount)}</p>
        <Button variant="cyan" size="lg" onClick={() => onNavigate('projects')}>
          Open Clips
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <p className="text-sm text-gray-400">{c.noClipsGamesText}</p>
      <Button variant="secondary" size="lg" onClick={() => onNavigate('games')}>
        Go to Games
      </Button>
    </div>
  );
}

// T9390 (Decision 2): footer kept ONLY on Games (the "a game is not a hard
// prerequisite either" hint); Clips/Reels/Published dropped theirs.
function Footer({ tab, onNavigate }) {
  if (tab !== 'games') return null;
  const copy = EMPTY_TAB_GUIDE.games;
  return (
    <p className="text-xs text-gray-500">
      {copy.footerPrefix}
      <button
        type="button"
        onClick={() => onNavigate('projects')}
        className="text-cyan-400 hover:underline font-medium"
      >
        {copy.footerLink}
      </button>
    </p>
  );
}

/**
 * PartialTabGuide (T8990, revised T9390) - the compact, tile-shaped variant. It
 * fills the leftover space in a tab's first row (a lone game's empty grid cell, or
 * a carousel filler beside a short row) with NEXT-STEP coaching, and retires
 * itself the moment the row fills (the caller stops rendering it, or the carousel
 * unmounts it once tiles overflow). No persisted state, no dismiss control: it
 * disappears by construction, not by a gesture.
 *
 * T9390: the flow strip and footer are dropped from this variant entirely (they
 * were the densest block in either variant). A decorative top accent border in the
 * tab's color keeps continuity with the empty variant's visual language; a
 * visually-hidden aria-label preserves the "what tab is this" context for screen
 * reader users now that the visible step text is gone.
 *
 * An `aside` with an `h3` -- the enclosing group already owns the `h2` (a Games
 * month header, a Clips/Published game header).
 */
function PartialTabGuide({ tab, className = '', onAction }) {
  const copy = PARTIAL_TAB_GUIDE[tab];
  if (!copy) return null;

  const stepLabel = FLOW_STEPS.find((s) => s.key === tab)?.label;

  return (
    <aside
      aria-label={stepLabel ? `${stepLabel} guidance` : undefined}
      className={`flex flex-col items-center justify-center text-center overflow-hidden
                  rounded-lg border border-gray-700 border-t-4 ${STEP_ACCENT_BORDER[tab]}
                  bg-gray-800/40 px-3 py-3 ${className}`}
    >
      <h3 className="text-sm font-semibold text-white mb-1.5 leading-snug">{copy.headline}</h3>
      <p className="text-xs text-gray-400 leading-snug">{copy.body}</p>
      {copy.cta && onAction && (
        <div className="mt-3">
          <Button variant="success" size="sm" onClick={onAction}>
            {copy.cta}
          </Button>
        </div>
      )}
    </aside>
  );
}

export default EmptyTabGuide;
