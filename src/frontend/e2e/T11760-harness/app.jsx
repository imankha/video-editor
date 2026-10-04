// T11760 real-browser harness (NOT part of CI). Renders the games poster grid with a REAL
// layout engine + real Tailwind so the geometry jsdom cannot measure (no horizontal overflow,
// a 2-line opponent-name wrap, two 1-game months packing side by side at sm, and a skeleton
// whose columns match the loaded grid) can be proven at each target width.
//
// FIDELITY: the loaded grid is composed from the SAME exported functions and class maps the
// real ProjectManager renders (groupGamesForTab / gamesGridColumns / gamesGroupSpan + GRID_COLS
// / COL_SPAN / GAMES_TILE_COLS_SM / GAMES_TILE_COLS_LG / GAMES_GROUP_SECTION_CLASS), and uses the
// real GameTile and the real exported GamesListSkeleton. The jsdom galleryGuard test pins that
// the live ProjectManager emits these exact classes, so this harness cannot drift from what
// ships. No backend: poster fetches 404 -> GameTile's branded fallback, which is fine here.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { GameTile } from '../../src/components/GameTile';
import {
  GamesListSkeleton,
  groupGamesForTab,
  gamesGridColumns,
  gamesGroupSpan,
  GAMES_GRID_CONTAINER_CLASS,
  GAMES_GROUP_SECTION_CLASS,
  GAMES_GROUP_HEADER_CLASS,
  GRID_COLS,
  COL_SPAN,
  GAMES_TILE_COLS_SM,
  GAMES_TILE_COLS_LG,
} from '../../src/components/ProjectManager';

const noop = () => {};

// A small library shaped to exercise every acceptance criterion:
//   - October 2026 (1 game)   \ two CONSECUTIVE 1-game months -> they must pack side by
//   - September 2026 (1 game)  / side in one row at sm (acceptance #2); the September tile
//                                carries a ~48-char opponent name that wraps to two lines on
//                                a phone tile (acceptance #1, no ellipsis clip).
//   - August 2026 (2 games)     a full month -> spans the whole 2-col row.
// Largest group = 2 -> density N = 2, so phones are 1-up and sm is 2-up.
const GAMES = [
  { id: 1, name: 'Game uploaded Oct 4', game_date: '2026-10-04', created_at: '2026-10-04 18:00:00', clip_count: 3, reel_count: 0 },
  { id: 2, name: 'at Oceanside Breakers Pacific Surf Cup Semifinal', game_date: '2026-09-20', created_at: '2026-09-20 18:00:00', clip_count: 5, reel_count: 1 },
  { id: 3, name: 'vs Riptide', game_date: '2026-08-30', created_at: '2026-08-30 18:00:00', clip_count: 2, reel_count: 0 },
  { id: 4, name: 'at Harbor FC', game_date: '2026-08-16', created_at: '2026-08-16 18:00:00', clip_count: 4, reel_count: 0 },
];

function LoadedGrid({ games }) {
  const gameGroups = groupGamesForTab(games);
  const columns = gamesGridColumns(gameGroups);
  return (
    <div className={GAMES_GRID_CONTAINER_CLASS}>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Your Games</h2>
      <div className={`grid grid-cols-1 gap-y-6 sm:gap-x-3 ${GRID_COLS[columns]} lg:block lg:space-y-8`}>
        {gameGroups.map((group) => {
          const span = gamesGroupSpan(group.games.length, columns);
          return (
            <section key={group.key} data-group-kind={group.kind} className={`${COL_SPAN[span]} ${GAMES_GROUP_SECTION_CLASS}`}>
              <header className={GAMES_GROUP_HEADER_CLASS}>
                <h3 className="text-base lg:text-[15px] font-semibold text-gray-300 leading-snug break-words">
                  <span>{group.label}</span>
                </h3>
                <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full lg:inline-block lg:mt-1.5">
                  {group.games.length} game{group.games.length !== 1 ? 's' : ''}
                </span>
              </header>
              <div className={`grid grid-cols-1 gap-2 sm:gap-3 lg:gap-4 ${GAMES_TILE_COLS_SM[span]} ${GAMES_TILE_COLS_LG[columns]}`}>
                {group.games.map((game) => (
                  <div key={game.id} data-qa-game={game.id}>
                    <GameTile
                      game={game}
                      onLoad={noop}
                      onDelete={noop}
                      onExtend={noop}
                      onPlayRecap={noop}
                      onShare={noop}
                      onEdit={noop}
                      onAddVideo={noop}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function App() {
  return (
    <div className="min-h-screen bg-gray-900 px-3 py-4 sm:px-4 sm:py-8">
      <div className="mx-auto">
        <section data-qa-state="loaded">
          <p className="text-xs text-gray-500 mb-2">LOADED</p>
          <LoadedGrid games={GAMES} />
        </section>
        <div className="h-10" />
        <section data-qa-state="skeleton">
          <p className="text-xs text-gray-500 mb-2">SKELETON</p>
          <GamesListSkeleton />
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
