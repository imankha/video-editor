/**
 * T5679 — Top Play rank badge threshold logic.
 *
 * The badge shows a reel's season rank on its My Reels tile, but ONLY for the top
 * 20; deeper ranks and unranked reels must show nothing (a "#47" badge is noise,
 * not a celebration). This test pins the threshold + the a11y contract, which the
 * original T5679 work shipped without.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReelTile } from './ReelTile';

const baseProps = {
  download: { id: 1, filename: 'reel.mp4' },
  posterUrl: '/api/downloads/1/poster.jpg',
  displayName: 'Brilliant Dribble',
  metaLine: '9:16 - 1 clip',
  unwatchedStyle: { dot: 'bg-cyan-400' },
  onPlay: vi.fn(),
};

const renderTile = (seasonRank) =>
  render(<ReelTile {...baseProps} seasonRank={seasonRank} />);

// The badge renders its rank as "#N" and carries the season aria-label.
const badge = (rank) => screen.queryByLabelText(`Ranked #${rank} of your reels this season`);

describe('T5679 Top Play rank badge threshold', () => {
  it('shows the exact rank for the top reel (#1)', () => {
    renderTile(1);
    expect(badge(1)).toBeTruthy();
    expect(screen.getByText('#1')).toBeTruthy();
  });

  it('shows the badge at the inclusive boundary (#20)', () => {
    renderTile(20);
    expect(badge(20)).toBeTruthy();
    expect(screen.getByText('#20')).toBeTruthy();
  });

  it('hides the badge just past the boundary (#21)', () => {
    renderTile(21);
    expect(badge(21)).toBeNull();
    expect(screen.queryByText('#21')).toBeNull();
  });

  it('hides the badge for a deep rank (#47)', () => {
    renderTile(47);
    expect(screen.queryByText('#47')).toBeNull();
  });

  it('hides the badge when the reel is unranked (undefined)', () => {
    renderTile(undefined);
    expect(screen.queryByText(/^#\d+$/)).toBeNull();
  });

  it('hides the badge when seasonRank is null', () => {
    renderTile(null);
    expect(screen.queryByText(/^#\d+$/)).toBeNull();
  });

  it('does not render a "#0" badge for a falsy zero rank', () => {
    // Ranks are 1-based; 0 is not a real rank and must not render as "#0".
    renderTile(0);
    expect(screen.queryByText('#0')).toBeNull();
  });

  it('exposes the rank to assistive tech via title + aria-label', () => {
    renderTile(3);
    const el = badge(3);
    expect(el).toBeTruthy();
    expect(el.getAttribute('title')).toBe('Ranked #3 of your reels this season');
  });
});
