// T11760 real-browser harness (NOT part of CI). Renders the games poster grid with a REAL
// layout engine + real Tailwind so the geometry jsdom cannot measure (no horizontal overflow,
// a 2-line opponent-name wrap, two 1-game months packing side by side at sm, and a skeleton
// whose columns match the loaded grid) can be proven at each target width.
//
// FIDELITY: this LoadedGrid is a CLOSE reimplementation of ProjectManager's games-grid block,
// built from the SAME exported functions and class maps it renders (groupGamesForTab /
// gamesGridColumns / gamesPackColumns / gamesGroupSpan + GRID_COLS / COL_SPAN / GAMES_TILE_COLS_SM
// / GAMES_TILE_COLS_LG / GAMES_GROUP_SECTION_CLASS) and the real GameTile + the real exported
// GamesListSkeleton -- so the class strings match what ships. It is not the literal component
// (it omits the kebab-menu/upload/guide branches), so treat it as representative, not identical;
// the jsdom galleryGuard test is what pins that the LIVE ProjectManager emits these same classes.
// No backend: poster fetches 404 -> GameTile's branded fallback, which is fine here. Output
// (screenshots + result.json) is written only inside the container, under /workspace/qa/T11760.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { GameTile } from '../../src/components/GameTile';
import {
  GamesListSkeleton,
  groupGamesForTab,
  gamesGridColumns,
  gamesPackColumns,
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

// A busy month (4 games) -> density N = 4. This is the case the reviewer flagged: at the sm
// band (640-767) a naive sm:grid-cols-4 shrinks a tile to ~143x80px, smaller than its own
// scrim, and the title-row pencil overlaps the top-right kebab. One June 1-game month rides
// along so the N=4 packing (a full July row + a half-width June) is exercised too. Games
// carry a ~40-char opponent name so the 2-line scrim height is realistic.
const GAMES_N4 = [
  { id: 41, name: 'vs Thunderbolts Academy Showcase A', game_date: '2026-07-26', created_at: '2026-07-26 18:00:00', clip_count: 4, reel_count: 0 },
  { id: 42, name: 'at Coastal Rangers Invitational B', game_date: '2026-07-19', created_at: '2026-07-19 18:00:00', clip_count: 6, reel_count: 1 },
  { id: 43, name: 'vs Harbor United Weekend Cup C', game_date: '2026-07-12', created_at: '2026-07-12 18:00:00', clip_count: 3, reel_count: 0 },
  { id: 44, name: 'at Summit FC Regional Qualifier D', game_date: '2026-07-05', created_at: '2026-07-05 18:00:00', clip_count: 2, reel_count: 0 },
  { id: 45, name: 'vs Lakeside Galaxy June Friendly', game_date: '2026-06-14', created_at: '2026-06-14 18:00:00', clip_count: 5, reel_count: 0 },
];

function LoadedGrid({ games }) {
  const gameGroups = groupGamesForTab(games);
  const columns = gamesGridColumns(gameGroups);
  const packColumns = gamesPackColumns(columns);
  return (
    <div className={GAMES_GRID_CONTAINER_CLASS}>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">Your Games</h2>
      <div className={`grid grid-cols-1 gap-y-6 sm:gap-x-3 ${GRID_COLS[packColumns]} lg:block lg:space-y-8`}>
        {gameGroups.map((group) => {
          const span = gamesGroupSpan(group.games.length, packColumns);
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
        <section data-qa-state="loaded-n4">
          <p className="text-xs text-gray-500 mb-2">LOADED (busy month, N=4)</p>
          <LoadedGrid games={GAMES_N4} />
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
