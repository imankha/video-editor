import React, { useState } from 'react';
import { Loader, AlertCircle, FolderOpen } from 'lucide-react';
import { Button } from '../shared/Button';
import { REEL } from '../../config/themeColors';
import { API_BASE } from '../../config';
import { useCollections } from '../../hooks/useCollections';
import { GameCollectionGroup } from './GameCollectionGroup';
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
 * CollectionsTab - Screen for the Collections tab (T3610).
 *
 * Guards summary readiness, owns the single CollectionPlayer instance, and
 * renders one GameCollectionGroup per game plus the Mixes group. Aggregates come
 * from the summary endpoint; members load lazily per group on expand.
 *
 * @param {boolean}  isActive   - panel open AND this tab selected
 * @param {Function} renderCard - (download) => ReactNode (the panel's card)
 */
export function CollectionsTab({ isActive, renderCard }) {
  const { summary, summaryState, members, memberStates, fetchSummary, fetchMembers } =
    useCollections(isActive);
  const [player, setPlayer] = useState(null); // { reels, title }

  const playRatio = async (scope, ratio, title) => {
    const items = await fetchMembers(scope);
    const reels = toPlayerReels(items.filter((m) => m.aspect_ratio === ratio));
    if (reels.length) setPlayer({ reels, title });
  };

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
        <p className="text-gray-400 mb-4">Failed to load collections</p>
        <Button variant="secondary" onClick={() => fetchSummary()}>Retry</Button>
      </div>
    );
  }

  const games = summary?.games || [];
  const mixes = summary?.mixes;
  const hasMixes = !!mixes && mixes.reel_count > 0;

  if (games.length === 0 && !hasMixes) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FolderOpen size={48} className="text-gray-600 mb-4" />
        <p className="text-gray-400">No collections yet</p>
        <p className="text-sm text-gray-500 mt-1">
          Publish reels to see them grouped by game here
        </p>
      </div>
    );
  }

  return (
    <>
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
            onExpand={() => fetchMembers({ gameId: g.game_id })}
            onPlayRatio={(ratio, title) => playRatio({ gameId: g.game_id }, ratio, title)}
            renderCard={renderCard}
          />
        );
      })}

      {hasMixes && (
        <GameCollectionGroup
          key="mixes"
          name={MIXES_NAME}
          collection={mixes}
          defaultExpanded={games.length === 0}
          members={members.mixes}
          memberState={memberStates.mixes}
          onExpand={() => fetchMembers({ mixes: true })}
          onPlayRatio={(ratio, title) => playRatio({ mixes: true }, ratio, title)}
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
