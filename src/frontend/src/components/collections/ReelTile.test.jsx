import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom lacks matchMedia. ReelTile's kebab visibility runs through the REAL
// useIsCoarsePointer hook (mirrors DraftTile.test.jsx's T5910 pattern) — stub
// matchMedia and let each test flip the pointer type, so this exercises the
// actual capability decision instead of mocking the hook away.
let coarsePointer = false;
beforeEach(() => {
  coarsePointer = false;
  window.matchMedia = (query) => ({
    matches: query.includes('pointer: coarse') ? coarsePointer : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

import { ReelTile } from './ReelTile';

const baseProps = () => ({
  download: { id: 1, filename: 'reel.mp4', project_name: 'Brilliant Dribble', aspect_ratio: '9:16' },
  posterUrl: '/api/downloads/1/poster.jpg',
  displayName: 'Brilliant Dribble',
  metaLine: '9:16 - 1 clip',
  unwatchedStyle: { dot: 'bg-cyan-400', border: 'border-cyan-400' },
  onPlay: vi.fn(),
  onWebShare: vi.fn(),
  onCopyLink: vi.fn(),
  onDownload: vi.fn(),
  onBeforeAfter: vi.fn(),
  showBeforeAfter: false,
  onOpenProject: vi.fn(),
  canOpenSource: () => false,
  onMove: vi.fn(),
  canMoveProfiles: false,
  onDelete: vi.fn(),
  onRename: vi.fn(),
});

const renderTile = (overrides = {}) => render(<ReelTile {...baseProps()} {...overrides} />);
const kebabBtn = () => screen.getByRole('button', { name: 'More actions' });
const playBtn = () => screen.getByRole('button', { name: 'Play video' });

describe('T6300 ReelTile persistent actions', () => {
  it('Play is ALWAYS visible (no opacity gate) regardless of pointer type', () => {
    coarsePointer = false;
    renderTile();
    expect(playBtn().className).not.toMatch(/opacity-0/);
  });

  it('FINE pointer: the kebab is hover/focus-revealed, not persistently visible', () => {
    coarsePointer = false;
    renderTile();
    const kebab = kebabBtn();
    expect(kebab.className).toMatch(/opacity-0/);
    expect(kebab.className).toMatch(/group-hover\/tile:opacity-100/);
    expect(kebab.className).toMatch(/focus:opacity-100/);
  });

  it('COARSE pointer: the kebab is persistently opacity-100 (fixes the touch-Windows dead end)', () => {
    coarsePointer = true;
    renderTile();
    const kebab = kebabBtn();
    expect(kebab.className).toMatch(/opacity-100/);
    expect(kebab.className).not.toMatch(/group-hover\/tile/);
  });

  it('COARSE pointer: no long-press is required — a plain click opens the menu with every item reachable', () => {
    coarsePointer = true;
    renderTile({ canOpenSource: () => true, canMoveProfiles: true, showBeforeAfter: true });
    fireEvent.click(kebabBtn());
    // Bottom sheet renders on coarse pointers. Scoped to the menu itself
    // (T8540: `getByText('Share')` alone is now ambiguous -- the card face
    // ALSO carries a persistent Share button beside Play).
    const menu = within(screen.getByTestId('reel-tile-menu'));
    expect(menu.getByText('Download')).toBeTruthy();
    expect(menu.getByText('Share')).toBeTruthy();
    expect(menu.getByText('Copy Link')).toBeTruthy();
    // T6890: Rename is no longer a kebab item — it moved to the pencil by the name.
    expect(screen.queryByText('Rename')).toBeNull();
    expect(screen.getByText('Before / After')).toBeTruthy();
    expect(screen.getByText('Open as Draft')).toBeTruthy();
    expect(screen.getByText('Move to profile…')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('FINE pointer: clicking the kebab opens the desktop popover with Share + Copy Link', () => {
    coarsePointer = false;
    renderTile();
    fireEvent.click(kebabBtn());
    // T8540: scoped to the popover -- the card face also has its own Share button.
    const menu = within(screen.getByTestId('reel-tile-menu'));
    expect(menu.getByText('Share')).toBeTruthy();
    expect(menu.getByText('Copy Link')).toBeTruthy();
  });

  it('every action handler still fires from the kebab (coarse sheet)', () => {
    coarsePointer = true;
    const onDownload = vi.fn();
    const onWebShare = vi.fn();
    const onCopyLink = vi.fn();
    const onDelete = vi.fn();
    renderTile({ onDownload, onWebShare, onCopyLink, onDelete });
    fireEvent.click(kebabBtn());
    // T8540: scoped to the sheet -- the card face's own Share button also
    // wires onWebShare, so an unscoped query would be ambiguous.
    fireEvent.click(within(screen.getByTestId('reel-tile-menu')).getByText('Download'));
    expect(onDownload).toHaveBeenCalledTimes(1);
    fireEvent.click(kebabBtn());
    fireEvent.click(within(screen.getByTestId('reel-tile-menu')).getByText('Share'));
    expect(onWebShare).toHaveBeenCalledTimes(1);
    fireEvent.click(kebabBtn());
    fireEvent.click(within(screen.getByTestId('reel-tile-menu')).getByText('Copy Link'));
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    fireEvent.click(kebabBtn());
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('Play still fires onPlay when clicked', () => {
    const onPlay = vi.fn();
    renderTile({ onPlay });
    fireEvent.click(playBtn());
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  describe('T8540 card-face Share', () => {
    const shareBtn = () => screen.getByTestId('reel-card-share');

    it('is visible on the card face on a FINE pointer, no kebab needed', () => {
      coarsePointer = false;
      renderTile();
      expect(shareBtn()).toBeTruthy();
      expect(shareBtn().className).not.toMatch(/opacity-0/);
    });

    it('is visible on the card face on a COARSE pointer, no kebab needed', () => {
      coarsePointer = true;
      renderTile();
      expect(shareBtn()).toBeTruthy();
      expect(shareBtn().className).not.toMatch(/opacity-0/);
    });

    it('fires the same onWebShare handler the kebab Share item uses', () => {
      const onWebShare = vi.fn();
      renderTile({ onWebShare });
      fireEvent.click(shareBtn());
      expect(onWebShare).toHaveBeenCalledTimes(1);
    });

    it('hides while renaming (matches Play)', () => {
      renderTile();
      fireEvent.click(screen.getByRole('button', { name: 'Rename reel' }));
      expect(screen.queryByTestId('reel-card-share')).toBeNull();
    });
  });

  it('the NEW dot shifts right (right-11) to clear the persistent kebab corner', () => {
    const { container } = renderTile({ isUnwatched: true });
    const dot = container.querySelector('[title="New"]');
    expect(dot).toBeTruthy();
    expect(dot.className).toMatch(/right-11/);
    expect(dot.className).not.toMatch(/right-1\.5/);
  });

  it('no NEW dot when the reel is watched', () => {
    const { container } = renderTile({ isUnwatched: false });
    expect(container.querySelector('[title="New"]')).toBeNull();
  });

  it('T6890: the rename pencil sits beside the name and starts an inline rename', () => {
    renderTile();
    // Discoverable at rest (no kebab open needed) — the pencil is next to the name.
    const renameBtn = screen.getByRole('button', { name: 'Rename reel' });
    expect(renameBtn).toBeTruthy();
    fireEvent.click(renameBtn);
    // Inline rename input appears, seeded with the current name.
    expect(screen.getByDisplayValue('Brilliant Dribble')).toBeTruthy();
  });

  it('Play hides while renaming (matches DraftTile precedent)', () => {
    renderTile({ canOpenSource: () => false });
    // T6890: rename now starts from the pencil beside the name, not the kebab.
    fireEvent.click(screen.getByRole('button', { name: 'Rename reel' }));
    expect(screen.queryByRole('button', { name: 'Play video' })).toBeNull();
  });

  it('does not render the old hover-cluster wrapper or long-press touch handlers', () => {
    const { container } = renderTile();
    const card = screen.getByTestId('reel-card');
    // No onTouchStart-driven long-press affordance remains on the tile root.
    expect(card.ontouchstart).toBeFalsy();
    // The Play button no longer sits inside a shared opacity-gated action row.
    expect(container.querySelector('.group-hover\\/tile\\:opacity-100')?.contains(playBtn())).toBeFalsy();
  });
});
