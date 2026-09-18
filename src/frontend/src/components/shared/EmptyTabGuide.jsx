import { Plus } from 'lucide-react';
import { Button } from './Button';
import { CLIP_UPLOAD, LIBRARY_ACTIONS, SECTION_NAMES_SHORT } from '../../config/displayNames';
import { EMPTY_TAB_GUIDE, PARTIAL_TAB_GUIDE } from '../../config/emptyStates';

/**
 * EmptyTabGuide (T8980, revised T9390, T10280) - the shared empty state rendered
 * by all four home tabs (Games / In Progress Clips / In Progress Reels / Published)
 * when they have nothing in them: the shared TabGuideHeader (centered headline +
 * body), an action block, and (Games only) a footer hint.
 *
 * T10280 (2026-09-17): the flow strip (Games . Clips . Reels . Published diagram)
 * was DELETED -- the user found it redundant with the tab bar directly above. The
 * headline/body now come from the same TabGuideHeader the POPULATED Games/Clips
 * tabs render above their CTA, so all four tabs share one guidance structure.
 *
 * T9390 (Decision 3): Clips at zero games shows Add Video ALONE (no cross-tab Add
 * Game). Reels and Published were gated at the tab bar (ProjectManager) on
 * hasClips, so the Reels empty guide's Build New Reel was always enabled here and
 * the old "no clips" branch was dropped; Published's zero-everything branch was
 * dropped too. T10310 (2026-09-18 user request) removed that tab-bar gate --
 * these two branches can now render at genuine zero clips (not just zero
 * *everything*) -- but their copy already holds up at that count, so neither was
 * restored.
 *
 * @param {'games'|'clips'|'reels'|'published'} tab - which empty state to render
 * @param {number} gamesCount - the account's game count (branches Clips)
 * @param {number} clipCount  - single-clip drafts in progress; drives ONLY the
 *                              Reels "N ready" caption now (T10280 dropped
 *                              Published's "N in progress" line). Same clipDrafts
 *                              count the In Progress Clips badge uses.
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
      <TabGuideHeader tab={tab} />

      <div className="w-full mt-5 mb-4">
        {tab === 'games' && <GamesActions onAddGame={onAddGame} />}
        {tab === 'clips' && (
          <ClipsActions gamesCount={gamesCount} onNavigate={onNavigate} onAddVideo={onAddVideo} />
        )}
        {tab === 'reels' && <ReelsActions clipCount={clipCount} onBuildReel={onBuildReel} />}
      </div>

      <Footer tab={tab} onNavigate={onNavigate} />
    </div>
  );
}

/**
 * TabGuideHeader (T10280) - the ONE guidance block every home tab shares: a
 * centered `text-lg font-semibold` headline over a `text-sm text-gray-400` body,
 * both from EMPTY_TAB_GUIDE[tab]. Rendered by the empty-state EmptyTabGuide above
 * its action block, AND by the POPULATED Games/Clips tabs (ProjectManager) above
 * their upload CTA -- so all four tabs read with one consistent structure instead
 * of the old split (Reels/Published had this header while Games/Clips showed only
 * a bare hint caption). Copy-only, no gestures; the caller owns spacing below it.
 */
export function TabGuideHeader({ tab }) {
  const copy = EMPTY_TAB_GUIDE[tab];
  if (!copy) return null;
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto">
      <h2 className="text-lg font-semibold text-white mb-2">{copy.headline}</h2>
      <p className="text-sm text-gray-400">{copy.body}</p>
    </div>
  );
}

// T9390: decorative top accent border for the partial card, one per tab color.
// Full class names (purge-safe); the per-tab hues match themeColors' tab colors
// as border-top colors.
const STEP_ACCENT_BORDER = {
  games: 'border-t-green-600',
  clips: 'border-t-cyan-600',
  reels: 'border-t-violet-600',
  published: 'border-t-amber-600',
};

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

// T9390 (Decision 3) / T10310: Build New Reel has no disabled state here even
// though the Reels tab is now reachable at zero clips -- clicking it just opens
// GameClipSelectorModal with nothing to pick, same as any other empty picker.
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

  // T10280: the tab's short label for the SR-only aria-label (was FLOW_STEPS,
  // deleted with the flow strip). SECTION_NAMES_SHORT is the same single source
  // the tab bar uses; keys are the upper-cased tab id.
  const stepLabel = SECTION_NAMES_SHORT[tab.toUpperCase()];

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
