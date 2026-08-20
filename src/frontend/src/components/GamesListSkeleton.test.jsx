import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GamesListSkeleton, GAMES_TILE_GRID_BY_COLUMNS } from './ProjectManager';

// T6310: the startup skeleton must mirror the loaded games poster grid (GameTile,
// T5681) so data arriving does not snap the layout. These tests pin the shared
// container/grid classes and the aspect-video shells against drift.
//
// T7330: the loaded grid's column count is now DERIVED from the groups, which do not
// exist yet at skeleton time. The skeleton uses the 2-COLUMN entry -- grid-cols-2 at
// every breakpoint, so 4 shells are two full rows everywhere and the geometry matches
// the loaded layout exactly for a small library (largest group <= 2), the shape the
// redesign targeted -- and takes it from the SAME exported map the real grid selects
// from, which is what keeps the drift guard honest.

const hasClasses = (el, ...classes) => {
  const set = new Set(el.className.split(/\s+/));
  return classes.every((c) => set.has(c));
};

describe('GamesListSkeleton (T6310)', () => {
  it('renders the shared container width, not the old max-w-2xl list', () => {
    const { getByTestId } = render(<GamesListSkeleton />);
    const root = getByTestId('games-skeleton');
    // Matches the loaded grid container (GAMES_GRID_CONTAINER_CLASS)
    expect(hasClasses(root, 'w-full', 'max-w-6xl', '2xl:max-w-7xl')).toBe(true);
    // The stale list width must be gone (this was the T6310 bug).
    expect(root.className).not.toContain('max-w-2xl');
  });

  it('lays shells out on the same responsive tile grid as the real list', () => {
    const { getByTestId } = render(<GamesListSkeleton />);
    const shellGrid = [...getByTestId('games-skeleton').querySelectorAll('.grid')]
      .find(el => el.querySelector('.aspect-video'));
    expect(shellGrid).toBeTruthy();
    // Uses the SHARED map rather than a private copy -- a class string spelled out here
    // would be exactly the drift T6310 was filed for.
    expect(shellGrid.className).toBe(GAMES_TILE_GRID_BY_COLUMNS[2]);
    expect(hasClasses(shellGrid, 'grid-cols-2', 'gap-2', 'sm:gap-3', 'lg:gap-4')).toBe(true);
    // No vertical list stack.
    expect(getByTestId('games-skeleton').querySelector('.space-y-2')).toBeNull();
  });

  it('mirrors the loaded rail-header group shape (T7330)', () => {
    const { getByTestId } = render(<GamesListSkeleton />);
    const root = getByTestId('games-skeleton');
    // The real list wraps each group in a lg-only rail grid; the skeleton must too, or
    // the tiles shift horizontally the moment data lands.
    expect(root.querySelector('.lg\\:grid-cols-\\[8rem_minmax\\(0\\,1fr\\)\\]')).toBeTruthy();
  });

  it('renders aspect-video shells (matching GameTile), not list rows', () => {
    const { getByTestId } = render(<GamesListSkeleton />);
    const shells = getByTestId('games-skeleton').querySelectorAll('.aspect-video');
    expect(shells.length).toBeGreaterThan(0);
    shells.forEach((shell) => {
      expect(hasClasses(shell, 'rounded-lg', 'animate-pulse')).toBe(true);
    });
  });

  it('defaults count to 4: two full 2-up rows at every breakpoint', () => {
    const { getByTestId } = render(<GamesListSkeleton />);
    const shells = getByTestId('games-skeleton').querySelectorAll('.aspect-video');
    // The 2-column grid holds at all widths, so 4 shells = exactly two full rows
    // everywhere -- no ragged partial row at any breakpoint.
    expect(shells.length).toBe(4);
  });

  it('honours an explicit count', () => {
    const { getByTestId } = render(<GamesListSkeleton count={3} />);
    expect(getByTestId('games-skeleton').querySelectorAll('.aspect-video').length).toBe(3);
  });
});
