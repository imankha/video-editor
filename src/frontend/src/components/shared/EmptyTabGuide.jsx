import { ChevronRight, Plus } from 'lucide-react';
import { Button } from './Button';
import { GAME, REEL, HIGHLIGHT, PUBLISHED } from '../../config/themeColors';
import { CLIP_UPLOAD } from '../../config/displayNames';
import { FLOW_STEPS, EMPTY_TAB_GUIDE } from '../../config/emptyStates';

/**
 * EmptyTabGuide (T8980) - the shared empty state rendered by all four home tabs
 * (Games / In Progress Clips / In Progress Reels / Published) when they have
 * nothing in them. Replaces the four separate inline dead-end empty states with
 * one activation surface: a numbered flow strip (where this tab sits on the path
 * to a published reel), a headline + two-sentence body, an action block whose
 * primary CTA is ALWAYS enabled or carries a VISIBLE reason plus a working
 * cross-tab button (never a hover-only disabled reason), and a footer hint that
 * names the next tab in the flow.
 *
 * Copy is APPROVED (2026-09-07) and branches per emptyStates.js on what the
 * account already has (games / clips / drafts) -- see EMPTY_TAB_GUIDE.
 *
 * @param {'games'|'clips'|'reels'|'published'} tab - which empty state to render
 * @param {number} gamesCount - the account's game count (branches Clips/Published)
 * @param {number} clipCount  - single-clip drafts in progress (Reels "N ready",
 *                              Published "N in progress"); single source = the
 *                              same clipDrafts count the In Progress Clips badge uses
 * @param {boolean} hasClips  - whether a reel can be built (clip drafts OR clips
 *                              cut from a game); gates the Reels primary CTA
 * @param {(navId: string) => void} onNavigate - setActiveTab (frozen tab ids)
 * @param {() => void} onAddGame  - open the Add Game flow
 * @param {() => void} onAddVideo - open the direct clip-upload (Add Video) flow
 * @param {() => void} onBuildReel - open the Build New Reel assembly modal
 */
export function EmptyTabGuide({
  tab,
  gamesCount = 0,
  clipCount = 0,
  hasClips = false,
  onNavigate,
  onAddGame,
  onAddVideo,
  onBuildReel,
}) {
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
          <ClipsActions gamesCount={gamesCount} onNavigate={onNavigate} onAddGame={onAddGame} onAddVideo={onAddVideo} />
        )}
        {tab === 'reels' && (
          <ReelsActions
            hasClips={hasClips}
            clipCount={clipCount}
            gamesCount={gamesCount}
            onNavigate={onNavigate}
            onBuildReel={onBuildReel}
          />
        )}
        {tab === 'published' && (
          <PublishedActions
            clipCount={clipCount}
            gamesCount={gamesCount}
            onNavigate={onNavigate}
            onAddGame={onAddGame}
          />
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

function FlowStrip({ tab }) {
  const currentIndex = FLOW_STEPS.findIndex((s) => s.key === tab);
  const current = FLOW_STEPS[currentIndex];
  return (
    <div className="mb-6 w-full">
      {/* sm+: full numbered 4-step row, the current step lit in its tab color */}
      <ol className="hidden sm:flex items-center justify-center gap-1.5">
        {FLOW_STEPS.map((step, i) => {
          const active = step.key === tab;
          return (
            <li key={step.key} className="flex items-center gap-1.5">
              <span className="flex items-center gap-1.5">
                <span
                  className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    active ? `${STEP_COLORS[step.key]} text-white` : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {i + 1}
                </span>
                <span className={`text-sm font-medium ${active ? 'text-white' : 'text-gray-500'}`}>
                  {step.label}
                </span>
              </span>
              {i < FLOW_STEPS.length - 1 && <ChevronRight size={16} className="text-gray-600" />}
            </li>
          );
        })}
      </ol>

      {/* below sm: numbered dots, only the current step named below */}
      <div className="sm:hidden flex flex-col items-center gap-2">
        <ol className="flex items-center gap-2" aria-hidden="true">
          {FLOW_STEPS.map((step, i) => {
            const active = step.key === tab;
            return (
              <li
                key={step.key}
                className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
                  active ? `${STEP_COLORS[step.key]} text-white` : 'bg-gray-700 text-gray-500'
                }`}
              >
                {i + 1}
              </li>
            );
          })}
        </ol>
        <span className="text-sm font-medium text-white">
          Step {currentIndex + 1} of {FLOW_STEPS.length}: {current.label}
        </span>
      </div>
    </div>
  );
}

function GamesActions({ onAddGame }) {
  const c = EMPTY_TAB_GUIDE.games;
  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant="success" size="lg" icon={Plus} onClick={onAddGame}>
        Add Game
      </Button>
      <p className="text-xs text-gray-500">{c.addGameCaption}</p>
    </div>
  );
}

function ClipsActions({ gamesCount, onNavigate, onAddGame, onAddVideo }) {
  const c = EMPTY_TAB_GUIDE.clips;
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-gray-400">{gamesCount > 0 ? c.openGameText : c.addGameText}</p>
        {gamesCount > 0 ? (
          <Button variant="secondary" size="lg" onClick={() => onNavigate('games')}>
            Go to Games
          </Button>
        ) : (
          <Button variant="success" size="lg" icon={Plus} onClick={onAddGame}>
            Add Game
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3 w-full my-1">
        <div className="h-px flex-1 bg-gray-700" />
        <span className="text-xs text-gray-600 uppercase tracking-wide">or</span>
        <div className="h-px flex-1 bg-gray-700" />
      </div>

      <div className="flex flex-col items-center gap-2">
        <p className="text-sm text-gray-400">{c.uploadText}</p>
        {/* T8380 invariant: the clips-add-video tutorial target lives on exactly
            one node. This empty-state Add Video button and the non-empty action
            row (ProjectManager) are mutually exclusive, so the anchor is unique. */}
        <Button
          variant="success"
          size="lg"
          icon={Plus}
          onClick={onAddVideo}
          data-tutorial-target="clips-add-video"
        >
          {CLIP_UPLOAD.ADD_VIDEO}
        </Button>
      </div>
    </div>
  );
}

function ReelsActions({ hasClips, clipCount, gamesCount, onNavigate, onBuildReel }) {
  const c = EMPTY_TAB_GUIDE.reels;
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <Button
        variant="cyan"
        size="lg"
        icon={Plus}
        disabled={!hasClips}
        onClick={onBuildReel}
        className="w-full max-w-xs"
      >
        Build New Reel
      </Button>
      {hasClips ? (
        <p className="text-xs text-gray-500">{c.hasClipsCaption(clipCount)}</p>
      ) : (
        <>
          {/* Reason is VISIBLE text, never a hover-only title (T8980 rule). */}
          <p className="text-sm text-gray-400">{c.noClipsReason}</p>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => onNavigate(gamesCount > 0 ? 'games' : 'projects')}
          >
            {c.cutClipButton}
          </Button>
        </>
      )}
    </div>
  );
}

function PublishedActions({ clipCount, gamesCount, onNavigate, onAddGame }) {
  const c = EMPTY_TAB_GUIDE.published;
  if (clipCount > 0) {
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <p className="text-sm text-gray-400">{c.draftsText(clipCount)}</p>
        <Button variant="cyan" size="lg" onClick={() => onNavigate('projects')}>
          Open In Progress Clips
        </Button>
      </div>
    );
  }
  if (gamesCount > 0) {
    return (
      <div className="flex flex-col items-center gap-2 w-full">
        <p className="text-sm text-gray-400">{c.noClipsGamesText}</p>
        <Button variant="secondary" size="lg" onClick={() => onNavigate('games')}>
          Go to Games
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <p className="text-sm text-gray-400">{c.nothingText}</p>
      <Button variant="success" size="lg" icon={Plus} onClick={onAddGame}>
        Add Game
      </Button>
    </div>
  );
}

function Footer({ tab, onNavigate }) {
  const copy = EMPTY_TAB_GUIDE[tab];
  if (tab === 'games') {
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
  return <p className="text-xs text-gray-500">{copy.footer}</p>;
}

export default EmptyTabGuide;
