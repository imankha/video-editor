import React, { useState } from 'react';
import { Loader, AlertCircle, FolderOpen } from 'lucide-react';
import { Button } from '../shared/Button';
import { REEL } from '../../config/themeColors';
import { API_BASE } from '../../config';
import { RATIO_ORDER, ratioLabel } from '../../constants/aspectRatios';
import { GameCollectionGroup } from './GameCollectionGroup';
import { CollectionCard } from './CollectionCard';
import { SmartLockedCard } from './SmartLockedCard';
import { CollectionPlayer } from './CollectionPlayer';

const MIXES_NAME = 'Mixes & compilations';

/** Map download items to presentational player reels. T3620 swaps in presigned
 *  URLs; here we use the same-origin stream proxy. */
function toPlayerReels(items) {
  return items.map((d) => ({
    id: d.id,
    name: d.project_name,
    streamUrl: `${API_BASE}/api/downloads/${d.id}/stream`,
    aspect_ratio: d.aspect_ratio,
    duration: d.duration, // may be null; player never relies on it
  }));
}

/**
 * CollectionsTab - the single My Reels view (T3610 §0B). Smart collections on
 * top, then game-by-game, then multi-game mixes. Aggregates come from the lifted
 * useCollections summary (passed in as `collections`); members load lazily.
 *
 * @param {Object}   collections - the lifted useCollections() value
 * @param {Function} renderCard  - (download) => ReactNode (the panel's reel card)
 */
export function CollectionsTab({ collections, renderCard }) {
  const { summary, summaryState, members, memberStates, fetchSummary, fetchMembers } = collections;
  const [player, setPlayer] = useState(null); // { reels, title }

  const onPlay = (items, title) => {
    const reels = toPlayerReels(items);
    if (reels.length) setPlayer({ reels, title });
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
  const mixes = summary?.mixes;
  const hasMixes = !!mixes && mixes.reel_count > 0;

  if (smart.length === 0 && games.length === 0 && !hasMixes) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FolderOpen size={48} className="text-gray-600 mb-4" />
        <p className="text-gray-400">No reels yet</p>
        <p className="text-sm text-gray-500 mt-1">
          Publish reels to see them grouped by game here
        </p>
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
              return (
                <CollectionCard
                  key={ratio}
                  name={`${sc.name} - ${ratioLabel(ratio)}`}
                  ratio={ratio}
                  reelCount={sc.ratio_counts[ratio]}
                  ratioDuration={sc.ratio_durations[ratio]}
                  hasNullDurations={sc.has_null_durations}
                  requestMembers={reqSmart(sc)}
                  onPlay={onPlay}
                />
              );
            }
            if ((sc.ratio_counts?.[ratio] || 0) > 0) {
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

      {/* Game by game */}
      {games.map((g, i) => {
        const key = `game:${g.game_id}`;
        return (
          <GameCollectionGroup
            key={key}
            name={g.game_name}
            subtitle={g.game_date || undefined}
            collection={g}
            defaultExpanded={i === 0}
            members={members[key]}
            memberState={memberStates[key]}
            requestMembers={reqGame(g.game_id)}
            onPlay={onPlay}
            renderCard={renderCard}
          />
        );
      })}

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
        />
      )}

      {player && (
        <CollectionPlayer
          reels={player.reels}
          title={player.title}
          onClose={() => setPlayer(null)}
        />
      )}
    </>
  );
}

export default CollectionsTab;
