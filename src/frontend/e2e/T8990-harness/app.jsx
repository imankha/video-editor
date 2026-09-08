// T8990 real-browser harness (NOT part of CI). Mounts the ACTUAL CardCarousel +
// the partial EmptyTabGuide filler with real fixed-width tiles, so the
// width-driven mount/unmount of the filler is proven by a real layout engine --
// the exact thing jsdom cannot measure (the T5380 / T8900 false-confidence
// landmine). No backend: this page makes no API calls.
//
// Config comes from the hash (`#tab=clips&tiles=3`) and is REACTIVE: a
// hashchange re-renders in place (a nested index.html drops the query string and
// a hash change alone never reloads the module, so state-from-hash is the only
// robust channel for a driver script).
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { CardCarousel } from '../../src/components/shared/CardCarousel';
import { EmptyTabGuide } from '../../src/components/shared/EmptyTabGuide';
import { GAMES_TILE_GRID_BY_COLUMNS } from '../../src/components/ProjectManager';

function useHashParams() {
  const [hash, setHash] = React.useState(location.hash);
  React.useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return new URLSearchParams(hash.replace(/^#/, ''));
}

// Landscape draft tile shape (DraftTile sm:w-[260px], aspect-video), the tighter
// of the two aspects -- if the copy fits here it fits the taller portrait row.
// Width via inline style: the app only ships `sm:w-[260px]`, so the bare
// `w-[260px]` utility is not in the Tailwind build for this standalone harness.
function Tile({ i }) {
  return (
    <div
      data-testid="tile"
      style={{ width: '260px' }}
      className="snap-start shrink-0 aspect-video bg-gray-700 rounded-lg flex items-center justify-center text-white text-sm"
    >
      Tile {i + 1}
    </div>
  );
}

function App() {
  const params = useHashParams();
  const tiles = parseInt(params.get('tiles') || '1', 10);
  const tab = params.get('tab') || 'clips';
  return (
    <div className="p-4 space-y-10">
      <section>
        <h2 className="text-white text-sm mb-2">
          Carousel filler ({tab}) with {tiles} tile(s)
        </h2>
        <div className="w-full max-w-6xl 2xl:max-w-7xl mx-auto">
          <CardCarousel
            ariaLabel="harness row"
            fillerSlot={<EmptyTabGuide tab={tab} variant="partial" className="h-full" />}
          >
            {Array.from({ length: tiles }).map((_, i) => (
              <Tile key={i} i={i} />
            ))}
          </CardCarousel>
        </div>
      </section>

      <section>
        <h2 className="text-white text-sm mb-2">Games lone-game cell (1 game, 2-col grid)</h2>
        <div className="w-full max-w-6xl 2xl:max-w-7xl mx-auto">
          <div className={GAMES_TILE_GRID_BY_COLUMNS[2]}>
            <div data-testid="game-tile" className="aspect-video bg-gray-700 rounded-lg" />
            <EmptyTabGuide
              tab="games"
              variant="partial"
              className="aspect-video self-stretch"
              onAction={() => {}}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
