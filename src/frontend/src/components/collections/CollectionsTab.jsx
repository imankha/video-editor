import React, { useState } from 'react';
import { Loader, AlertCircle, FolderOpen } from 'lucide-react';
import { Button } from '../shared/Button';
import { REEL } from '../../config/themeColors';
import { RATIO_ORDER } from '../../constants/aspectRatios';
import { GameCollectionGroup } from './GameCollectionGroup';
import { GameAxisGroup } from './GameAxisGroup';
import { CollectionCard } from './CollectionCard';
import { SmartLockedCard } from './SmartLockedCard';
import { toPlayerReels } from './playerReels';
import { collectionIntroKey } from './introBadgeKey';

const MIXES_NAME = 'Mixes & compilations';

// Grouping axes for the game section (T5880). 'game' is the flat default; the
// derived axes ('tournament'/'month') come from server-computed
// summary.game_groups and are only offered when at least one such group exists.
const GROUP_BY = { GAME: 'game', TOURNAMENT: 'tournament', MONTH: 'month' };
const AXIS_LABEL = { game: 'By game', tournament: 'By tournament', month: 'By month' };

/**
 * CollectionsTab - the single My Reels view (T3610 §0B). Smart collections on
 * top, then game-by-game, then multi-game mixes. Aggregates come from the lifted
 * useCollections summary (passed in as `collections`); members load lazily.
 * Playback is delegated up to the panel so reels + collections share ONE player.
 *
 * @param {Object}   collections     - the lifted useCollections() value
 * @param {Function} renderCard      - (download) => ReactNode (the panel's reel card)
 * @param {Function} onPlayCollection - (reels[], title, definition?) => void (opens the shared player;
 *                                      definition is the {scope, filter, aspect_ratio} collection
 *                                      identity, used to fetch the collection's OWN intro, T6700)
 * @param {Function=} onShareCollection - (definition, title) => void (T3620)
 * @param {Function=} onCopyCollectionLink - (definition) => void (T3620)
 * @param {Function=} onIntroCollection - (definition, title) => void, the collection's OWN intro (T5215 round 2)
 * @param {Function=} onDownloadCollection - (definition) => Promise, download the stitched MP4 (T4945)
 * @param {Object=} introBadgesByKey - {key: {intro_card_id, intro_card_name}}, batch-resolved (T5215 round 6)
 */
export function CollectionsTab({
  collections,
  renderCard,
  onPlayCollection,
  onShareCollection,
  onCopyCollectionLink,
  onIntroCollection,
  onDownloadCollection,
  introBadgesByKey = {},
  // T8470 (Part C): the empty published-reels state must never claim "No reels
  // yet" while draft clips exist on the Clips tab. Count + navigate come from the
  // panel so this stays a pure view.
  draftClipCount = 0,
  onViewDraftClips,
}) {
  const { summary, summaryState, members, memberStates, fetchSummary, fetchMembers } = collections;

  // View-only grouping axis for the game section (T5880). Ephemeral toggle
  // state, not persisted -- switching it never writes anything.
  const [groupBy, setGroupBy] = useState(GROUP_BY.GAME);

  const onPlay = (items, title, definition) => {
    const reels = toPlayerReels(items);
    if (reels.length) onPlayCollection(reels, title, definition);
  };

  const reqGame = (id) => () => fetchMembers({ key: `game:${id}`, query: `game_id=${id}` });
  const reqMixes = () => fetchMembers({ key: 'mixes', query: 'mixes=true' });
  const reqSmart = (sc) => () => fetchMembers({
    key: `smart:${sc.key}`,
    query: sc.tags ? `tags=${sc.tags.join(',')}` : '', // top_plays -> full list
  });

  if (summaryState === 'idle' || summaryState === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader size={24} className={`${REEL.accent} animate-spin`} />
      </div>
    );
  }

  if (summaryState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle size={32} className="text-red-400 mb-3" />
        <p className="text-gray-400 mb-4">Failed to load reels</p>
        <Button variant="secondary" onClick={() => fetchSummary()}>Retry</Button>
      </div>
    );
  }

  const smart = summary?.smart_collections || [];
  const games = summary?.games || [];
  const gameGroups = summary?.game_groups || [];
  const mixes = summary?.mixes;
  const hasMixes = !!mixes && mixes.reel_count > 0;

  // A game group is nested from the SAME per-game buckets rendered flat, keyed
  // by id -- no duplicated aggregate data, just a different arrangement.
  const gamesById = new Map(games.map((g) => [g.game_id, g]));
  const renderGameGroup = (g) => {
    const key = `game:${g.game_id}`;
    return (
      <GameCollectionGroup
        key={key}
        name={g.game_name}
        collection={g}
        defaultExpanded={false}
        members={members[key]}
        memberState={memberStates[key]}
        requestMembers={reqGame(g.game_id)}
        onPlay={onPlay}
        renderCard={renderCard}
        shareScope={{ type: 'game', game_id: g.game_id }}
        onShare={onShareCollection}
        onCopyLink={onCopyCollectionLink}
        onIntro={onIntroCollection}
        onDownload={onDownloadCollection}
        introBadgesByKey={introBadgesByKey}
      />
    );
  };

  // Offer an axis toggle only for axes the server actually produced groups for
  // (absent metadata -> no group -> no toggle clutter). 'By game' is always
  // available; fall back to it if the active axis vanished (e.g. profile switch).
  const availableAxes = [
    GROUP_BY.GAME,
    ...(gameGroups.some((g) => g.axis === GROUP_BY.TOURNAMENT) ? [GROUP_BY.TOURNAMENT] : []),
    ...(gameGroups.some((g) => g.axis === GROUP_BY.MONTH) ? [GROUP_BY.MONTH] : []),
  ];
  const activeAxis = availableAxes.includes(groupBy) ? groupBy : GROUP_BY.GAME;

  if (smart.length === 0 && games.length === 0 && !hasMixes) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FolderOpen size={48} className="text-gray-600 mb-4" />
        <p className="text-gray-400">No reels yet</p>
        <p className="text-sm text-gray-500 mt-1">
          Publish reels to see them grouped by game here
        </p>
        {draftClipCount > 0 && (
          <button
            type="button"
            onClick={onViewDraftClips}
            className={`text-sm ${REEL.accent} hover:underline mt-3`}
          >
            You have {draftClipCount} draft clip{draftClipCount === 1 ? '' : 's'} in progress - find {draftClipCount === 1 ? 'it' : 'them'} on the Clips tab.
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Smart collections */}
      {smart.map((sc) => (
        <div key={`smart:${sc.key}`} className="mb-3">
          {RATIO_ORDER.map((ratio) => {
            if (sc.ratio_eligible?.[ratio]) {
              const definition = {
                scope: { type: 'all' },
                filter: sc.tags ? { tags: sc.tags } : {},
                aspect_ratio: ratio,
              };
              return (
                <CollectionCard
                  key={ratio}
                  title={sc.name}
                  ratio={ratio}
                  reelCount={sc.ratio_counts[ratio]}
                  ratioDuration={sc.ratio_durations[ratio]}
                  hasNullDurations={sc.has_null_durations}
                  requestMembers={reqSmart(sc)}
                  onPlay={onPlay}
                  shareDefinition={definition}
                  onShare={onShareCollection}
                  onCopyLink={onCopyCollectionLink}
                  onIntro={onIntroCollection}
                  onDownload={onDownloadCollection}
                  introBadge={introBadgesByKey[collectionIntroKey(definition)]}
                />
              );
            }
            // Per-tag collections (nudge_when_locked=false) stay hidden until
            // ready; only curated collections show the amber locked nudge card.
            if (sc.nudge_when_locked && (sc.ratio_counts?.[ratio] || 0) > 0) {
              return (
                <SmartLockedCard
                  key={ratio}
                  name={sc.name}
                  ratio={ratio}
                  currentSec={sc.ratio_durations?.[ratio]}
                />
              );
            }
            return null;
          })}
        </div>
      ))}

      {/* Grouping toggle (T5880): pick the derived axis for the game section.
          Only shown when the server produced a derivable axis, so a profile with
          no tournament/date metadata keeps the plain flat list. */}
      {games.length > 0 && availableAxes.length > 1 && (
        <div className="flex items-center gap-1 mb-3" role="group" aria-label="Group reels by">
          {availableAxes.map((axis) => (
            <button
              key={axis}
              type="button"
              onClick={() => setGroupBy(axis)}
              aria-pressed={activeAxis === axis}
              className={[
                'text-xs font-medium px-2.5 py-1 rounded-full transition-colors',
                activeAxis === axis
                  ? `${REEL.bg} text-white`
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700',
              ].join(' ')}
            >
              {AXIS_LABEL[axis]}
            </button>
          ))}
        </div>
      )}

      {/* Game by game. Every group starts collapsed: the panel unmounts on close,
          so a forced default-expand (previously the first game) re-expanded that
          same game on every reopen and silently discarded whatever the user had
          expanded. Collapsed-by-default is neutral; in-session expansions persist
          because playing a reel no longer closes the panel. */}
      {activeAxis === GROUP_BY.GAME && games.map((g) => renderGameGroup(g))}

      {/* Derived axis view: each server-computed group is a heading whose games
          nest beneath it (two-level shape). Games missing this axis's metadata
          fall through to a flat list below -- never a fabricated bucket. */}
      {activeAxis !== GROUP_BY.GAME && (() => {
        const axisGroups = gameGroups.filter((g) => g.axis === activeAxis);
        const grouped = new Set(axisGroups.flatMap((g) => g.game_ids));
        const ungrouped = games.filter((g) => !grouped.has(g.game_id));
        return (
          <>
            {axisGroups.map((grp) => (
              <GameAxisGroup
                key={grp.key}
                label={grp.label}
                count={grp.reel_count}
                newCount={grp.unwatched_count}
              >
                {grp.game_ids
                  .map((id) => gamesById.get(id))
                  .filter(Boolean)
                  .map((g) => renderGameGroup(g))}
              </GameAxisGroup>
            ))}
            {ungrouped.map((g) => renderGameGroup(g))}
          </>
        );
      })()}

      {/* Multi-game mixes */}
      {hasMixes && (
        <GameCollectionGroup
          key="mixes"
          name={MIXES_NAME}
          collection={mixes}
          defaultExpanded={games.length === 0}
          members={members.mixes}
          memberState={memberStates.mixes}
          requestMembers={reqMixes}
          onPlay={onPlay}
          renderCard={renderCard}
          shareScope={{ type: 'mixes' }}
          onShare={onShareCollection}
          onCopyLink={onCopyCollectionLink}
          onIntro={onIntroCollection}
          onDownload={onDownloadCollection}
          introBadgesByKey={introBadgesByKey}
        />
      )}
    </>
  );
}

export default CollectionsTab;
