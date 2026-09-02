import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FolderOpen, Plus, CheckCircle, Gamepad2, Image, Filter, Clock, ChevronRight, AlertTriangle, RefreshCw, Upload, X, Loader2, Share2, Trophy } from 'lucide-react';
import { LogoWithText } from './Logo';
import { useAppState } from '../contexts';
import { useSettingsStore } from '../stores/settingsStore';
import { GameClipSelectorModal } from './GameClipSelectorModal';
import { GameDetailsModal } from './GameDetailsModal';
import { Button } from './shared/Button';
import { toast } from './shared/Toast';
import { CollapsibleGroup } from './shared/CollapsibleGroup';
import { generateClipName, getProjectDisplayName } from '../utils/clipDisplayName';
import { parseLocalCalendarDate, parseMatchDate, formatMatchDateRange } from '../utils/matchDate';
import { compareGameTime } from '../utils/timeFormat';
import { ProfileDropdown } from './ProfileDropdown';
import { ProfileSportButton } from './ProfileSportButton';
import { CreditBalance } from './CreditBalance';
import { SignInButton } from './SignInButton';
import { useAuthStore } from '../stores/authStore';
import { SECTION_NAMES } from '../config/displayNames';
import { GAME, REEL } from '../config/themeColors';
import { ExpirationBadge } from './ExpirationBadge';
import { StorageExtensionModal } from './StorageExtensionModal';
import { RecapPlayerModal } from './RecapPlayerModal';
import { ShareGameModal } from './ShareGameModal';
import { EditGameModal } from './EditGameModal';
import { prioritizeUrls } from '../utils/cacheWarming';
import { shareInvite } from '../utils/inviteEmail';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProfileStore } from '../stores/profileStore';
import { UPLOAD_STATUS, useUploadStore } from '../stores/uploadStore';
import { useQuestStore } from '../stores/questStore';
import {
  consumePendingRecap,
  setPendingGameReference,
  peekPendingGameReference,
  consumePendingGameReference,
} from '../utils/pendingNavigation';
import { InstallButton } from './InstallButton';
// DraftTile (the restyled ProjectCard) + SegmentedProgressStrip were extracted to their
// own files (T5672). Re-exported below (DraftTile aliased to ProjectCard) so existing
// tests importing them from './ProjectManager' keep resolving.
import { DraftTile } from './DraftTile';
import { SegmentedProgressStrip } from './shared/SegmentedProgressStrip';
import { CardCarousel } from './shared/CardCarousel';
import { GameTile } from './GameTile';
import { UploadingGameTile } from './UploadingGameTile';
import { ReferenceGameCard } from './ReferenceGameCard';
import { DRAFT_STAGE, DRAFT_STAGE_LABELS, DRAFT_STAGE_TINTS, getDraftStage, stageRowsFor, phaseRowsFor } from '../utils/draftStage';

// Shared layout class strings for the Games tab poster grid (T5681/T6310). The
// loaded games grid AND its loading skeleton both consume these so the skeleton
// can never drift from the real layout again (the T6310 bug). If the grid shape
// changes, change it here and both surfaces move together.
const GAMES_GRID_CONTAINER_CLASS = 'w-full max-w-6xl 2xl:max-w-7xl';

// T7330: the desktop column count now follows the data (see gamesGridColumns), so the grid
// class is SELECTED from this map, never built by interpolation -- Tailwind's purge only
// keeps class names that appear as literals in the source. Mobile stays 2-up and tablet 3-up,
// each clamped by the same derived count so a 2-column layout doesn't jump to 3 on a tablet.
// The loading skeleton consumes this map too, so the two can never drift (the T6310 bug).
export const GAMES_TILE_GRID_BY_COLUMNS = {
  2: 'grid grid-cols-2 gap-2 sm:gap-3 lg:gap-4',
  3: 'grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 lg:gap-4',
  4: 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4',
};

// The group header sits in a sticky left rail at lg+ (removing ~64px of vertical chrome per
// group) and stacks above the tiles below lg, exactly as it always has. minmax(0,1fr) is
// mandatory: without it the tile grid's min-content can blow the track out.
const GAMES_GROUP_SECTION_CLASS = 'lg:grid lg:grid-cols-[8rem_minmax(0,1fr)] lg:gap-x-4';
const GAMES_GROUP_HEADER_CLASS = 'mb-2 lg:mb-0 lg:sticky lg:top-2 lg:self-start '
  + 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 lg:block';

// T6810: the stage-labeled carousel rows for one draft list (a game group or
// "Other reels"). Each stage row = a label chip (legend-tinted stage name +
// count) then one carousel per aspect present within that stage; the aspect
// chip only appears when a stage actually mixes aspects.
function DraftStageRows({
  byStage,
  ariaPrefix,
  onSelectProject,
  onSelectProjectWithMode,
  onDeleteProject,
  exportingProject,
  pendingGameIds,
}) {
  return byStage.map(({ stage, byAspect }) => {
    const stageCount = byAspect.reduce((n, bucket) => n + bucket.projects.length, 0);
    return (
      <div key={stage} data-testid={`stage-row-${stage}`}>
        <div className="px-3 pb-1 flex items-center gap-1.5">
          <span className={`text-[10px] font-semibold ${DRAFT_STAGE_TINTS[stage]} bg-gray-700/40 px-1.5 py-0.5 rounded`}>
            {DRAFT_STAGE_LABELS[stage]}
          </span>
          <span className="text-[10px] text-gray-500">{stageCount}</span>
        </div>
        {byAspect.map(({ ratio, projects: aspectProjects }) => (
          <div key={ratio ?? 'source'}>
            {byAspect.length > 1 && (
              <div className="px-3 pb-1">
                <span className="text-[10px] font-semibold text-gray-500 bg-gray-700/40 px-1.5 py-0.5 rounded">
                  {ratio}
                </span>
              </div>
            )}
            <CardCarousel
              ariaLabel={`${ariaPrefix} ${DRAFT_STAGE_LABELS[stage]}${byAspect.length > 1 ? ` ${ratio}` : ''}`}
            >
              {aspectProjects.map(project => (
                <DraftTile
                  key={project.id}
                  project={project}
                  onSelect={() => onSelectProject(project.id)}
                  onSelectWithMode={(options) => onSelectProjectWithMode?.(project.id, options)}
                  onDelete={() => onDeleteProject(project.id)}
                  exportingProject={exportingProject}
                  pendingGameIds={pendingGameIds}
                />
              ))}
            </CardCarousel>
          </div>
        ))}
      </div>
    );
  });
}

// By-Phase view (T8080, aspect-major follow-up): one section per aspect
// PRESENT in a phase (row-height invariant -- a wrapped line must never mix
// tile heights, so aspect is the outer axis, matching every other grouping in
// this file), each carrying compact per-game clusters. Games are usually
// sparse within one (phase, aspect) bucket (a single game contributes 1-2
// drafts), so a full-width row per game would leave most of the row empty
// next to a small fixed-width tile (DraftTile.sizeClass is a fixed px width
// from `sm:` up, not fluid) -- clusters shrink-wrap to their content and a
// flex-wrap container packs several onto the same line. The max-width cap
// keeps a genuinely large cluster (many drafts, one game, one aspect, one
// phase) from growing unbounded -- CardCarousel only detects overflow (and
// shows its scroll/arrow affordances) when its container has a bounded width
// to overflow past.
const COMPACT_ROW_MAX_WIDTH = 'max-w-full sm:max-w-[420px]';

function DraftPhaseAspectRows({
  byAspect,
  ariaPrefix,
  onSelectProject,
  onSelectProjectWithMode,
  onDeleteProject,
  exportingProject,
  pendingGameIds,
}) {
  return byAspect.map(({ ratio, byGame }) => (
    <div key={ratio ?? 'source'}>
      {byAspect.length > 1 && (
        <div className="px-3 pb-1">
          <span className="text-[10px] font-semibold text-gray-500 bg-gray-700/40 px-1.5 py-0.5 rounded">
            {ratio}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        {byGame.map(({ key, label, projects }) => (
          <div key={key} data-testid={`game-row-${key}`} className={`shrink-0 ${COMPACT_ROW_MAX_WIDTH}`}>
            <div className="px-3 pb-1 flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-gray-300 bg-gray-700/40 px-1.5 py-0.5 rounded">
                {label}
              </span>
              <span className="text-[10px] text-gray-500">{projects.length}</span>
            </div>
            <CardCarousel
              ariaLabel={`${ariaPrefix} ${label}${byAspect.length > 1 ? ` ${ratio}` : ''}`}
            >
              {projects.map(project => (
                <DraftTile
                  key={project.id}
                  project={project}
                  onSelect={() => onSelectProject(project.id)}
                  onSelectWithMode={(options) => onSelectProjectWithMode?.(project.id, options)}
                  onDelete={() => onDeleteProject(project.id)}
                  exportingProject={exportingProject}
                  pendingGameIds={pendingGameIds}
                />
              ))}
            </CardCarousel>
          </div>
        ))}
      </div>
    </div>
  ));
}

// T7290: the Games tab organizes by MATCH date, the date the user thinks in and the
// one already shown in the tile title -- not by upload date. Games predating the
// required-field rule, plus materialized/shared rows, can carry a NULL game_date;
// that is an external-data edge case, so they are placed by their upload timestamp
// rather than dropped from the list. The backend logs the missing metadata loudly
// (games.py, list_games) -- this path stays silent so there is only one signal.
// Note the fallback is the CALENDAR DAY of the upload, not its timestamp: list_games
// keys on substr(created_at, 1, 10) and tiebreaks on the full timestamp separately, so
// a full-timestamp key here would win comparisons the server settles on the tiebreak
// and the two orders would disagree (a May 9 match uploaded in June vs a dateless game
// uploaded on May 9). Same reason it must not go through `new Date(created_at)`: an
// ISO-Z timestamp would shift a day west of Greenwich and change the month bucket.
// Takes the ALREADY-PARSED match date rather than re-parsing: parseMatchDate warns on a
// malformed value, and parsing the same game twice would emit that warning twice for one
// bad row, which reads as two separate data bugs.
function gameOrganizingDate(game, matchDate) {
  if (matchDate) return matchDate;

  const uploadDay = parseLocalCalendarDate(String(game.created_at ?? '').slice(0, 10));
  if (uploadDay) return uploadDay;

  // created_at is NOT NULL-by-default in the schema and every writer sets it, so this
  // is our own data being broken, not an edge case. The game still renders (dropping
  // it would hide the bug); it just sorts last, and says why.
  console.error(`[games] Game ${game.id} has neither a usable game_date nor created_at `
    + `(created_at=${JSON.stringify(game.created_at)}) -- placing it last. Data bug.`);
  return new Date(0);
}

// T7330: a tournament name recurs every year, so the NAME alone cannot be the group key --
// "Surf Cup" in 2025 and 2026 must not collapse into one block. Games under one name are cut
// into instances wherever consecutive matches sit more than this far apart. 90 days splits
// an annual recurrence (~365) comfortably while keeping a multi-week cup series together.
const TOURNAMENT_INSTANCE_GAP_DAYS = 90;

// Difference in CALENDAR days between two local-midnight dates. Math.round absorbs the
// +/-1h a DST boundary adds to the raw millisecond difference -- a pair exactly 90 days
// apart must not split (or chain) depending on whether the season changed between them.
// Same landmine family as the UTC-midnight parse this file is careful about.
function calendarDaysBetween(newer, older) {
  return Math.round((newer - older) / 86400000);
}

// One game does not make a tournament group: it stays in its month, where its title already
// reads "Surf Cup: Vs Rebels Jul 4". A group only earns its own header at two or more.
const MIN_TOURNAMENT_GAMES = 2;

function normalizeTournamentName(name) {
  if (typeof name !== 'string') return null;
  const key = name.trim().replace(/\s+/g, ' ').toLowerCase();
  return key || null;
}

/**
 * Group games for the Games tab (T7330, extends T7290's month grouping).
 *
 * Returns ONE ordered array rather than the old {groups, order} pair: with two kinds of
 * group a bare string-keyed map stops being expressive, and every caller only iterates.
 * Each entry is { key, kind: 'month'|'tournament', label, sublabel, sortDate, games }.
 *
 * Ordering is a single descending timeline over BOTH kinds — every group sorts by its newest
 * member, so a tournament sits at its newest match. That deliberately breaks strict month
 * monotonicity when an instance straddles a boundary (Mar 28 - Apr 2 sorts above a Mar 31
 * league game), which is exactly why a tournament header carries its date range.
 *
 * Exported for unit tests: these rules are the whole point of the task.
 */
export function groupGamesForTab(games) {
  // ONE comparable date per game, computed once and reused for the group key AND the
  // comparator -- so the header a game renders under can never disagree with the bucket it
  // sorted into. Ties (two games on one tournament day, where game_date carries no time)
  // break on upload time, newest first: the same tiebreak list_games applies, so server
  // order and rendered order agree. (That agreement holds for MONTH placement; a tournament
  // group intentionally hoists its games out of month order -- see the knowledge doc.)
  const dated = games.map(game => {
    const matchDate = parseMatchDate(game.game_date);   // real match date only, or null
    return {
      game,
      matchDate,
      date: gameOrganizingDate(game, matchDate),
      uploadedAt: new Date(game.created_at),
    };
  });
  dated.sort((a, b) => (b.date - a.date) || (b.uploadedAt - a.uploadedAt));

  // Cluster tournament candidates into instances (already date-descending within a name).
  const byName = new Map();
  for (const entry of dated) {
    const key = normalizeTournamentName(entry.game.tournament_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(entry);
  }

  const tournamentGroups = [];
  const claimed = new Set();
  for (const [key, members] of byName) {
    let instance = [members[0]];
    const instances = [];
    for (const member of members.slice(1)) {
      // Gap is measured against the PREVIOUS member, not the instance's first: a season
      // of games every few weeks chains into one instance no matter how long it runs.
      const gap = calendarDaysBetween(instance[instance.length - 1].date, member.date);
      if (gap <= TOURNAMENT_INSTANCE_GAP_DAYS) instance.push(member);
      else { instances.push(instance); instance = [member]; }
    }
    instances.push(instance);

    for (const inst of instances) {
      if (inst.length < MIN_TOURNAMENT_GAMES) continue;   // singles fall back to their month
      inst.forEach(entry => claimed.add(entry));
      tournamentGroups.push({
        // Instance-scoped so two years of one tournament get distinct React keys.
        key: `tournament:${key}:${inst[0].date.getFullYear()}-${inst[0].date.getMonth() + 1}`,
        kind: 'tournament',
        label: inst[0].game.tournament_name.trim(),       // original casing of the newest
        sublabel: formatMatchDateRange(inst.map(e => e.matchDate)),
        sortDate: inst[0].date,
        sortUploaded: inst[0].uploadedAt,
        games: inst.map(e => e.game),
      });
    }
  }

  // Everything not claimed by a tournament falls into its match month. Insertion order is
  // already date-descending, so a month emptied by a hoist simply never gets created.
  // `claimed` holds ENTRY objects (not game ids), so a hypothetical id-less row can
  // never alias another and silently vanish from both groupings.
  const months = new Map();
  for (const entry of dated) {
    if (claimed.has(entry)) continue;
    const key = `${entry.date.getFullYear()}-${String(entry.date.getMonth() + 1).padStart(2, '0')}`;
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(entry);
  }
  const monthGroups = [...months].map(([key, members]) => ({
    key: `month:${key}`,
    kind: 'month',
    label: members[0].date.toLocaleString('default', { month: 'long', year: 'numeric' }),
    sublabel: null,
    sortDate: members[0].date,
    sortUploaded: members[0].uploadedAt,
    games: members.map(e => e.game),
  }));

  return [...tournamentGroups, ...monthGroups].sort((a, b) =>
    (b.sortDate - a.sortDate) ||
    (b.sortUploaded - a.sortUploaded) ||
    (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'tournament' ? -1 : 1)
  );
}

/**
 * Desktop column count, derived from the data rather than fixed (T7330, user's choice).
 *
 * A six-up grid was sized for a library several times bigger than a typical account: with
 * one or two games per month, rows filled two of six columns and the right two-thirds of
 * every row sat empty. Tracking the largest group fills rows completely at small libraries
 * and converges on a normal 4-up as they grow. Capped at 4 so tiles never get so large that
 * a full month becomes a scroll marathon; floored at 2 to match mobile.
 *
 * This is a pure function of the rendered data -- not a user setting, so nothing is
 * persisted and the no-persisted-view-state rule is untouched.
 */
export function gamesGridColumns(groups) {
  const biggest = groups.reduce((n, group) => Math.max(n, group.games.length), 0);
  return Math.min(4, Math.max(2, biggest));
}

// The active tab is URL state (/home/games -> Games, /home/reels -> Clips),
// never persisted. Map a pathname to its tab, or null when the URL names no tab
// (bare /home) so callers can fall back to a default. (T5677)
function tabFromPath(pathname) {
  if (pathname === '/home/games') return 'games';
  if (pathname === '/home/reels') return 'projects';
  return null;
}

/**
 * ProjectManager - Shown when no project is selected
 *
 * Displays:
 * - Tab navigation: Games | Projects
 * - Games: List of saved games with option to load into annotate mode
 * - Projects: List of existing projects with progress bars
 * - Buttons to add new game or create new project
 */

export function ProjectManager({
  projects,
  loading,
  error, // Projects fetch error
  onSelectProject,
  onSelectProjectWithMode, // (projectId, options) => void - options: { mode: 'framing'|'overlay', clipIndex?: number }
  onCreateProject,
  onRefreshProjects,
  onDeleteProject,
  onAnnotateWithFile, // (file: File) => void - Navigate to annotate mode with file
  // Games props
  games = [],
  gamesLoading = false,
  gamesError, // Games fetch error
  onLoadGame,
  onDeleteGame,
  onFetchGames,
  // Downloads props - now optional, from context
  unseenReelsCount: unseenReelsCountProp,
  onOpenDownloads,
  // Export state - now optional, from context
  exportingProject: exportingProjectProp,
  // Pending uploads props
  pendingUploads = [],
  onResumeUpload,
  onCancelPendingUpload,
  // Upload queue props (in-progress + queued uploads from uploadStore, T7360)
  uploads = [], // [{ id, status, fileName, progress, phase, message }]
  onClickActiveUpload, // Navigate back to annotate mode
  onCancelActiveUpload, // Cancel one upload by id
  // Pending game IDs - projects referencing these are blocked
  pendingGameIds = new Set(),
  // T8360: the Build Highlight Reel modal's open state, lifted to the common
  // parent (ProjectsScreen) so DownloadsPanel's relocated Build button can
  // trigger it. The modal itself stays here (design doc Sec 8 ownership note).
  showNewProjectModal = false,
  onCloseNewProjectModal,
}) {
  // Get downloads and export state from context
  const { unseenReelsCount: contextUnseenReelsCount, exportingProject: contextExportingProject } = useAppState();

  // Use props if provided, otherwise fall back to context
  const unseenReelsCount = unseenReelsCountProp ?? contextUnseenReelsCount ?? 0;
  const exportingProject = exportingProjectProp ?? contextExportingProject;
  const hasClips = games.some(g => g.clip_count > 0);
  // T8360: the Clips tab shows single-clip auto-drafts ONLY. is_auto_created (the
  // raw_clips.auto_project_id link) is the routing key, not clip_count -- see
  // T8360-design.md "The signal we can trust". Multi-clip drafts (is_auto_created
  // === false) live on the Highlight Reels surface's Highlights section instead.
  const clipDrafts = useMemo(() => projects.filter(p => p.is_auto_created), [projects]);
  // T6830: the Clips tab is a dead end when there are no clip drafts AND Create
  // Reel is unreachable (no game has extracted clips) — clicking in can only show
  // an empty list with no way to add one. Disable the tab in exactly that case.
  // Purely derived, no persisted view state. Gated on both loads settling so it
  // can't flash disabled->enabled while games/projects stream in (a user WITH
  // clips would otherwise render disabled for one frame, then enable).
  const clipsTabDisabled =
    !loading && !gamesLoading && clipDrafts.length === 0 && !hasClips;
  // URL-first: a deep link / refresh to /home/games or /home/reels lands on that
  // tab. Bare /home falls back to the clip-drafts-count default. (T5677)
  const initialTab = tabFromPath(window.location.pathname)
    ?? (clipDrafts.length === 0 ? 'games' : 'projects');
  const [activeTab, setActiveTabRaw] = useState(initialTab);
  const setActiveTab = useCallback((tab) => {
    setActiveTabRaw(tab);
    const path = tab === 'games' ? '/home/games' : '/home/reels';
    if (window.location.pathname !== path) {
      window.history.replaceState(null, '', path);
    }
  }, []);
  const [showGameDetailsModal, setShowGameDetailsModal] = useState(false);
  const [extensionGame, setExtensionGame] = useState(null);
  const [recapGame, setRecapGame] = useState(null);
  // T5820: transient cross-profile-reference landing state (NOT persisted — pure
  // in-memory affordance). highlightGameId briefly rings the game we navigated to;
  // referenceNotice shows the degraded-link message when the owning game is gone.
  const [highlightGameId, setHighlightGameId] = useState(null);
  const [referenceNotice, setReferenceNotice] = useState(null);
  const currentProfileId = useProfileStore((s) => s.currentProfileId);
  const [shareGame, setShareGame] = useState(null);
  const [editGame, setEditGame] = useState(null);
  const gameFileInputRef = useRef(null);
  const resumeFileInputRef = useRef(null);
  const gamesContainerRef = useRef(null);
  const promotedGameIdsRef = useRef(new Set());
  const [resumingUploadFilename, setResumingUploadFilename] = useState(null); // Track which upload we're resuming

  // Project filter state - persisted via settings store
  const {
    settings,
    setStatusFilter,
    setAspectFilter,
    setClassification,
  } = useSettingsStore();

  const { statusFilter, aspectFilter, classification } = settings.projectFilters;

  // Viewport-aware cache warming: promote visible game videos in the warm queue
  useEffect(() => {
    const container = gamesContainerRef.current;
    if (!container || games.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      const urls = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const gameId = entry.target.dataset.gameId;
        if (!gameId || promotedGameIdsRef.current.has(gameId)) continue;
        promotedGameIdsRef.current.add(gameId);
        const url = useGamesDataStore.getState().getGameVideoUrl(gameId);
        if (url) urls.push(url);
      }
      if (urls.length > 0) prioritizeUrls(urls);
    }, { threshold: 0.1 });

    // T7320: query DESCENDANTS, not direct children. The callback reads
    // `dataset.gameId`, so the observed element must be the tile wrapper itself --
    // but the grouping render puts month/tournament blocks between the container and
    // the tiles, and observing those made every callback entry a no-op (warming was
    // silently dead from T5681 until this fix). Depth-independent by construction, so
    // another wrapper level cannot break it again. Matches the T5820 lookup below.
    for (const tile of container.querySelectorAll('[data-game-id]')) {
      observer.observe(tile);
    }

    return () => observer.disconnect();
  }, [games]);

  // Filter clip drafts based on selected filters. Base set is clipDrafts (T8360:
  // this tab shows single-clip auto-drafts only), not the full projects array.
  const filteredProjects = useMemo(() => {
    return clipDrafts.filter(project => {
      // Status filter - matches counting logic
      // T66: 'complete' and 'uncompleted' removed - completed projects are archived
      if (statusFilter !== 'all') {
        const isInOverlay = project.has_working_video;
        const isEditing = !isInOverlay && project.clips_in_progress > 0;
        const isExported = !isInOverlay && !isEditing && project.clips_exported > 0;
        const isNotStarted = !isInOverlay && !isEditing && !isExported;

        if (statusFilter === 'overlay' && !isInOverlay) return false;
        if (statusFilter === 'editing' && !isEditing) return false;
        if (statusFilter === 'exported' && !isExported) return false;
        if (statusFilter === 'not_started' && !isNotStarted) return false;
      }

      // Aspect ratio filter
      if (aspectFilter !== 'all' && project.aspect_ratio !== aspectFilter) {
        return false;
      }

      return true;
    });
  }, [clipDrafts, statusFilter, aspectFilter]);

  // Get counts for filter badges and determine which filters are useful
  const filterCounts = useMemo(() => {
    const counts = {
      all: clipDrafts.length,
      // T66: 'complete' and 'uncompleted' removed - completed projects are archived
      overlay: 0,
      editing: 0,
      exported: 0,
      not_started: 0,
      aspects: {},
    };

    clipDrafts.forEach(project => {
      // Status counts - matches ProjectCard display logic
      // T66: All projects in DB are uncompleted (completed ones are archived)
      if (project.has_working_video) {
        counts.overlay++;
      } else if (project.clips_in_progress > 0) {
        counts.editing++;
      } else if (project.clips_exported > 0) {
        counts.exported++;
      } else {
        counts.not_started++;
      }

      // Aspect ratio counts
      const ratio = project.aspect_ratio || '9:16';
      counts.aspects[ratio] = (counts.aspects[ratio] || 0) + 1;
    });

    // Determine which filters are useful (have more than one distinct value)
    const statusValuesWithProjects = [counts.overlay, counts.editing, counts.exported, counts.not_started].filter(v => v > 0).length;
    counts.showStatusFilter = statusValuesWithProjects > 1;
    counts.showAspectFilter = Object.keys(counts.aspects).length > 1;

    // A filter panel is also "useful" whenever its filter is ACTIVE (non-default):
    // hiding the panel for a zero-match active filter leaves the user with an
    // invisible filter they cannot see or clear (staging bug 2026-07-04).
    counts.showStatusFilter = counts.showStatusFilter || statusFilter !== 'all';
    counts.showAspectFilter = counts.showAspectFilter || aspectFilter !== 'all';

    return counts;
  }, [clipDrafts, statusFilter, aspectFilter]);

  // Only show filters if we have more than 1 clip draft and at least one filter is useful
  const showFilters = clipDrafts.length > 1 && (
    filterCounts.showStatusFilter ||
    filterCounts.showAspectFilter
  );

  // Helper to compute status counts for a list of projects
  // Returns two things:
  // 1. Project-level counts (for header badges): how many projects in each overall state
  // 2. Segment-level presence (for legend): which colors appear in ANY project's progress strip
  const getProjectStatusCounts = useCallback((projectList) => {
    // Project-level counts (each project counted once based on overall status)
    let projectsDone = 0;
    let projectsInOverlay = 0;
    let projectsInProgress = 0;
    let projectsNotStarted = 0;

    // Segment-level presence (for legend - tracks if ANY segment of this color exists)
    let hasGreenSegments = false;      // done/exported clips or final video
    let hasDarkBlueSegments = false;   // clips in progress (editing)
    let hasLightBlueSegments = false;  // overlay ready (has working video)
    let hasGraySegments = false;       // pending/not started

    projectList.forEach(project => {
      const { has_final_video, clips_exported, clips_in_progress, has_working_video, has_overlay_edits, clip_count } = project;

      // === Project-level categorization (for header counts) ===
      // T6810: ONE stage derivation (getDraftStage) feeds these counts AND the
      // stage rows below them, so the header badge and its own rows can never
      // disagree on which bucket a draft is in.
      const stage = getDraftStage(project);
      if (stage === DRAFT_STAGE.READY) {
        projectsDone++;
      } else if (stage === DRAFT_STAGE.IN_OVERLAY) {
        projectsInOverlay++;
      } else if (stage === DRAFT_STAGE.IN_FRAMING) {
        projectsInProgress++;
      } else {
        projectsNotStarted++;
      }

      // === Segment-level presence (for legend) ===
      // Green: any exported clips OR final video complete
      if (has_final_video || clips_exported > 0) {
        hasGreenSegments = true;
      }
      // Dark blue: any clips being edited OR overlay edits in progress
      if (clips_in_progress > 0 || (has_overlay_edits && !has_final_video && !has_working_video)) {
        hasDarkBlueSegments = true;
      }
      // Light blue: overlay ready (has working video but not final)
      if (has_working_video && !has_final_video) {
        hasLightBlueSegments = true;
      }
      // Gray: any pending clips OR pending overlay
      const clipsWithProgress = (clips_exported || 0) + (clips_in_progress || 0);
      const totalClips = clip_count || 0;
      if (clipsWithProgress < totalClips) {
        hasGraySegments = true; // Some clips not started
      }
      if (!has_working_video && !has_final_video) {
        hasGraySegments = true; // Overlay not started
      }
    });

    return {
      // Project counts (for header badges)
      done: projectsDone,
      inOverlay: projectsInOverlay,
      inProgress: projectsInProgress,
      notStarted: projectsNotStarted,
      total: projectList.length,
      // Segment presence flags (for legend)
      segments: {
        done: hasGreenSegments,
        inProgress: hasDarkBlueSegments,
        inOverlay: hasLightBlueSegments,
        notStarted: hasGraySegments,
      }
    };
  }, []);

  // Group filtered projects by game group_key for hierarchical display
  const groupedProjects = useMemo(() => {
    const groups = {};
    const ungrouped = [];

    filteredProjects.forEach(project => {
      const key = project.group_key;
      if (key) {
        if (!groups[key]) {
          groups[key] = { projects: [], statusCounts: null };
        }
        groups[key].projects.push(project);
      } else {
        ungrouped.push(project);
      }
    });

    // Compute status counts and most recent game date for each group
    Object.keys(groups).forEach(key => {
      // Order drafts within a game by their in-game time so Clips matches
      // the annotation clip-list and My Reels order (T4080). Single-clip drafts
      // carry clip_game_start_time (backend-derived).
      groups[key].projects.sort((a, b) =>
        compareGameTime(a.clip_game_start_time, b.clip_game_start_time));
      groups[key].statusCounts = getProjectStatusCounts(groups[key].projects);
      // T6810: drafts render one labeled carousel row per pipeline stage
      // (Not Started -> In Framing -> In Overlay -> Ready), each stage keeping
      // the aspect sub-split so tile heights stay consistent within a row;
      // count/statusCounts above stay whole-game (all stages combined).
      groups[key].byStage = stageRowsFor(groups[key].projects);
      // Find the most recent game date in this group
      let mostRecentDate = null;
      groups[key].projects.forEach(project => {
        (project.game_dates || []).forEach(dateStr => {
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date) && (!mostRecentDate || date > mostRecentDate)) {
              mostRecentDate = date;
            }
          }
        });
      });
      groups[key].mostRecentDate = mostRecentDate;
    });

    // Sort group keys: incomplete groups first, then by most recent game date (newest first)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const aComplete = groups[a].statusCounts.done === groups[a].statusCounts.total;
      const bComplete = groups[b].statusCounts.done === groups[b].statusCounts.total;

      // Incomplete groups come first
      if (aComplete !== bComplete) {
        return aComplete ? 1 : -1;
      }
      // Within same completion status, sort by most recent game date (newest first)
      const aDate = groups[a].mostRecentDate;
      const bDate = groups[b].mostRecentDate;
      if (aDate && bDate) {
        return bDate - aDate; // Newest first
      }
      if (aDate) return -1; // a has date, b doesn't
      if (bDate) return 1; // b has date, a doesn't
      // Neither has date, sort alphabetically
      return a.localeCompare(b);
    });

    return { groups, sortedKeys, ungrouped, ungroupedByStage: stageRowsFor(ungrouped) };
  }, [filteredProjects, getProjectStatusCounts]);

  // T8080: the same drafts, primary axis flipped to pipeline stage. Reuses
  // groupedProjects' own game ordering verbatim (sortedKeys, already
  // "incomplete first, then most recent game date") so the two views can
  // never disagree on the RELATIVE order of two real games -- only which
  // axis is outermost. "Other reels" is appended last here (By Game renders
  // it first, above sortedKeys); that's a deliberate per-view placement
  // choice, not an ordering disagreement about games themselves.
  const groupedByPhase = useMemo(() => {
    const orderedGameGroups = groupedProjects.sortedKeys.map(key => ({
      key, label: key, projects: groupedProjects.groups[key].projects,
    }));
    if (groupedProjects.ungrouped.length > 0) {
      orderedGameGroups.push({ key: '__ungrouped__', label: 'Other reels', projects: groupedProjects.ungrouped });
    }
    return phaseRowsFor(orderedGameGroups);
  }, [groupedProjects]);

  // Compute most recent items for "Continue Where You Left Off" section
  const recentItems = useMemo(() => {
    // Get most recent project (by last_opened_at, fall back to created_at)
    const sortedProjects = [...projects].sort((a, b) => {
      const aTime = a.last_opened_at || a.created_at;
      const bTime = b.last_opened_at || b.created_at;
      return new Date(bTime) - new Date(aTime);
    });
    const recentProject = sortedProjects[0] || null;

    // Get most recent game (by created_at)
    const sortedGames = [...games].sort((a, b) => {
      return new Date(b.created_at) - new Date(a.created_at);
    });
    const recentGame = sortedGames[0] || null;

    // Determine which is more recent overall
    let mostRecentType = null;
    if (recentProject && recentGame) {
      const projectTime = new Date(recentProject.last_opened_at || recentProject.created_at);
      const gameTime = new Date(recentGame.created_at);
      mostRecentType = projectTime > gameTime ? 'project' : 'game';
    } else if (recentProject) {
      mostRecentType = 'project';
    } else if (recentGame) {
      mostRecentType = 'game';
    }

    return { recentProject, recentGame, mostRecentType };
  }, [projects, games]);

  // Only show recent section if there's at least one recent item
  const showRecentSection = recentItems.recentProject || recentItems.recentGame;


  // Handle file selection for new game (legacy - keeping for reference)
  const handleGameFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file && onAnnotateWithFile) {
      onAnnotateWithFile({ file });
    }
    // Reset input so same file can be selected again
    event.target.value = '';
  }, [onAnnotateWithFile]);

  // Handle file selection for resuming upload
  const handleResumeFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file && onResumeUpload) {
      onResumeUpload(file, resumingUploadFilename);
    }
    // Reset state
    setResumingUploadFilename(null);
    event.target.value = '';
  }, [onResumeUpload, resumingUploadFilename]);

  // Trigger file picker for resume
  const handleResumeClick = useCallback((originalFilename) => {
    setResumingUploadFilename(originalFilename);
    resumeFileInputRef.current?.click();
  }, []);

  // Auth gate — force login before creating persistent data
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const handleInviteClick = useCallback(() => shareInvite(), []);

  // Open game details modal (requires auth)
  const handleAddGameClick = useCallback(() => {
    requireAuth(() => {
      // Open the picker FIRST so the funnel beacon can never delay it.
      setShowGameDetailsModal(true);
      // T7890: pre-upload funnel beacon — the entry gesture of the signup->first-upload
      // cliff. Fire-and-forget through the impersonation-guarded milestone bridge
      // (session-deduped, keepalive). Fired only after auth succeeds so it maps to a
      // real user and matches the funnel cohort. Not a quest step — analytics only.
      useQuestStore.getState().recordAchievement('add_game_opened');
    });
  }, [requireAuth]);

  // T7840: register the auth-gated add-game gesture as the quest panel's opener
  // for the `upload_game` step so its "Add Your First Game" row is actionable
  // (mirrors the WatchTutorialButton store-action idiom). Cleared on unmount —
  // ephemeral, component-lifetime wiring, never persisted.
  const setAddGameOpener = useQuestStore((s) => s.setAddGameOpener);
  useEffect(() => {
    setAddGameOpener(handleAddGameClick);
    return () => setAddGameOpener(null);
  }, [setAddGameOpener, handleAddGameClick]);

  // Handle game creation with details
  const handleCreateGame = useCallback(async (gameDetails) => {
    if (onAnnotateWithFile) {
      await onAnnotateWithFile(gameDetails);
    }
  }, [onAnnotateWithFile]);

  // ProjectsScreen already fetches games on mount — no need to duplicate here.
  // The tab-switch effect below handles refreshing when user switches to games tab.

  // Switch to projects tab once projects load (initial state may be wrong since data isn't fetched yet at mount)
  const hasSetInitialTab = useRef(false);
  useEffect(() => {
    // T1550: Check for tab hint from navigation (e.g., clicking "Games" breadcrumb in Annotate)
    const hint = sessionStorage.getItem('projectManagerTab');
    if (hint) {
      sessionStorage.removeItem('projectManagerTab');
      setActiveTab(hint);
      hasSetInitialTab.current = true;
      return;
    }
    // A URL-named tab is authoritative — don't let the clip-drafts-count default
    // flip a cold /home/games deep link over to Clips. (T5677)
    if (tabFromPath(window.location.pathname)) {
      hasSetInitialTab.current = true;
      return;
    }
    if (!hasSetInitialTab.current && !loading && clipDrafts.length > 0) {
      setActiveTab('projects');
      hasSetInitialTab.current = true;
    }
  }, [clipDrafts, loading]);

  // T6830: never leave the user parked on a dead-end Clips tab. A /home/reels
  // deep link (or a stale tab hint) lands on 'projects' before data loads; once the
  // loads settle and the tab is disabled, fall back to Games. clipsTabDisabled is
  // false mid-load, so this can't fight the initial-tab logic above; and it never
  // fires for a user with clip drafts or extracted clips (the asymmetric enabled cases).
  useEffect(() => {
    if (clipsTabDisabled && activeTab === 'projects') {
      setActiveTab('games');
    }
  }, [clipsTabDisabled, activeTab, setActiveTab]);

  // Refetch games when opening "new project" modal (needs fresh game list)
  useEffect(() => {
    if (showNewProjectModal && onFetchGames) {
      onFetchGames();
    }
  }, [showNewProjectModal, onFetchGames]);

  // T5730: post-claim landing = the claimed game's recap (watching first), with a
  // one-time "tag your athlete's plays" nudge toward Annotate. Consumed once the
  // games list has loaded so the freshly-imported game is present; the breadcrumb
  // is cleared on read so it fires exactly once (never on a later home visit).
  useEffect(() => {
    if (loading || games.length === 0) return;
    const recapGameId = consumePendingRecap();
    if (recapGameId == null) return;
    const game = games.find(g => g.id === recapGameId);
    if (!game) return;
    setRecapGame({ game, initialTab: 'team' });
    toast.info('Tag your athlete’s plays', {
      message: 'This game is on your Team layer — open Annotate to tag your own athlete.',
    });
  }, [games, loading]);
  // T5820: clicking a reference card is a composite gesture — set the transient
  // cross-profile breadcrumb, hint the Games tab (the existing read-once
  // `projectManagerTab` mechanism, consumed by the effect above), then switch to
  // the owning profile. The switch resets the data stores + navigates to Project
  // Manager; the sessionStorage breadcrumb survives that reset (it clears Zustand
  // only), and the effect below consumes it once the owning profile's games land.
  const handleOpenReference = useCallback((game) => {
    if (!game?.source_profile_id) {
      console.error('[ProjectManager] reference card clicked without a source_profile_id — backend bug', game);
      return;
    }
    setPendingGameReference({
      sourceProfileId: game.source_profile_id,
      sourceGameId: game.source_game_id,
      sourceProfileName: game.source_profile_name,
    });
    sessionStorage.setItem('projectManagerTab', 'games');
    useProfileStore.getState().switchProfile(game.source_profile_id);
  }, []);

  // T5820: after landing in the owning profile, locate the real game by its exact
  // `source_game_id` (projected by GET /api/games under is_reference — T5800),
  // scroll it into view and ring it briefly. Detection of a deleted owning game is
  // at THIS point (a list that settled with no match), never a cross-profile
  // existence check on render.
  //
  // The switch flips currentProfileId BEFORE _resetDataStores refetches, so there is
  // a transient render where we're "on" the owning profile but `games` still holds
  // the previous profile's (stale) list with gamesLoading momentarily false. Consuming
  // then would false-degrade. So we wait for the owning profile's OWN fetch to run:
  // only consume after we've observed gamesLoading go true (fetch started) and back
  // to false (fetch settled) while on the target profile.
  const referenceLoadStartedRef = useRef(false);
  useEffect(() => {
    const pending = peekPendingGameReference();
    if (!pending) return;
    if (currentProfileId !== pending.sourceProfileId) return;
    if (gamesLoading) {
      referenceLoadStartedRef.current = true; // the target profile's fetch is in flight
      return;
    }
    if (!referenceLoadStartedRef.current) return; // still the stale pre-refetch list

    referenceLoadStartedRef.current = false;
    consumePendingGameReference();
    setActiveTab('games');

    if (pending.sourceGameId == null) {
      console.error('[ProjectManager] reference breadcrumb missing sourceGameId — backend bug', pending);
      return;
    }

    const target = games.find(
      (g) => !g.is_reference && g.id === pending.sourceGameId
    );
    if (target) {
      setHighlightGameId(target.id);
      requestAnimationFrame(() => {
        gamesContainerRef.current
          ?.querySelector(`[data-game-id="${target.id}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      const t = setTimeout(() => setHighlightGameId(null), 2500);
      return () => clearTimeout(t);
    }

    // Degraded link: the owning game was deleted after the move. Keep the user
    // informed (no silent no-op); the reference card stays for grouping context.
    // Same owner-label rule as ReferenceGameCard: an UNNAMED profile is normal
    // data (the default profile has no name) and the app calls it "Default";
    // only a genuinely absent name falls back to the vague wording.
    const ownerLabel = pending.sourceProfileName
      || (pending.sourceProfileName == null ? 'that profile' : 'Default');
    setReferenceNotice(`This game is no longer in ${ownerLabel}.`);
    const t = setTimeout(() => setReferenceNotice(null), 6000);
    return () => clearTimeout(t);
  }, [games, gamesLoading, currentProfileId, setActiveTab]);

  // Handle project creation from the new modal
  const handleProjectCreated = useCallback(async (project) => {
    // Close modal first
    onCloseNewProjectModal?.();

    // Refresh projects list to show the new project
    // The modal already created the project via API
    // Don't navigate into the project - let user click on it from the projects page
    // This ensures extraction status is checked before entering Framing mode
    if (onRefreshProjects) {
      await onRefreshProjects();
    }
  }, [onRefreshProjects, onCloseNewProjectModal]);

  return (
    <div className="flex-1 flex flex-col items-center p-4 sm:p-8 bg-gray-900">
      {/* Hidden file input for game video selection */}
      <input
        ref={gameFileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleGameFileChange}
        className="hidden"
      />

      {/* Hidden file input for resuming uploads */}
      <input
        ref={resumeFileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleResumeFileChange}
        className="hidden"
      />

      {/* Credits anchored far left */}
      {isAuthenticated && (
        <div className="fixed top-4 left-4 z-30">
          <CreditBalance />
        </div>
      )}

      {/* Top right controls - Gallery (auth only) + Invite + Sign-in/Profile */}
      <div className="fixed top-4 right-4 z-30 flex items-center gap-3 sm:gap-4">
        <InstallButton />
        {isAuthenticated && onOpenDownloads && (
          <Button
            variant="reelOutline"
            icon={Image}
            onClick={onOpenDownloads}
            title={unseenReelsCount > 0
              ? `${SECTION_NAMES.LIBRARY} (${unseenReelsCount} new)`
              : SECTION_NAMES.LIBRARY}
          >
            <span className="hidden sm:inline">{SECTION_NAMES.LIBRARY}</span>
            {unseenReelsCount > 0 && (
              <span className={`px-1.5 py-0.5 ${REEL.bg} text-white text-xs font-bold rounded-full min-w-[20px] text-center`}>
                {unseenReelsCount}
              </span>
            )}
          </Button>
        )}
        {isAuthenticated && (
          <Button
            variant="reelOutline"
            icon={Share2}
            onClick={handleInviteClick}
            title="Invite a Friend"
          >
            <span className="hidden sm:inline">Invite</span>
          </Button>
        )}
        <SignInButton />
        <ProfileSportButton />
        <ProfileDropdown />
      </div>

      {/* Header — pt-10 clears the fixed top-right controls on mobile */}
      <div className="text-center pt-10 sm:pt-0 mb-4">
        <LogoWithText className="mx-auto mb-3" logoSize={40} textClassName="text-2xl sm:text-3xl" />
        <p className="text-gray-400 text-sm">Share Your Player's Brilliance</p>
      </div>

      {/* Continue Where You Left Off - compact 2-up on mobile, full on desktop */}
      {showRecentSection && (
        <div className="w-full max-w-2xl mb-4">
          <div className="flex items-center gap-2 mb-2 sm:mb-3">
            <Clock size={14} className="text-gray-500" />
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Continue Where You Left Off
            </h2>
          </div>
          <div className="flex gap-2 sm:gap-3">
            {/* Recent Game (left) */}
            {recentItems.recentGame && (
              <button
                onClick={() => onLoadGame(recentItems.recentGame.id)}
                className={`flex-1 min-w-0 min-h-[44px] flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg border transition-all text-left ${GAME.bgSubtle} ${GAME.borderSubtle} ${GAME.bgSubtleHover}`}
              >
                <div className={`p-1.5 sm:p-2 rounded-lg ${GAME.bgIcon}`}>
                  <Gamepad2 size={18} className={GAME.accent} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-white font-medium truncate block">
                    {recentItems.recentGame.name}
                  </span>
                  <div className="hidden sm:block text-xs text-gray-500">
                    {recentItems.recentGame.clip_count} clip{recentItems.recentGame.clip_count !== 1 ? 's' : ''} annotated
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />
              </button>
            )}

            {/* Recent Reel (right) */}
            {recentItems.recentProject && (
              <button
                onClick={() => {
                  const p = recentItems.recentProject;
                  const needsOverlay = p.has_working_video && (
                    !p.has_final_video ||
                    (p.working_video_created_at && p.final_video_created_at &&
                     p.working_video_created_at > p.final_video_created_at)
                  );
                  if (needsOverlay) {
                    onSelectProjectWithMode?.(p.id, { mode: 'overlay' });
                  } else {
                    onSelectProject(p.id);
                  }
                }}
                className={`flex-1 min-w-0 min-h-[44px] flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg border transition-all text-left ${REEL.bgSubtle} ${REEL.borderSubtle} ${REEL.bgSubtleHover}`}
              >
                <div className={`p-1.5 sm:p-2 rounded-lg ${REEL.bgIcon}`}>
                  <FolderOpen size={18} className={REEL.accent} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium truncate">
                      {getProjectDisplayName(recentItems.recentProject)}
                    </span>
                    {recentItems.recentProject.has_final_video && (
                      <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                    )}
                  </div>
                  <div className="hidden sm:block text-xs text-gray-500">
                    {recentItems.recentProject.clip_count} clip{recentItems.recentProject.clip_count !== 1 ? 's' : ''}
                    {' · '}
                    {recentItems.recentProject.has_final_video ? 'Complete' :
                     recentItems.recentProject.has_working_video ? 'In Overlay' :
                     recentItems.recentProject.clips_in_progress > 0 ? 'Focus started' : 'Not Started'}
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tab Navigation - styled to match ModeSwitcher */}
      <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 mb-4">
        <button
          onClick={() => setActiveTab('games')}
          className={`flex items-center gap-2 px-3 py-2 sm:px-4 rounded-md font-medium text-sm transition-all duration-200 ${
            activeTab === 'games'
              ? `${GAME.bg} text-white shadow-lg`
              : 'text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <Gamepad2 size={16} />
          Games
          {games.length > 0 && (
            <span className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
              activeTab === 'games' ? GAME.bgDark : 'bg-gray-700'
            }`}>
              {games.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('projects')}
          disabled={clipsTabDisabled}
          title={clipsTabDisabled ? 'Extract clips from a game first using Annotate mode' : undefined}
          className={`flex items-center gap-2 px-3 py-2 sm:px-4 rounded-md font-medium text-sm transition-all duration-200 ${
            clipsTabDisabled
              ? 'text-gray-600 opacity-50 cursor-not-allowed'
              : activeTab === 'projects'
                ? `${REEL.bg} text-white shadow-lg`
                : 'text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <FolderOpen size={16} />
          {SECTION_NAMES.CLIPS}
          {clipDrafts.length > 0 && (
            <span className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
              activeTab === 'projects' ? REEL.bgDark : 'bg-gray-700'
            }`}>
              {clipDrafts.length}
            </span>
          )}
        </button>
      </div>

      {/* Action Button — T8360: Clips tab has no create action here anymore;
          "Build Highlight Reel" moved to the Highlight Reels surface (DownloadsPanel). */}
      {activeTab === 'games' && (
        <div className="mb-4 sm:mb-5">
          <Button
            variant="success"
            size="lg"
            icon={Plus}
            onClick={handleAddGameClick}
          >
            Add Game
          </Button>
        </div>
      )}

      {/* T5820: degraded cross-profile link notice — the owning game was deleted
          after the move, so the reference could not resolve to a real game. Shown
          briefly so the click is never a silent no-op. */}
      {referenceNotice && (
        <div
          role="status"
          data-reference-notice
          className="mb-4 flex items-start gap-2 rounded-lg border border-yellow-800/50 bg-yellow-900/30 px-3 py-2 text-sm text-yellow-200"
        >
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-yellow-400" />
          <span>{referenceNotice}</span>
          <button
            type="button"
            onClick={() => setReferenceNotice(null)}
            aria-label="Dismiss"
            className="ml-auto flex-shrink-0 text-yellow-400/70 hover:text-yellow-200"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Content */}
      {activeTab === 'games' ? (
        /* Games List */
        gamesLoading ? (
          <GamesListSkeleton />
        ) : gamesError ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center gap-2 text-red-400 mb-3">
              <AlertTriangle size={20} />
              <span className="font-medium">Failed to load games</span>
            </div>
            <p className="text-gray-500 text-sm mb-4">
              {gamesError.includes('fetch') || gamesError.includes('network')
                ? 'Cannot connect to server. Check your internet connection.'
                : gamesError}
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={onFetchGames}
            >
              Retry
            </Button>
          </div>
        ) : games.length === 0 && pendingUploads.length === 0 && uploads.length === 0 ? (
          <div className="text-gray-500 text-center">
            {/* T7840: single status line only — the green Add Game button and the
                quest card's actionable "Add Your First Game" row carry the CTA, so
                the old "Add a game to annotate your footage" sub-line was a third
                duplicate prompt for the same action. */}
            <p>No games yet</p>
          </div>
        ) : (
          <div className={GAMES_GRID_CONTAINER_CLASS}>
            {/* Uploading rail (T7820): every client upload (active/queued/failed,
                T7360 queue) AND every resumable server-side pending session renders
                as a REAL game tile — thumbnail + color-coded bottom-edge progress
                bar — in the SAME grid geometry as the game groups below, replacing
                the old ActiveUploadCard/PendingUploadCard banner rows. The rail
                stays outside the month groups: the game date is unknown until
                entered, so a grid placement would visibly jump groups later. */}
            {(() => {
              // Exclude server sessions whose file is already active/queued
              // client-side (same dedup the old Pending Uploads section did).
              // For multi-video uploads, check against all individual file names.
              const queuedFileNames = new Set();
              uploads.forEach(u => {
                if (u.files) u.files.forEach(f => queuedFileNames.add(f.name));
                else if (u.file) queuedFileNames.add(u.file.name);
                else queuedFileNames.add(u.fileName);
              });
              const filteredPending = pendingUploads.filter(
                p => !queuedFileNames.has(p.original_filename),
              );
              if (uploads.length === 0 && filteredPending.length === 0) return null;
              const anyActive = uploads.some(u => u.status === UPLOAD_STATUS.UPLOADING);
              // SAME grid map + derived column count as the games groups below, so
              // an uploading tile is exactly the size of the game tile it becomes.
              const tileGridClass = GAMES_TILE_GRID_BY_COLUMNS[gamesGridColumns(groupGamesForTab(games))];
              return (
                <section className={`mb-6 lg:mb-8 ${GAMES_GROUP_SECTION_CLASS}`} data-testid="uploading-rail">
                  <header className={GAMES_GROUP_HEADER_CLASS}>
                    <h2 className={`text-sm font-semibold ${anyActive ? GAME.accent : 'text-yellow-400'} uppercase tracking-wide flex items-center gap-2`}>
                      {anyActive
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Upload size={14} />}
                      Uploading
                    </h2>
                  </header>
                  <div className={tileGridClass}>
                    {uploads.map(upload => (
                      <UploadingGameTile
                        key={upload.id}
                        upload={upload}
                        onClick={onClickActiveUpload}
                        onCancel={() => onCancelActiveUpload(upload.id)}
                        onRetry={() => useUploadStore.getState().retryUpload(upload.id)}
                        onDiscard={() => useUploadStore.getState().clearFailedUpload(upload.id)}
                      />
                    ))}
                    {filteredPending.map(sessionRow => (
                      <UploadingGameTile
                        key={sessionRow.session_id}
                        session={sessionRow}
                        onResume={() => handleResumeClick(sessionRow.original_filename)}
                        onCancel={() => onCancelPendingUpload(sessionRow.session_id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })()}

            {/* Your Games Section - Chronological Poster Grid (T5681, regrouped T7330) */}
            {games.length > 0 && (() => {
              const gameGroups = groupGamesForTab(games);
              const tileGridClass = GAMES_TILE_GRID_BY_COLUMNS[gamesGridColumns(gameGroups)];
              return (
                <>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
                    Your Games
                  </h2>
                  <div ref={gamesContainerRef} className="space-y-6 lg:space-y-8">
                    {gameGroups.map(group => (
                      <section key={group.key} data-group-kind={group.kind} className={GAMES_GROUP_SECTION_CLASS}>
                        {/* Group header. A tournament must never read as an oddly-named
                            month, so it differs on THREE axes -- icon, colour, and a date
                            range no month header ever has. Colour alone would fail WCAG
                            1.4.1 (T7330). */}
                        <header className={GAMES_GROUP_HEADER_CLASS}>
                          <h3 className={group.kind === 'tournament'
                            ? 'flex items-baseline gap-1.5 text-base lg:text-[15px] font-semibold text-amber-200 leading-snug break-words'
                            : 'text-base lg:text-[15px] font-semibold text-gray-300 leading-snug break-words'}
                          >
                            {group.kind === 'tournament' && (
                              <Trophy size={14} className="flex-shrink-0 translate-y-0.5 text-amber-400" aria-hidden />
                            )}
                            <span>{group.label}</span>
                          </h3>
                          {group.sublabel && (
                            <p className="text-[11px] text-amber-300/70 lg:mt-0.5">{group.sublabel}</p>
                          )}
                          <span className={group.kind === 'tournament'
                            ? 'text-xs text-amber-200/80 bg-amber-900/30 px-2 py-0.5 rounded-full lg:inline-block lg:mt-1.5'
                            : 'text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full lg:inline-block lg:mt-1.5'}
                          >
                            {group.games.length} game{group.games.length !== 1 ? 's' : ''}
                          </span>
                        </header>
                        {/* Landscape tile grid: column count derived from the data (T7330) */}
                        <div className={tileGridClass}>
                          {group.games.map(game => (
                            <div
                              key={game.id}
                              data-game-id={game.id}
                              className={game.id === highlightGameId
                                ? 'rounded-lg ring-2 ring-green-400 ring-offset-2 ring-offset-gray-900 transition-shadow duration-300'
                                : undefined}
                            >
                              {/* T5820: a reference (cross-profile link) renders a distinct,
                                  non-editable link card; real games render the unchanged tile. */}
                              {game.is_reference ? (
                                <ReferenceGameCard game={game} onOpen={handleOpenReference} />
                              ) : (
                                <GameTile
                                  game={game}
                                  onLoad={() => onLoadGame(game.id)}
                                  onDelete={() => onDeleteGame(game.id)}
                                  onExtend={() => setExtensionGame(game)}
                                  onPlayRecap={(tab) => setRecapGame({ game, initialTab: tab })}
                                  onShare={() => setShareGame(game)}
                                  onEdit={() => setEditGame(game)}
                                  // T7490: a failed upload re-selects the file through the
                                  // same resume file-picker flow (no stored original filename,
                                  // so no name-match warning); Discard is the explicit full
                                  // cascade delete of an abandoned upload.
                                  onRetryUpload={() => handleResumeClick(null)}
                                  onDiscardFailed={() => onDeleteGame(game.id)}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>
        )
      ) : (
        /* Clips List */
        loading ? (
          <div className="text-gray-400">{`Loading ${SECTION_NAMES.CLIPS_LOWER}...`}</div>
        ) : error ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center gap-2 text-red-400 mb-3">
              <AlertTriangle size={20} />
              <span className="font-medium">{`Failed to load ${SECTION_NAMES.CLIPS_LOWER}`}</span>
            </div>
            <p className="text-gray-500 text-sm mb-4">
              {error.includes('fetch') || error.includes('network')
                ? 'Cannot connect to server. Check your internet connection.'
                : error}
            </p>
          </div>
        ) : clipDrafts.length === 0 ? (
          <div className="text-gray-500 text-center">
            <p className="mb-2">No clips yet</p>
            <p className="text-sm">Tap &apos;Create Reel&apos; on a clip in Annotate to start one.</p>
          </div>
        ) : (
          /* Drafts tab widens to max-w-6xl so the carousels use the viewport (Q1 /
             audit finding #13 desktop dead-space fix); the Games tab now uses the same
             GAMES_GRID_CONTAINER_CLASS width (max-w-6xl 2xl:max-w-7xl) for its poster grid. */
          <div className="w-full max-w-6xl 2xl:max-w-7xl">
            {/* Filters - only show when useful. Groups sit inline (gap-x) when they fit,
                and wrap onto their own line when they don't. */}
            {showFilters && (
              <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                {/* Status Filter (T8080: displayed label renamed to "Phase" -- the
                    internal statusFilter name/values are untouched, this is a
                    DIFFERENT bucketing than DRAFT_STAGE/getDraftStage, see the
                    filteredProjects logic above) */}
                {filterCounts.showStatusFilter && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mr-1">Phase</span>
                    {[
                      { value: 'all', label: 'All' },
                      // T66: 'complete' and 'uncompleted' removed - completed projects are archived
                      { value: 'overlay', label: 'In Overlay', color: 'blue' },
                      { value: 'editing', label: 'Focus Started', color: 'blue' },
                      { value: 'exported', label: 'Exported', color: 'purple' },
                      { value: 'not_started', label: 'Not Started', color: 'gray' }
                    ].map(opt => {
                      const count = opt.value === 'all' ? filterCounts.all : filterCounts[opt.value];
                      // Never hide the ACTIVE chip, even at 0 matches — it must stay clickable to clear
                      if (count === 0 && opt.value !== 'all' && opt.value !== statusFilter) return null;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setStatusFilter(opt.value)}
                          className={`px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
                            statusFilter === opt.value
                              ? opt.color === 'blue' ? 'bg-blue-600 text-white'
                                : opt.color === 'gray' ? 'bg-gray-600 text-white'
                                : `${REEL.bg} text-white`
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          {opt.label} ({count})
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Aspect Ratio Filter */}
                {filterCounts.showAspectFilter && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mr-1">Aspect Ratio</span>
                    <button
                      onClick={() => setAspectFilter('all')}
                      className={`px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
                        aspectFilter === 'all'
                          ? `${REEL.bg} text-white`
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      All
                    </button>
                    {Object.entries(filterCounts.aspects).map(([ratio, count]) => (
                      <button
                        key={ratio}
                        onClick={() => setAspectFilter(ratio)}
                        className={`px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
                          aspectFilter === ratio
                            ? `${REEL.bg} text-white`
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        {ratio} ({count})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
                {filteredProjects.length === clipDrafts.length
                  ? `Your ${SECTION_NAMES.CLIPS}`
                  : `Showing ${filteredProjects.length} of ${clipDrafts.length} ${SECTION_NAMES.CLIPS}`}
              </h2>
              {/* T8080: primary classification toggle, session-only (never persisted,
                  same as the other project filters), default By Phase. Deliberately NOT
                  role="group" -- CardCarousel already owns that role for its carousel
                  rows on this screen (aria-label="... drafts"), and several e2e specs
                  locate carousels via an unqualified [role="group"]; aliasing it here
                  would make this toggle the first match and silently void those
                  assertions instead of failing loudly. */}
              {filteredProjects.length > 0 && (
                <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
                  {[
                    { value: 'phase', label: 'By Phase' },
                    { value: 'game', label: 'By Game' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setClassification(opt.value)}
                      aria-pressed={classification === opt.value}
                      className={`px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded-md transition-colors ${
                        classification === opt.value
                          ? `${REEL.bg} text-white`
                          : 'text-gray-400 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {filteredProjects.length === 0 ? (
                <div className="text-gray-500 text-center py-4">
                  <p>{`No ${SECTION_NAMES.CLIPS_LOWER} match the current filters`}</p>
                  <button
                    onClick={() => {
                      setStatusFilter('all');
                      setAspectFilter('all');
                    }}
                    className="mt-2 px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
                  >
                    {`Clear filters (show all ${clipDrafts.length})`}
                  </button>
                </div>
              ) : classification === 'phase' ? (
                <>
                  {/* T8080: By Phase — one section per pipeline stage present
                      (Not Started -> In Focus -> In Overlay -> Ready), each a
                      bordered card (distinguishes phases from each other) with
                      aspect-major rows inside (row-height invariant: a wrapped
                      line never mixes tile heights) sub-grouped by game. */}
                  {groupedByPhase.map(({ stage, count, byAspect }) => (
                    <div
                      key={stage}
                      className="mb-4 rounded-lg border border-gray-700/50 bg-gray-900/20 pt-2 pb-3"
                      data-testid={`phase-section-${stage}`}
                    >
                      <div className="flex items-center gap-2 px-3 py-2 min-h-11">
                        <span className={`text-sm font-medium flex-1 ${DRAFT_STAGE_TINTS[stage]}`}>
                          {DRAFT_STAGE_LABELS[stage]}
                        </span>
                        <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full">
                          {count}
                        </span>
                      </div>
                      <DraftPhaseAspectRows
                        byAspect={byAspect}
                        ariaPrefix={`${DRAFT_STAGE_LABELS[stage]} drafts`}
                        onSelectProject={onSelectProject}
                        onSelectProjectWithMode={onSelectProjectWithMode}
                        onDeleteProject={onDeleteProject}
                        exportingProject={exportingProject}
                        pendingGameIds={pendingGameIds}
                      />
                    </div>
                  ))}
                </>
              ) : (
                <>
                  {/* By Game — Ungrouped drafts (no game) -> one "Other reels"
                      section (bordered card, matches each game's card below);
                      one labeled carousel row per pipeline stage present, each
                      stage aspect-split so row heights stay consistent (T6810) */}
                  {groupedProjects.ungrouped.length > 0 && (
                    <div className="mb-4 rounded-lg border border-gray-700/50 bg-gray-900/20 pt-2 pb-3">
                      <div className="flex items-center gap-2 px-3 py-2 min-h-11">
                        <span className="text-sm font-medium text-gray-200 flex-1">Other reels</span>
                        <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full">
                          {groupedProjects.ungrouped.length}
                        </span>
                      </div>
                      <DraftStageRows
                        byStage={groupedProjects.ungroupedByStage}
                        ariaPrefix="Other reels"
                        onSelectProject={onSelectProject}
                        onSelectProjectWithMode={onSelectProjectWithMode}
                        onDeleteProject={onDeleteProject}
                        exportingProject={exportingProject}
                        pendingGameIds={pendingGameIds}
                      />
                    </div>
                  )}

                  {/* Grouped projects by game - expand if has incomplete or unpublished projects.
                      Bordered card (T8080 follow-up) so one game's group reads as visually
                      distinct from the next, matching the By-Phase treatment above. */}
                  {groupedProjects.sortedKeys.map(groupKey => {
                    const group = groupedProjects.groups[groupKey];
                    const hasIncomplete = group.statusCounts.done < group.statusCounts.total;
                    const hasUnpublished = group.projects.some(p => p.has_final_video && !p.is_published);
                    return (
                    <CollapsibleGroup
                      key={groupKey}
                      title={groupKey}
                      count={group.projects.length}
                      statusCounts={group.statusCounts}
                      defaultExpanded={hasIncomplete || hasUnpublished}
                      className="rounded-lg border border-gray-700/50 bg-gray-900/20 p-1.5"
                    >
                      {/* One labeled carousel row per pipeline stage present
                          (Not Started -> In Framing -> In Overlay -> Ready), each
                          stage aspect-split so a row never mixes tile heights (T6810). */}
                      <DraftStageRows
                        byStage={group.byStage}
                        ariaPrefix={`${groupKey} drafts`}
                        onSelectProject={onSelectProject}
                        onSelectProjectWithMode={onSelectProjectWithMode}
                        onDeleteProject={onDeleteProject}
                        exportingProject={exportingProject}
                        pendingGameIds={pendingGameIds}
                      />
                    </CollapsibleGroup>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )
      )}

      {/* Build Highlight Reel Modal - Game/Clip selector (opened from the
          Highlight Reels surface; see onOpenAssembly/showNewProjectModal) */}
      <GameClipSelectorModal
        isOpen={showNewProjectModal}
        onClose={onCloseNewProjectModal}
        onCreate={handleProjectCreated}
        games={games}
        existingProjectNames={projects?.map(p => p.name) || []}
      />

      {/* Game Details Modal - for creating a new game */}
      <GameDetailsModal
        isOpen={showGameDetailsModal}
        onClose={() => setShowGameDetailsModal(false)}
        onCreateGame={handleCreateGame}
      />

      {extensionGame && (
        <StorageExtensionModal
          game={extensionGame}
          onClose={() => setExtensionGame(null)}
          onExtensionSuccess={onFetchGames}
        />
      )}

      {recapGame && (
        <RecapPlayerModal
          game={recapGame.game || recapGame}
          initialTab={recapGame.initialTab}
          onClose={() => setRecapGame(null)}
        />
      )}

      {shareGame && (
        <ShareGameModal
          gameId={shareGame.id}
          gameName={shareGame.name}
          onClose={() => setShareGame(null)}
        />
      )}

      {editGame && (
        <EditGameModal
          isOpen={!!editGame}
          game={editGame}
          onClose={() => setEditGame(null)}
        />
      )}

    </div>
  );
}


// ActiveUploadCard and PendingUploadCard were removed in T7820: uploads now render
// as UploadingGameTile tiles inside the Uploading rail above (both card components
// were file-local; nothing else imported them).


/**
 * GamesListSkeleton - placeholder shown while the Games tab loads (T4771, rebuilt
 * T6310, re-shaped T7330). Mirrors the loaded poster grid (GameTile, T5681): same
 * container width, same rail-header group shape, and a tile grid taken from the SHARED
 * GAMES_TILE_GRID_BY_COLUMNS map, with `aspect-video` shells instead of GameTiles.
 * Pure render — no fetching, no subscribing.
 *
 * The real grid's column count is derived from the loaded groups, which do not exist yet
 * here, so the skeleton must pick one blind. It uses the 2-COLUMN entry: `grid-cols-2` at
 * every breakpoint, so the default 4 shells make exactly two full rows on mobile, tablet
 * and desktop alike (no ragged partial row anywhere), and the geometry matches the loaded
 * layout EXACTLY for any library whose largest group is <= 2 games — the small-library
 * shape this layout was redesigned for. For a bigger library the loaded grid arrives at
 * 3-4 columns and tiles shrink at that moment; a blind skeleton cannot match every
 * outcome, and matching the small library keeps the no-snap case where the tab is
 * busiest. (Reviewer-accepted trade, T7330 — no unconditional "never snaps" claim.)
 */
export function GamesListSkeleton({ count = 4 }) {
  return (
    <div className={GAMES_GRID_CONTAINER_CLASS} data-testid="games-skeleton">
      {/* "Your Games" heading placeholder */}
      <div className="h-3.5 w-24 bg-gray-700/70 rounded mb-4 animate-pulse" />
      <div className={GAMES_GROUP_SECTION_CLASS}>
        {/* Rail header placeholder: group label + count pill, same slots as the real one */}
        <div className={GAMES_GROUP_HEADER_CLASS}>
          <div className="h-4 w-20 bg-gray-700/70 rounded animate-pulse" />
          <div className="h-4 w-14 bg-gray-700/50 rounded-full animate-pulse lg:mt-1.5" />
        </div>
        <div className={GAMES_TILE_GRID_BY_COLUMNS[2]}>
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="aspect-video bg-gray-800 rounded-lg border border-gray-700 animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Back-compat re-exports (T5672 extraction): tests and callers import these from here.
export { DraftTile as ProjectCard, SegmentedProgressStrip };

export default ProjectManager;
