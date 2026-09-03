import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Image, Plus } from 'lucide-react';
import { ShareModal } from './ShareModal';
import { Z } from '../constants/zLayers';
import { CollectionShareModal } from './CollectionShareModal';
import { MoveToProfileModal } from './MoveToProfileModal';
import { Button } from './shared/Button';
import { CollectionsTab } from './collections/CollectionsTab';
import { ReelTile } from './collections/ReelTile';
import { DraftTile } from './DraftTile';
import { CardCarousel } from './shared/CardCarousel';
import { useProjectsStore } from '../stores/projectsStore';
import { useReadyGames } from '../stores/gamesDataStore';
import { IntroStoryPlayer } from './introcards/IntroStoryPlayer';
import { ConfidenceBanner } from './ranking/ConfidenceBanner';
import { RankingGame } from './ranking/RankingGame';
import { toPlayerReel } from './collections/playerReels';
import { useReEditReel } from '../hooks/useReEditReel';
import { useDownloads } from '../hooks/useDownloads';
import { useCollections } from '../hooks/useCollections';
import { useMoveReels } from '../hooks/useMoveReels';
import { useProfileStore } from '../stores/profileStore';
import { useIntroCardStore } from '../stores/introCardStore';
import { IntroCardPicker } from './introcards/IntroCardPicker';
import { collectionIntroKey } from './collections/introBadgeKey';
import { RATIO_ORDER } from '../constants/aspectRatios';
import { formatDurationHuman } from './collections/format';
import { useWebShare } from '../hooks/useWebShare';
import { useGalleryStore } from '../stores/galleryStore';
import { SourceType } from '../constants/sourceTypes';
import { useQuestStore } from '../stores/questStore';
import { setWarmupPriority, WARMUP_PRIORITY } from '../utils/cacheWarming';
import { toast } from './shared/Toast';
import { track } from '../utils/analytics';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { SECTION_NAMES } from '../config/displayNames';
import { REEL } from '../config/themeColors';
import { formatGameClock } from '../utils/timeFormat';
import { sportEmoji } from '../modes/annotate/constants/tagRegistry';

/**
 * DownloadsPanel - Slide-out panel for managing final video downloads
 *
 * Features:
 * - Lists all final videos grouped by date
 * - Each item shows: project name, filename, date, file size
 * - Actions: Download to local, Open project, Delete
 *
 * Race-safe:
 * - Uses useDownloads hook with AbortController
 * - Shows loading skeleton while fetching
 * - Guards against stale state updates
 */
export function DownloadsPanel({
  onOpenProject,  // (projectId) => void - Navigate to project
  // T8360: in-progress "Highlights" section + relocated assembly button (moved
  // here from ProjectManager's Clips tab). The GameClipSelectorModal itself
  // stays owned by ProjectManager (design doc Sec 8 ownership note, option b) --
  // this panel only triggers it via onOpenAssembly.
  onOpenAssembly, // () => void - open the Build Highlight Reel modal (owned by ProjectManager)
  onSelectProject, // (projectId) => void - open a Highlights draft
  onSelectProjectWithMode, // (projectId, options) => void
  onDeleteProject, // (projectId) => void
  onViewClips, // T8470 (Part C): () => void - switch home to the Clips tab (ProjectManager owns tab state, lifted here like onOpenAssembly)
  exportingProject,
  pendingGameIds = new Set(),
}) {
  // Gallery state from store
  const isOpen = useGalleryStore((state) => state.isOpen);
  const close = useGalleryStore((state) => state.close);
  // T8360: Highlights = in-progress multi-clip drafts (is_auto_created === false).
  // Same `projects` array the Clips tab reads, partitioned client-side -- no
  // separate fetch, no migration (see design doc Sec 5.1).
  const projects = useProjectsStore((state) => state.projects);
  const highlightDrafts = projects.filter((p) => !p.is_auto_created);
  // T8470 (Part C): the Clips-tab population - single-clip auto-drafts. Same
  // predicate ProjectManager's clipDrafts uses, so the drawer's empty-state
  // count can never disagree with the Clips tab's badge count.
  const draftClipCount = projects.filter((p) => p.is_auto_created).length;
  const readyGames = useReadyGames();
  const hasClips = readyGames.some((g) => g.clip_count > 0);
  // Header chip = NEW (unwatched) reels, matching the home "My Reels" badge so the
  // same number appears in both places. galleryStore is the source of truth (the
  // full reel list is not fetched on open); the count derives from watched_at and
  // decrements as reels are watched (T3900).
  const unseenReelsCount = useGalleryStore((state) => state.unwatchedCount);

  // useDownloads supplies the per-reel action helpers + formatters. The full-list
  // fetch is disabled (false) — the single view sources members from
  // useCollections, not this list (T3610 §0B.1). `downloads` stays [].
  const {
    downloads,
    deleteDownload,
    downloadFile,
    downloadCollection,
    downloadingId,
    downloadProgress,
    renameDownload,
    setIntroCard,
    pruneDanglingIntroCards,
    markWatched,
    formatDate,
  } = useDownloads(false);

  // Collections data, lifted here so per-reel mutations can keep the member
  // lists honest (T3610 §0B.6).
  const collections = useCollections(isOpen);

  // Shared story player — one player for both single reels and collections
  // (T3610). { reels, title, downloadId?, intro }. Rendered at the panel top
  // level so it fills the viewport (the drawer's transform would otherwise
  // confine it). T6700: `intro` carries the resolved playback payload
  // ({card, previewUrl, field_values, profile} | null) fetched on the Play
  // gesture. T6710: IntroStoryPlayer (below) owns the intro-vs-reels region
  // itself as a single continuous timeline -- the old unmount/mount
  // introShowing SWAP is retired; intro=null passes straight through to a
  // bare CollectionPlayer-equivalent render (AC #5).
  const [storyPlayer, setStoryPlayer] = useState(null);
  const watchTimerRef = useRef(null);
  // Reels already marked watched in the current player session — avoids redundant
  // PATCH/recompute calls when the user navigates back and forth (T3900).
  const watchedThisSessionRef = useRef(new Set());

  // T6700: collection's OWN intro-playback query params, same scope-shape
  // mapping as collectionIntroKey (introBadgeKey.js) so params match what the
  // badge already resolves. `definition` is the {scope, filter, aspect_ratio}
  // shape CollectionCard already threads through onShare/onIntro.
  const collectionIntroPlaybackParams = ({ scope, filter, aspect_ratio }) => {
    const params = new URLSearchParams({ scope_type: scope.type, aspect_ratio });
    if (scope.type === 'game') params.set('game_id', scope.game_id);
    if (filter?.tags?.length) params.set('tags', filter.tags.join(','));
    return params.toString();
  };

  const onPlayCollection = async (reels, title, definition) => {
    watchedThisSessionRef.current.clear();
    let intro = null;
    if (definition) {
      try {
        const resp = await apiFetch(
          `${API_BASE}/api/collections/intro-playback?${collectionIntroPlaybackParams(definition)}`,
        );
        if (resp.ok) {
          const data = await resp.json();
          intro = data.intro ?? null;
        }
      } catch (err) {
        console.error('[DownloadsPanel] failed to fetch collection intro-playback:', err);
      }
    }
    setStoryPlayer({ reels, title, intro });
  };
  const closeStoryPlayer = useCallback(() => {
    clearTimeout(watchTimerRef.current);
    setStoryPlayer(null);
  }, []);

  // Single source of watched-marking for BOTH the single-reel and collection
  // playback paths: the player fires onReelChange when a reel becomes active
  // (on mount and on each advance). Mark it watched -> PATCH the DB ->
  // galleryStore recomputes the badge (T3900). Idempotent on the server, so the
  // session set is purely a redundant-call guard.
  const handleReelWatched = useCallback((_index, reel) => {
    if (!reel?.id || watchedThisSessionRef.current.has(reel.id)) return;
    watchedThisSessionRef.current.add(reel.id);
    markWatched(reel.id);
    collections.patchMember(reel.id, { watched_at: new Date().toISOString() });
  }, [markWatched, collections]);

  // State for before/after export
  const [exportingBeforeAfter, setExportingBeforeAfter] = useState(null);

  // T3940: one restore-then-navigate path shared by the My Reels card, the in-player
  // Re-edit button, and the ranker replay. Navigation = open the editor (T66 restore
  // resumes Framing) + close the gallery + tear down the story player if it's open.
  const navigateToProject = useCallback((projectId) => {
    onOpenProject?.(projectId);
    close();
    closeStoryPlayer();
  }, [onOpenProject, close, closeStoryPlayer]);
  const { openReelAsProject, restoringId } = useReEditReel(navigateToProject);

  // T4030: author re-ranks a reel while watching it. The tap is the only write
  // trigger (gesture-only): POST /api/rank/reopen re-opens the reel for ranking
  // (rd reset, match_count -> 0, rating untouched, twin-synced server-side) so it
  // re-enters the game and the Confidence banner % drops on next read.
  const [reRankingId, setReRankingId] = useState(null);
  const handleReRank = useCallback(async (reel) => {
    if (!reel?.id) return;
    setReRankingId(reel.id);
    try {
      const res = await apiFetch(`${API_BASE}/api/rank/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ final_video_id: reel.id }),
      });
      if (!res.ok) throw new Error(`reopen failed (${res.status})`);
      toast.success("We'll re-rank this one", {
        message: 'It re-enters the ranking game so its spot can move.',
      });
      setRankRefreshKey((k) => k + 1); // banner refetches the dropped %
    } catch {
      toast.error('Could not re-rank this reel');
    } finally {
      setReRankingId(null);
    }
  }, []);

  // State for share modal
  const [sharingDownload, setSharingDownload] = useState(null);

  // T3620: collection share modal ({ definition, title }) + one-tap copy link.
  const [sharingCollection, setSharingCollection] = useState(null);

  // T3630: ranking game (pairwise Glicko). Opened from the ConfidenceBanner.
  // On close we bump a key so the banner refetches and re-sort cached members
  // into the new rating order (read-only; the writes happened via the game).
  const [showRankingGame, setShowRankingGame] = useState(false);
  const [rankRefreshKey, setRankRefreshKey] = useState(0);
  const closeRankingGame = () => {
    setShowRankingGame(false);
    setRankRefreshKey((k) => k + 1);
    collections.resortMembers();
  };

  const onShareCollection = (definition, title) => setSharingCollection({ definition, title });

  // T5215 round 2: a collection's OWN attached intro (distinct from the SHARE
  // dialog's frozen-at-creation choice above). {definition, title} of the
  // collection currently open in the picker, or null. The definition's
  // {scope, filter.tags, aspect_ratio} IS the collection's identity for this
  // purpose -- GET/PATCH /api/collections/intro key off exactly those fields.
  const [introCollectionTarget, setIntroCollectionTarget] = useState(null);
  const [collectionIntroSelectedId, setCollectionIntroSelectedId] = useState(null);

  const collectionIntroParams = ({ scope, filter, aspect_ratio }) => {
    const params = new URLSearchParams({ scope_type: scope.type, aspect_ratio });
    if (scope.type === 'game') params.set('game_id', scope.game_id);
    if (filter?.tags?.length) params.set('tags', filter.tags.join(','));
    return params.toString();
  };

  const onIntroCollection = async (definition, title) => {
    setIntroCollectionTarget({ definition, title });
    setCollectionIntroSelectedId(null); // cleared while the resolve is in flight
    try {
      const resp = await apiFetch(`${API_BASE}/api/collections/intro?${collectionIntroParams(definition)}`);
      if (resp.ok) {
        const data = await resp.json();
        setCollectionIntroSelectedId(data.intro_card_id);
      }
    } catch (err) {
      console.error('[DownloadsPanel] failed to resolve collection intro:', err);
    }
  };

  const handleSetCollectionIntro = async (cardId) => {
    if (!introCollectionTarget) return;
    const params = collectionIntroParams(introCollectionTarget.definition);
    try {
      const resp = await apiFetch(`${API_BASE}/api/collections/intro?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intro_card_id: cardId }),
      });
      if (resp.ok) {
        setCollectionIntroSelectedId(cardId);
        // T5215 round 6: the media-slot badge (item 3) must appear
        // immediately, not only after the next batch fetch/reload --
        // resolve this ONE collection's fresh state (id -> name) and merge
        // it into the batch map in place.
        const key = collectionIntroKey(introCollectionTarget.definition);
        const getResp = await apiFetch(`${API_BASE}/api/collections/intro?${params}`);
        if (getResp.ok) {
          const fresh = await getResp.json();
          setIntroBadgesByKey((prev) => ({ ...prev, [key]: { key, ...fresh } }));
        }
      }
    } catch (err) {
      console.error('[DownloadsPanel] failed to set collection intro:', err);
    }
  };

  // T5215 round 6 item 3 (round 3 originally; round 5 deleted this as dead
  // code once its only consumer -- the title-row badge -- was removed; user,
  // 2026-08-07, asked for a DIFFERENT collection-badge surface, so the fetch
  // comes back to feed that). Batch-resolve every VISIBLE collection's OWN
  // intro badge in ONE request (mirrors the reel list's no-N+1 discipline)
  // -- fires whenever the collections summary changes (new/changed reels can
  // add or drop an eligible (scope, ratio) bucket). Read-only refetch, not a
  // write, so this is an ordinary data-loading effect, not the banned
  // reactive-persistence pattern (nothing here calls a PATCH).
  const [introBadgesByKey, setIntroBadgesByKey] = useState({});
  // T6950: also re-resolve on card delete — a deleted card that was attached to
  // a collection leaves a dangling collection_settings id, which the batch
  // endpoint resolves to no-intro; without this dep the badge kept naming the
  // deleted card until the summary next changed.
  const cardDeleteRevision = useIntroCardStore((state) => state.deleteRevision);
  useEffect(() => {
    const summary = collections.summary;
    const items = [];
    (summary?.smart_collections || []).forEach((sc) => {
      RATIO_ORDER.forEach((ratio) => {
        if (sc.ratio_eligible?.[ratio]) {
          items.push({ scope_type: 'all', tags: sc.tags || null, aspect_ratio: ratio });
        }
      });
    });
    (summary?.games || []).forEach((g) => {
      RATIO_ORDER.forEach((ratio) => {
        if (g.ratio_eligible?.[ratio]) {
          items.push({ scope_type: 'game', game_id: g.game_id, aspect_ratio: ratio });
        }
      });
    });
    if (summary?.mixes) {
      RATIO_ORDER.forEach((ratio) => {
        if (summary.mixes.ratio_eligible?.[ratio]) {
          items.push({ scope_type: 'mixes', aspect_ratio: ratio });
        }
      });
    }
    if (items.length === 0) { setIntroBadgesByKey({}); return; }

    let cancelled = false;
    (async () => {
      try {
        // GET (not POST): this is a pure read, no collection_settings row is
        // ever written here -- keeping it a GET is what lets this fetch live
        // in a plain data-loading effect without the reactive-persistence
        // lint rule (which flags non-GET verbs in effects as a likely
        // write-as-side-effect) misreading it as a banned pattern.
        const resp = await apiFetch(
          `${API_BASE}/api/collections/intro/batch?items=${encodeURIComponent(JSON.stringify(items))}`,
        );
        if (!resp.ok || cancelled) return;
        const { results } = await resp.json();
        const map = {};
        results.forEach((r) => { map[r.key] = r; });
        if (!cancelled) setIntroBadgesByKey(map);
      } catch (err) {
        console.error('[DownloadsPanel] failed to batch-resolve collection intro badges:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [collections.summary, cardDeleteRevision]);

  const onCopyCollectionLink = async (definition) => {
    try {
      const resp = await apiFetch(`${API_BASE}/api/collections/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition, recipient_emails: [], is_public: true }),
      });
      if (!resp.ok) throw new Error(`Failed (${resp.status})`);
      const data = await resp.json();
      const token = data.shares?.[0]?.share_token;
      if (!token) throw new Error('No link returned');
      const url = `${window.location.origin}/shared/collection/${token}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      toast.success('Public link copied', {
        message: 'Anyone with the link can watch these highlights.',
      });
    } catch {
      toast.error('Could not create link');
    }
  };

  // T4945: download the whole collection as ONE stitched MP4 (members in
  // playback order, the collection's own intro at the front, one branded outro
  // at the end). Gesture-only -- the CollectionCard owns the busy flag around
  // this await; failures surface as a toast (the card just un-busies).
  // T7050: forward the per-card onProgress callback so the CollectionCard that
  // fired this gesture can render an in-flight progress indicator. The busy
  // flag + progress state stay owned by that card (gesture-scoped); this panel
  // just wires the hook's byte updates back to it and surfaces failures.
  const onDownloadCollection = async (definition, onProgress) => {
    try {
      await downloadCollection(definition, { onProgress });
    } catch (err) {
      console.error('[DownloadsPanel] collection download failed:', err);
      toast.error('Could not download collection');
    }
  };

  // T4850/T5678: move a reel to a sibling profile (multi-athlete accounts). The
  // per-reel "Move to profile…" action is hidden unless the account has 2+
  // profiles (there is nowhere to move a reel otherwise). Batch select mode was
  // removed in T5678 — moves are one-reel-at-a-time from the card's kebab menu.
  const profiles = useProfileStore((state) => state.profiles);
  const currentProfileId = useProfileStore((state) => state.currentProfileId);
  const otherProfiles = profiles.filter((p) => p.id !== currentProfileId);
  const canMoveProfiles = profiles.length >= 2;

  // T5215: the current profile's intro-card library, for the reel picker.
  // Fetched when the panel opens (mirrors useCollections(isOpen)); the store
  // dedupes concurrent/repeat calls.
  const introCards = useIntroCardStore((state) => state.cards);
  const fetchIntroCards = useIntroCardStore((state) => state.fetchCards);
  useEffect(() => {
    if (isOpen) fetchIntroCards();
  }, [isOpen, fetchIntroCards]);

  // T6950: mirror the card-delete cascade into this panel's reel-list copies.
  // Deleting a card (library modal, a different tree) nulls
  // final_videos.intro_card_id server-side for every referencing reel; the
  // member caches here never refetch once 'ready', so they kept showing a
  // badge naming the deleted card until reload. Read-only LOCAL patch driven
  // by the store's deleteRevision (subscribed above, next to the badge
  // effect it also re-fires) — no network write fires here (the banned
  // pattern is effect→PATCH; this is effect→setState mirroring a completed
  // server write).
  const seenCardDeleteRevisionRef = useRef(cardDeleteRevision);
  const pruneMembersIntroCards = collections.pruneDanglingIntroCards;
  useEffect(() => {
    if (cardDeleteRevision === seenCardDeleteRevisionRef.current) return;
    seenCardDeleteRevisionRef.current = cardDeleteRevision;
    const liveCardIds = new Set(useIntroCardStore.getState().cards.map((c) => c.id));
    pruneDanglingIntroCards(liveCardIds);
    pruneMembersIntroCards(liveCardIds);
  }, [cardDeleteRevision, pruneDanglingIntroCards, pruneMembersIntroCards]);

  // T6320: the story player's active-segment playhead shows the active profile's
  // sport ball (closing the T5130 gap for My Reels). Same read ProfileSportButton
  // uses. Unknown/absent sport -> undefined -> CollectionPlayer renders no handle
  // at all, never a hardcoded fallback sport.
  const currentProfile = profiles.find((p) => p.id === currentProfileId);
  const storyPlayerHandleGlyph = currentProfile?.sport ? sportEmoji(currentProfile.sport) : undefined;

  // Ids currently targeted by the Move-to-profile modal (a single-reel list).
  const [movingIds, setMovingIds] = useState(null);

  // A stale in-flight move target is source-profile-scoped; drop it if the active
  // profile changes while the panel is mounted (resets local UI only — NOT a
  // reactive persistence write).
  useEffect(() => {
    setMovingIds(null);
  }, [currentProfileId]);

  // Success handler for a completed move: the reels left this profile, so drop
  // them from the cached member lists, refresh the summary + NEW badge, and close
  // the picker. Gesture-driven refresh only — no reactive persistence.
  const onReelsMoved = useCallback((movedIds) => {
    movedIds.forEach((id) => collections.removeMember(id));
    collections.fetchSummary();
    useGalleryStore.getState().fetchCount({ force: true });
    setMovingIds(null);
  }, [collections]);

  // T6350: a partial move (copied to the target, not yet removed here) must NOT
  // optimistically drop the reels — they still live in this profile until the
  // "Finish removing" action succeeds. Re-fetch so the view mirrors the server's
  // actual state, and clear the picker/spinner. Gesture-driven refresh only.
  const onReelsMovePartial = useCallback(() => {
    collections.fetchSummary();
    useGalleryStore.getState().fetchCount({ force: true });
    useGalleryStore.getState().notifyCollectionsChanged();
    setMovingIds(null);
  }, [collections]);

  const { moveReels, moving } = useMoveReels(onReelsMoved, onReelsMovePartial);

  // Native share support
  // T6300: isMobile is no longer threaded to ReelTile — the reveal gate moved to
  // useIsCoarsePointer() inside the tile, and Share/Copy Link are now both always
  // listed in its kebab (see ReelTile.jsx header comment). isMobile IS still read
  // here (webShareReel below) to decide whether the "Share" click should even
  // attempt navigator.share() — desktop skips straight to ShareModal instead.
  const { copyLink, webShare, isMobile } = useWebShare();

  if (!isOpen && !storyPlayer) return null;

  const handleDelete = async (e, download) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${download.filename}"?`)) {
      await deleteDownload(download.id, true);
      // Keep the collection member lists + aggregates honest (T3610 §0B.6):
      // drop the card now, refetch the summary (counts/eligibility change).
      collections.removeMember(download.id);
      collections.fetchSummary();
    }
  };

  // T7100: downloadFile now re-throws on failure (previously swallowed into an
  // unread `error` state -- downloads failed 100% silently). Surface it the
  // same way onDownloadCollection does.
  const handleDownload = async (e, download) => {
    e.stopPropagation();
    // Filename is controlled by backend's Content-Disposition header (single source of truth)
    try {
      await downloadFile(download.id);
    } catch (err) {
      console.error('[DownloadsPanel] reel download failed:', err);
      toast.error('Could not download reel');
    }
  };

  const handlePlay = async (e, download) => {
    e.stopPropagation();
    setWarmupPriority(WARMUP_PRIORITY.FOREGROUND_DIRECT);
    // Single reel = a one-reel story, played through the SAME player as collections.
    // Watched-marking happens via the player's onReelChange (handleReelWatched),
    // the single source for both the single-reel and collection paths (T3900).
    watchedThisSessionRef.current.clear();
    // T6700: resolve the reel's OWN intro-playback payload on the Play gesture
    // (a READ, never a useEffect). Fetch failure is non-fatal -- Play must never
    // hang or break on the intro fetch (design R3): treat any failure as
    // intro: null and play immediately.
    let intro = null;
    try {
      const resp = await apiFetch(`${API_BASE}/api/downloads/${download.id}/intro-playback`);
      if (resp.ok) {
        const data = await resp.json();
        intro = data.intro ?? null;
      }
    } catch (err) {
      console.error('[DownloadsPanel] failed to fetch intro-playback:', err);
    }
    setStoryPlayer({
      reels: [toPlayerReel(download)],
      title: download.project_name,
      downloadId: download.id,
      intro,
    });
    // Do NOT close the panel here: the player renders above it (Z.PLAYER vs the
    // panel's Z.MODAL, see constants/zLayers), and collection playback
    // (onPlayCollection) already leaves
    // My Reels open. Closing only on single-reel play made the panel vanish
    // "sometimes" — exiting the player dropped the user back to the app instead
    // of My Reels. Only the X button closes the panel now.
    // T540: Record achievements for viewing gallery video
    useQuestStore.getState().recordAchievement('viewed_gallery_video');
    // Custom project video gets a separate achievement for Quest 3
    if (download.source_type === SourceType.CUSTOM_PROJECT) {
      useQuestStore.getState().recordAchievement('viewed_custom_project_video');
    }
    // T780: Record "watched 1s" achievement after 1 second of playback (autoPlay = true)
    clearTimeout(watchTimerRef.current);
    watchTimerRef.current = setTimeout(() => {
      useQuestStore.getState().recordAchievement('watched_gallery_video_1s');
    }, 1000);
  };

  // Card folder button -> same shared restore-then-navigate path as the players (T3940).
  const handleOpenProject = (e, download) => {
    e.stopPropagation();
    if (onOpenProject) openReelAsProject(download);
  };

  // Check if folder button should be shown for a download
  const canOpenSource = (download) => {
    if (download.project_id && download.project_id !== 0 && onOpenProject) {
      return true;
    }
    return false;
  };

  const handleBeforeAfter = async (e, download) => {
    e.stopPropagation();
    setExportingBeforeAfter(download.id);

    try {
      // First check if before/after is available
      const statusRes = await apiFetch(`${API_BASE}/api/export/before-after/${download.id}/status`);
      const status = await statusRes.json();

      if (!status.available) {
        alert(status.error || 'Before/After comparison not available for this video');
        return;
      }

      // Generate separate before/after videos (no text overlays) as a zip
      const response = await apiFetch(`${API_BASE}/api/export/before-after/${download.id}?output=separate&overlays=false`, {
        method: 'POST'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to generate comparison video');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `before_after_${download.project_name || download.id}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error('[DownloadsPanel] Before/After export error:', error);
      alert(`Failed to generate comparison: ${error.message}`);
    } finally {
      setExportingBeforeAfter(null);
    }
  };

  // Find the latest unwatched download ID (first unwatched in created_at DESC order)
  const latestUnwatchedId = downloads.find(d => !d.watched_at)?.id ?? null;

  const getUnwatchedStyle = (downloadId) => {
    if (downloadId === latestUnwatchedId) {
      return { border: 'border-cyan-400', dot: 'unwatched-dot unwatched-dot-cyan' };
    }
    return { border: 'border-blue-500', dot: 'bg-blue-500' };
  };

  // Share via the native sheet (mobile). Desktop has no native share surface
  // worth attempting — even where navigator.share() technically exists, it's a
  // bare OS share sheet with no recipient/visibility controls — so it opens
  // ShareModal directly instead. Falls back to ShareModal on failure too.
  const webShareReel = async (e, download) => {
    e.stopPropagation();
    if (!isMobile) {
      setSharingDownload(download);
      return;
    }
    try {
      const filename = `${download.project_name || 'highlight'}-highlight.mp4`;
      const method = await webShare({
        downloadId: download.id,
        title: download.project_name || 'Highlight Reel',
        text: `Check out ${download.project_name || 'this highlight reel'}!`,
        filename,
      });
      track('share_initiated', { method, source: 'gallery' });
      if (method === 'clipboard') {
        toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setSharingDownload(download);
    }
  };

  // Copy a share link (desktop). Falls back to the ShareModal on failure.
  const copyReelLink = async (e, download) => {
    e.stopPropagation();
    try {
      await copyLink({ downloadId: download.id });
      track('share_initiated', { method: 'clipboard', source: 'gallery' });
      toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setSharingDownload(download);
    }
  };

  // Rename gesture -> surgical PATCH + keep the cached member list honest.
  const renameReel = (id, name) => {
    renameDownload(id, name);
    collections.patchMember(id, { project_name: name });
  };

  // T5215: reel intro-card picker gestures. Consent is a legal attestation
  // (ProfileIntroSection/ConsentGate show the full "publicly visible" copy
  // before recording it) -- this link only points the user there, it never
  // grants consent itself.
  //
  // Round 6: mirrors renameReel above -- setIntroCard only updates the flat
  // `downloads` array, but most reel tiles render from useCollections()'s
  // separate `members` cache (collapsed game/mix groups), which never saw
  // this write, so the badge stayed stale there until reload. Patch that
  // cache too once the server has resolved the real name.
  const handleSetIntro = async (download, cardId) => {
    const result = await setIntroCard(download.id, cardId);
    if (result.success) {
      collections.patchMember(download.id, {
        intro_card_id: result.intro_card_id,
        intro_card_name: result.intro_card_name,
      });
    }
  };
  const handleRequestIntroConsent = () => {
    toast.info('Open your profile menu -> Manage Profile -> Athlete Intro Card to give consent.');
  };

  // A compact metadata line for the tile scrim: date · duration · game-time.
  const reelMetaLine = (download) => [
    formatDate(download.created_at),
    formatDurationHuman(download.duration),
    formatGameClock(download.clip_game_start_time),
  ].filter(Boolean).join(' · ');

  // Render one published reel as a poster tile (T5673). Per-tile poster load
  // state lives in ReelTile (a component, not this closure).
  const renderDownloadCard = (download) => (
    <ReelTile
      key={download.id}
      download={download}
      posterUrl={`${API_BASE}/api/downloads/${download.id}/poster.jpg?profile_id=${currentProfileId}`}
      isUnwatched={!download.watched_at}
      unwatchedStyle={getUnwatchedStyle(download.id)}
      displayName={download.project_name}
      metaLine={reelMetaLine(download)}
      onPlay={handlePlay}
      onWebShare={webShareReel}
      onCopyLink={copyReelLink}
      onDownload={handleDownload}
      downloadingId={downloadingId}
      downloadProgress={downloadProgress}
      onBeforeAfter={handleBeforeAfter}
      exportingBeforeAfter={exportingBeforeAfter}
      showBeforeAfter={!import.meta.env.PROD}
      onOpenProject={handleOpenProject}
      canOpenSource={canOpenSource}
      restoringId={restoringId}
      onMove={(d) => setMovingIds([d.id])}
      canMoveProfiles={canMoveProfiles}
      onDelete={handleDelete}
      onRename={renameReel}
      seasonRank={download.season_rank}
      introCards={introCards}
      introProfile={currentProfile}
      introHasConsent={!!currentProfile?.introConsentAt}
      onSetIntro={handleSetIntro}
      onRequestIntroConsent={handleRequestIntroConsent}
    />
  );

  return (
    <>
      {isOpen && <>
      {/* Backdrop — visual only. No click-to-close (misclicks must not dismiss
          My Reels); the X button is the only way to close. */}
      <div className={`fixed inset-0 bg-black/50 ${Z.DROPDOWN}`} />

      {/* Panel — max-w-md (448px) below lg; widens at lg+ so poster-tile
          carousels/grids show more tiles per row (T5673). Slide-in transform is
          width-relative, so the open/close animation holds at every width. */}
      <div className={`fixed right-0 top-0 h-full w-full max-w-md lg:max-w-2xl xl:max-w-3xl bg-gray-800 shadow-xl ${Z.MODAL} flex flex-col border-l border-gray-700 animate-slide-in-right`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Image size={20} className={REEL.accent} />
            <h2 className="text-lg font-bold text-white">{SECTION_NAMES.LIBRARY}</h2>
            {unseenReelsCount > 0 && (
              <span className={`px-2 py-0.5 ${REEL.bg} text-white text-xs font-medium rounded-full`}>
                {unseenReelsCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              iconOnly
              onClick={close}
            />
          </div>
        </div>

        {/* Content — single My Reels view (T3610 §0B.1) */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* T8360: relocated assembly button (was ProjectManager's Clips-tab
              "Build Highlight Reel" button) + the Highlights (in-progress)
              section, both above the published Highlight Reels list -- moved,
              not rewritten (design doc Sec 4.2). */}
          <div className="mb-4">
            <Button
              variant="cyan"
              size="lg"
              icon={Plus}
              disabled={!hasClips}
              title={!hasClips ? 'Extract clips from a game first using Annotate mode' : undefined}
              onClick={onOpenAssembly}
              className="w-full"
            >
              Build Highlight Reel
            </Button>
          </div>

          <div className="mb-4">
            <div className="flex items-center gap-2 px-3 py-2 min-h-11">
              <span className="text-sm font-medium text-gray-200 flex-1">{SECTION_NAMES.HIGHLIGHTS}</span>
              <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full">
                {highlightDrafts.length}
              </span>
            </div>
            {highlightDrafts.length === 0 ? (
              <p className="px-3 text-sm text-gray-500">
                No highlights in progress. Tap Build Highlight Reel to assemble one.
              </p>
            ) : (
              <CardCarousel ariaLabel={`${SECTION_NAMES.HIGHLIGHTS} in progress`}>
                {highlightDrafts.map((project) => (
                  <DraftTile
                    key={project.id}
                    project={project}
                    onSelect={() => onSelectProject?.(project.id)}
                    onSelectWithMode={(options) => onSelectProjectWithMode?.(project.id, options)}
                    onDelete={() => onDeleteProject?.(project.id)}
                    exportingProject={exportingProject}
                    pendingGameIds={pendingGameIds}
                  />
                ))}
              </CardCarousel>
            )}
          </div>

          <ConfidenceBanner
            onRank={() => setShowRankingGame(true)}
            refreshKey={rankRefreshKey}
          />
          <CollectionsTab
            collections={collections}
            renderCard={renderDownloadCard}
            onPlayCollection={onPlayCollection}
            onShareCollection={onShareCollection}
            onCopyCollectionLink={onCopyCollectionLink}
            onIntroCollection={onIntroCollection}
            onDownloadCollection={onDownloadCollection}
            introBadgesByKey={introBadgesByKey}
            draftClipCount={draftClipCount}
            onViewDraftClips={() => {
              // Same gesture, two effects: leave the drawer, land on the Clips tab.
              close();
              onViewClips?.();
            }}
          />
        </div>
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.2s ease-out forwards;
        }
      `}</style>
      </>}

      {/* Share Modal */}
      {sharingDownload && (
        <ShareModal
          videoId={sharingDownload.id}
          videoName={sharingDownload.project_name}
          hasIntroPhoto={!!sharingDownload.resolved_intro_has_photo}
          onClose={() => setSharingDownload(null)}
        />
      )}

      {/* Collection Share Modal (T3620) */}
      {sharingCollection && (
        <CollectionShareModal
          definition={sharingCollection.definition}
          title={sharingCollection.title}
          onClose={() => setSharingCollection(null)}
        />
      )}

      {/* Collection's OWN intro picker (T5215 round 2) -- the SAME shared
          carousel/picker as the reel kebab, not a second component. */}
      <IntroCardPicker
        isOpen={!!introCollectionTarget}
        onClose={() => setIntroCollectionTarget(null)}
        title={introCollectionTarget ? `Intro for "${introCollectionTarget.title}"` : ''}
        cards={introCards}
        profile={currentProfile}
        selectedId={collectionIntroSelectedId}
        hasConsent={!!currentProfile?.introConsentAt}
        onSelect={handleSetCollectionIntro}
        onRequestConsent={handleRequestIntroConsent}
      />

      {/* Move-to-profile picker (T4850) */}
      {movingIds && (
        <MoveToProfileModal
          videoIds={movingIds}
          otherProfiles={otherProfiles}
          moving={moving}
          onMove={(targetProfileId) => moveReels(movingIds, targetProfileId)}
          onClose={() => { if (!moving) setMovingIds(null); }}
        />
      )}

      {/* Ranking game (T3630) — full-screen, opened from the ConfidenceBanner. */}
      {showRankingGame && (
        <RankingGame
          onClose={closeRankingGame}
          onReEdit={onOpenProject ? openReelAsProject : undefined}
        />
      )}

      {/* Shared story player — single reels AND collections play here, at the
          panel top level so it fills the viewport (T3610). T6710: ONE
          continuous composite timeline (IntroStoryPlayer) replaces the old
          IntroPreRoll/CollectionPlayer unmount/mount swap -- the composite
          owns the intro-vs-reels region itself and forwards auto-continue +
          cross-boundary scrub internally (design §4(iii)/§4(vi)). intro=null
          on the fetched payload behaves identically to a bare CollectionPlayer
          (AC #5). */}
      {storyPlayer && (
        <IntroStoryPlayer
          intro={storyPlayer.intro}
          aspect={storyPlayer.reels[0]?.aspect_ratio}
          reels={storyPlayer.reels}
          title={storyPlayer.title}
          onReelChange={handleReelWatched}
          onClose={closeStoryPlayer}
          onDownload={storyPlayer.downloadId ? () => downloadFile(storyPlayer.downloadId).catch((err) => {
            console.error('[DownloadsPanel] story-player download failed:', err);
            toast.error('Could not download reel');
          }) : undefined}
          downloadLoading={storyPlayer.downloadId ? downloadingId === storyPlayer.downloadId : false}
          onReEdit={onOpenProject ? openReelAsProject : undefined}
          reEditLoadingId={restoringId}
          onReRank={handleReRank}
          reRankLoadingId={reRankingId}
          handleGlyph={storyPlayerHandleGlyph}
        />
      )}
    </>
  );
}

export default DownloadsPanel;
