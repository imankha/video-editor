import React from 'react';
import { CollapsibleGroup } from '../shared/CollapsibleGroup';

/**
 * GameAxisGroup - one derived tournament/month heading with its games nested
 * beneath (T5880).
 *
 * The two-level shape the user asked for ("a playlist for a tournament ...
 * then sub-categorized by specific games"): the derived axis (tournament name /
 * "July 2026") is the outer CollapsibleGroup; the games are the inner
 * GameCollectionGroups (each itself collapsible -> game -> reels). Grouping is
 * server-computed (summary.game_groups); this component only renders it.
 *
 * Members load lazily: the outer group starts collapsed and reveals the (still
 * collapsed) inner game groups on expand, so nothing is fetched until a game is
 * opened. `children` are the already-wired GameCollectionGroup elements.
 *
 * @param {string} label     - group heading (tournament name / "July 2026")
 * @param {number} count     - aggregate reel count across the group's games
 * @param {number} newCount  - aggregate unwatched count across the group's games
 * @param {React.ReactNode} children - the nested GameCollectionGroup elements
 */
export function GameAxisGroup({ label, count, newCount, children }) {
  return (
    <CollapsibleGroup title={label} count={count} newCount={newCount} defaultExpanded={false}>
      {children}
    </CollapsibleGroup>
  );
}

export default GameAxisGroup;
