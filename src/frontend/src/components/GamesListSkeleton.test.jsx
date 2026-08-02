import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GamesListSkeleton } from './ProjectManager';

// T6310: the startup skeleton must mirror the loaded games poster grid (GameTile,
// T5681) so data arriving does not snap the layout. These tests pin the shared
// container/grid classes and the aspect-video shells against drift.

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
    const grid = getByTestId('games-skeleton').querySelector('.grid');
    expect(grid).toBeTruthy();
    // Matches the loaded grid (GAMES_TILE_GRID_CLASS): 2-up mobile, 3-up tablet, 6-up desktop.
    expect(
      hasClasses(grid, 'grid-cols-2', 'sm:grid-cols-3', 'lg:grid-cols-6', 'gap-2', 'sm:gap-3', 'lg:gap-4'),
    ).toBe(true);
    // No vertical list stack.
    expect(getByTestId('games-skeleton').querySelector('.space-y-2')).toBeNull();
  });

  it('renders aspect-video shells (matching GameTile), not list rows', () => {
    const { getByTestId } = render(<GamesListSkeleton />);
    const shells = getByTestId('games-skeleton').querySelectorAll('.aspect-video');
    expect(shells.length).toBeGreaterThan(0);
    shells.forEach((shell) => {
      expect(hasClasses(shell, 'rounded-lg', 'animate-pulse')).toBe(true);
    });
  });

  it('defaults count to 6 so every breakpoint (2/3/6-up) fills full rows', () => {
    const { getByTestId } = render(<GamesListSkeleton />);
    const shells = getByTestId('games-skeleton').querySelectorAll('.aspect-video');
    // 6 is divisible by 2, 3 and 6 -> no ragged partial row at any breakpoint.
    expect(shells.length).toBe(6);
  });

  it('honours an explicit count', () => {
    const { getByTestId } = render(<GamesListSkeleton count={3} />);
    expect(getByTestId('games-skeleton').querySelectorAll('.aspect-video').length).toBe(3);
  });
});
