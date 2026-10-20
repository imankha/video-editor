import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('../stores', () => {
  const state = { profiles: [{ id: 'p1', sport: 'soccer' }], currentProfileId: 'p1' };
  const useProfileStore = (sel) => sel(state);
  useProfileStore.getState = () => state;
  return { useProfileStore };
});
vi.mock('./instructions/GuideScope', () => ({ useGuidePulse: () => '' }));

import { GameTile } from './GameTile';

const FUTURE = new Date(Date.now() + 40 * 86400000).toISOString();

const baseGame = (over = {}) => ({
  id: 7,
  name: 'Eagles vs Hawks',
  status: 'ready',
  storage_status: 'active',
  storage_expires_at: FUTURE,
  clip_count: 5,
  reel_count: 0,
  plays_only: false,
  preservation_status: null,
  ...over,
});

function setup(game, extra = {}) {
  const handlers = {
    onLoad: vi.fn(),
    onDelete: vi.fn(),
    onExtend: vi.fn(),
    onPlayRecap: vi.fn(),
    onShare: vi.fn(),
    onEdit: vi.fn(),
    onAddVideo: vi.fn(),
    onKeepOnlyPlays: vi.fn(),
    onRestoreFullVideo: vi.fn(),
    ...extra,
  };
  render(<GameTile game={game} {...handlers} />);
  return handlers;
}

const openMenu = () => fireEvent.click(screen.getByLabelText('More actions'));

describe('T12930 Keep only marked plays: kebab row visibility', () => {
  it('shows the row for an owned, live game with plays', () => {
    setup(baseGame());
    openMenu();
    expect(screen.getByText('Keep only marked plays')).toBeTruthy();
  });

  it.each([
    ['expired', { storage_status: 'expired' }],
    ['upload failed', { status: 'upload_failed' }],
    ['no plays', { clip_count: 0 }],
    ['reference card', { source_profile_id: 'other' }],
    ['already plays-only', { plays_only: true }],
  ])('hides the row when %s', (_n, over) => {
    setup(baseGame(over));
    if (over.status === 'upload_failed') return; // failed uploads render no kebab at all
    openMenu();
    expect(screen.queryByText('Keep only marked plays')).toBeNull();
  });
});

describe('T12930 confirm sheet', () => {
  it('Cancel writes nothing and backdrop click does not close the sheet', () => {
    const h = setup(baseGame());
    openMenu();
    fireEvent.click(screen.getByText('Keep only marked plays'));
    expect(screen.getByText('Keep the marked plays only?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('plays-only-sheet-backdrop'));
    expect(screen.getByText('Keep the marked plays only?')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Keep the marked plays only?')).toBeNull();
    expect(h.onKeepOnlyPlays).not.toHaveBeenCalled();
  });

  it('confirm fires the keep handler once', () => {
    const h = setup(baseGame());
    openMenu();
    fireEvent.click(screen.getByText('Keep only marked plays'));
    fireEvent.click(screen.getByText('Keep plays only'));
    expect(h.onKeepOnlyPlays).toHaveBeenCalledTimes(1);
  });
});

describe('T12930 plays-only tile', () => {
  const po = (over = {}) => baseGame({ plays_only: true, preservation_status: 'complete', ...over });

  it('shows the Plays only chip, stays in color, and tap opens Watch plays', () => {
    setup(po());
    expect(screen.getByText('Plays only')).toBeTruthy();
    expect(document.querySelector('img').className).not.toContain('grayscale');
  });

  it('tap and Enter open Watch plays, never Annotate', () => {
    const h = setup(po());
    const tile = document.querySelector('[role="button"][tabindex="0"]');
    fireEvent.click(tile);
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(h.onPlayRecap).toHaveBeenCalledTimes(2);
    expect(h.onLoad).not.toHaveBeenCalled();
  });

  it('kebab: Watch plays, Share, Restore, Delete; no Add video / Extend / Keep only', () => {
    setup(po({ storage_expires_at: new Date(Date.now() + 3 * 86400000).toISOString() }));
    openMenu();
    expect(screen.getByText('Watch plays')).toBeTruthy();
    expect(screen.getByText('Share game')).toBeTruthy();
    expect(screen.getByText('Restore full video')).toBeTruthy();
    expect(screen.getByText('Delete game')).toBeTruthy();
    expect(screen.queryByText('Add video')).toBeNull();
    expect(screen.queryByText('Extend storage')).toBeNull();
    expect(screen.queryByText('Keep only marked plays')).toBeNull();
  });

  it('Restore is absent once storage has expired', () => {
    setup(po({ storage_status: 'expired' }));
    openMenu();
    expect(screen.queryByText('Restore full video')).toBeNull();
    expect(screen.getByText('Watch plays')).toBeTruthy();
  });

  it('Restore opens a confirm sheet and confirm fires the restore handler', () => {
    const h = setup(po());
    openMenu();
    fireEvent.click(screen.getByText('Restore full video'));
    expect(h.onRestoreFullVideo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Restore video'));
    expect(h.onRestoreFullVideo).toHaveBeenCalledTimes(1);
  });

  it('failed preservation shows the not-backed-up caption; pending shows nothing', () => {
    const { unmount } = render(<GameTile game={po({ preservation_status: 'failed' })} onLoad={vi.fn()} />);
    expect(screen.getByText('Plays not backed up yet')).toBeTruthy();
    unmount();
    render(<GameTile game={po({ preservation_status: 'pending' })} onLoad={vi.fn()} />);
    expect(screen.queryByText('Plays not backed up yet')).toBeNull();
  });
});

describe('T12940 expired plays-only tile keeps the color skin', () => {
  const expiredPo = (over = {}) => baseGame({
    plays_only: true, preservation_status: 'complete', storage_status: 'expired', can_extend: true, ...over,
  });

  it('is not grayscale/dimmed, has no yellow border, and no Expired chip', () => {
    setup(expiredPo());
    const img = document.querySelector('img');
    expect(img.className).not.toContain('grayscale');
    expect(img.className).not.toContain('opacity-60');
    expect(document.querySelector('[role="button"][tabindex="0"]').className).not.toContain('yellow');
    expect(screen.queryByText('Expired')).toBeNull();
  });

  it('tap opens Watch plays, never Extend', () => {
    const h = setup(expiredPo());
    fireEvent.click(document.querySelector('[role="button"][tabindex="0"]'));
    expect(h.onPlayRecap).toHaveBeenCalledTimes(1);
    expect(h.onExtend).not.toHaveBeenCalled();
  });

  it('kebab has no Extend row even while the grace window is open', () => {
    setup(expiredPo());
    openMenu();
    expect(screen.queryByText('Extend storage')).toBeNull();
  });
});
