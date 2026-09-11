import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmptyTabGuide } from './EmptyTabGuide';
import { EMPTY_TAB_GUIDE, PARTIAL_TAB_GUIDE } from '../../config/emptyStates';

// T8980/T9390: the shared empty state rendered by all four home tabs. Copy is
// APPROVED and binding; these tests assert the exact copy + the count-driven
// branching + the flow strip. (jsdom applies no CSS, so the sm+ strip renders in
// the DOM regardless of breakpoint; T9390 dropped the sub-sm dot row entirely, so
// only the one sm+ strip node exists now.)

describe('EmptyTabGuide flow strip (T9530/N46: unnumbered peer destinations + optional Reels pill)', () => {
  it('renders Games/Clips/Reels/Published as peers with NO step numbers', () => {
    render(<EmptyTabGuide tab="games" gamesCount={0} onAddGame={vi.fn()} onNavigate={vi.fn()} />);

    // All four destinations appear as peer labels...
    expect(screen.getByText('Games')).toBeTruthy();
    expect(screen.getByText('Clips')).toBeTruthy();
    expect(screen.getByText('Reels')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();

    // ...and NONE of them carries a step number (N46: the numbered 1-2-3 nodes
    // read as a mandatory pipeline and were removed).
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.queryByText('2')).toBeNull();
    expect(screen.queryByText('3')).toBeNull();
    expect(screen.queryByText('4')).toBeNull();

    // The Reels detour keeps its dashed "optional" pill.
    expect(screen.getByText(/optional/i)).toBeTruthy();
  });

  it('lights the current destination in its own tab color, others muted (Games -> green)', () => {
    render(<EmptyTabGuide tab="games" gamesCount={0} onAddGame={vi.fn()} onNavigate={vi.fn()} />);
    const games = screen.getByText('Games');
    expect(games.className.includes('bg-green-600')).toBe(true);
    // An inactive peer is muted text, never lit in its color.
    const clips = screen.getByText('Clips');
    expect(clips.className.includes('bg-cyan-600')).toBe(false);
    expect(clips.className.includes('text-gray-500')).toBe(true);
  });

  it('lights Published in amber when it is the active tab', () => {
    render(<EmptyTabGuide tab="published" clipCount={0} gamesCount={1} onNavigate={vi.fn()} />);
    const published = screen.getByText('Published');
    expect(published.className.includes('bg-amber-600')).toBe(true);
  });

  it('never prints a "Step N of M" line (T9320) nor any step digit', () => {
    render(<EmptyTabGuide tab="reels" clipCount={2} onNavigate={vi.fn()} onBuildReel={vi.fn()} />);
    expect(screen.queryByText(/Step \d+ of \d+/)).toBeNull();
    expect(screen.queryByText(/^\d+$/)).toBeNull();
  });
});

describe('EmptyTabGuide - Games tab', () => {
  it('shows the approved headline, body, Add Game CTA + cost caption, and the Clips footer link', () => {
    const onAddGame = vi.fn();
    const onNavigate = vi.fn();
    render(<EmptyTabGuide tab="games" gamesCount={0} onAddGame={onAddGame} onNavigate={onNavigate} />);

    expect(screen.getByText(EMPTY_TAB_GUIDE.games.headline)).toBeTruthy();
    expect(screen.getByText(EMPTY_TAB_GUIDE.games.body)).toBeTruthy();
    expect(screen.getByText(EMPTY_TAB_GUIDE.games.addGameCaption)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Upload game' }));
    expect(onAddGame).toHaveBeenCalledTimes(1);

    // Footer link (Games only) switches to the Clips tab (id 'projects').
    fireEvent.click(screen.getByRole('button', { name: EMPTY_TAB_GUIDE.games.footerLink }));
    expect(onNavigate).toHaveBeenCalledWith('projects');
  });
});

describe('EmptyTabGuide - Clips tab (T9390: no cross-tab Add Game)', () => {
  it('games > 0: offers Go to Games plus the always-present Add Video (with the tutorial anchor)', () => {
    const onNavigate = vi.fn();
    const onAddVideo = vi.fn();
    render(
      <EmptyTabGuide tab="clips" gamesCount={2} onNavigate={onNavigate} onAddVideo={onAddVideo} />,
    );

    expect(screen.getByText(EMPTY_TAB_GUIDE.clips.openGameText)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Games' }));
    expect(onNavigate).toHaveBeenCalledWith('games');

    const addVideo = screen.getByRole('button', { name: 'Upload clip' });
    expect(addVideo.getAttribute('data-tutorial-target')).toBe('clips-add-video');
    fireEvent.click(addVideo);
    expect(onAddVideo).toHaveBeenCalledTimes(1);
  });

  it('games = 0: shows Add Video ALONE with the "No game needed." caption and NO Add Game', () => {
    const onAddVideo = vi.fn();
    render(
      <EmptyTabGuide tab="clips" gamesCount={0} onNavigate={vi.fn()} onAddGame={vi.fn()} onAddVideo={onAddVideo} />,
    );

    // The cross-tab "Add Game" create action is gone at zero games (Decision 3).
    expect(screen.queryByRole('button', { name: 'Upload game' })).toBeNull();
    expect(screen.getByText(EMPTY_TAB_GUIDE.clips.noGameCaption)).toBeTruthy();

    // Exactly one Add Video button, still carrying the unique tutorial anchor.
    const addVideos = screen.getAllByRole('button', { name: 'Upload clip' });
    expect(addVideos).toHaveLength(1);
    expect(addVideos[0].getAttribute('data-tutorial-target')).toBe('clips-add-video');
    fireEvent.click(addVideos[0]);
    expect(onAddVideo).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyTabGuide - Reels tab (T9390: tab is gated, so Build New Reel is always enabled)', () => {
  it('has clips but clipCount 0 (game-clips-only account): enabled button, no contradictory "0 clips"', () => {
    render(
      <EmptyTabGuide tab="reels" clipCount={0} onNavigate={vi.fn()} onBuildReel={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Create reel' }).disabled).toBe(false);
    expect(screen.getByText('You have clips ready to use.')).toBeTruthy();
    expect(screen.queryByText(/0 clip/)).toBeNull();
  });

  it('Build New Reel is enabled with the "N clips ready" caption (pluralized) and fires', () => {
    const onBuildReel = vi.fn();
    render(
      <EmptyTabGuide tab="reels" clipCount={3} onNavigate={vi.fn()} onBuildReel={onBuildReel} />,
    );
    const build = screen.getByRole('button', { name: 'Create reel' });
    expect(build.disabled).toBe(false);
    expect(screen.getByText('You have 3 clips ready to use.')).toBeTruthy();
    fireEvent.click(build);
    expect(onBuildReel).toHaveBeenCalledTimes(1);
  });

  it('no longer renders the deleted "no clips" dead-end branch', () => {
    render(<EmptyTabGuide tab="reels" clipCount={1} onNavigate={vi.fn()} onBuildReel={vi.fn()} />);
    expect(screen.queryByText(/You need at least one clip first/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Cut a clip from a game/i })).toBeNull();
  });
});

describe('EmptyTabGuide - Published tab (T9390: nothing-branch deleted, tab is gated)', () => {
  it('drafts > 0: names the in-progress clips and links to Clips via "Open Clips"', () => {
    const onNavigate = vi.fn();
    render(<EmptyTabGuide tab="published" clipCount={1} gamesCount={2} onNavigate={onNavigate} />);

    expect(screen.getByText('You have 1 clip in progress.')).toBeTruthy();
    expect(screen.queryByText(/the Clips tab/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Clips' }));
    expect(onNavigate).toHaveBeenCalledWith('projects');
  });

  it('no drafts: points to Games with the trimmed line (games are guaranteed once gated)', () => {
    const onNavigate = vi.fn();
    render(<EmptyTabGuide tab="published" clipCount={0} gamesCount={2} onNavigate={onNavigate} />);
    expect(screen.getByText(EMPTY_TAB_GUIDE.published.noClipsGamesText)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Games' }));
    expect(onNavigate).toHaveBeenCalledWith('games');
  });

  it('offers NO cross-tab Add Game (the zero-everything branch was deleted)', () => {
    render(<EmptyTabGuide tab="published" clipCount={0} gamesCount={0} onNavigate={vi.fn()} onAddGame={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Upload game' })).toBeNull();
    // Falls through to the Go to Games branch instead of the retired Add Game one.
    expect(screen.getByRole('button', { name: 'Go to Games' })).toBeTruthy();
  });
});

describe('EmptyTabGuide copy hygiene', () => {
  it('ships no em dashes anywhere in the approved copy', () => {
    const walk = (v) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'function') return v(2); // exercise count-interpolated captions
      if (v && typeof v === 'object') return Object.values(v).map(walk).join(' ');
      return '';
    };
    expect(walk(EMPTY_TAB_GUIDE)).not.toContain('—');
  });

  it('ships no em dashes anywhere in the LOCKED partial copy (T8990)', () => {
    const walk = (v) => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') return Object.values(v).map(walk).join(' ');
      return '';
    };
    expect(walk(PARTIAL_TAB_GUIDE)).not.toContain('—');
  });

  it('every empty-variant tab body is a single short sentence (Decision 2 density cut)', () => {
    for (const tab of ['games', 'clips', 'reels', 'published']) {
      const body = EMPTY_TAB_GUIDE[tab].body;
      // One sentence: exactly one terminal period, no mid-string ". " split.
      expect(body.split('. ').length).toBe(1);
    }
  });
});

// T8990/T9390: the compact, tile-shaped partial variant kept until the first row
// fills. T9390 dropped the strip + footer, added a decorative top accent border.
describe('EmptyTabGuide - partial variant', () => {
  it('renders the locked headline and body for every tab, and NO footer line', () => {
    for (const tab of ['games', 'clips', 'reels', 'published']) {
      const { unmount } = render(<EmptyTabGuide tab={tab} variant="partial" />);
      const c = PARTIAL_TAB_GUIDE[tab];
      expect(screen.getByText(c.headline)).toBeTruthy();
      expect(screen.getByText(c.body)).toBeTruthy();
      // Footer field removed entirely (T9390).
      expect(c.footer).toBeUndefined();
      unmount();
    }
  });

  it('renders the headline as an h3 (the enclosing group owns the h2)', () => {
    render(<EmptyTabGuide tab="clips" variant="partial" />);
    const h3 = screen.getByRole('heading', { level: 3 });
    expect(h3.textContent).toBe(PARTIAL_TAB_GUIDE.clips.headline);
  });

  it('drops the flow strip entirely (no numbered dots, no "Step N of M")', () => {
    const { container } = render(<EmptyTabGuide tab="reels" variant="partial" />);
    expect(screen.queryByText(/Step \d+ of \d+/)).toBeNull();
    // No ordered-list strip remains in the partial card.
    expect(container.querySelector('ol')).toBeNull();
  });

  it('carries a decorative top accent border in the tab color + an accessible label', () => {
    render(<EmptyTabGuide tab="published" variant="partial" />);
    const aside = screen.getByRole('complementary');
    expect(aside.className).toMatch(/border-t-4/);
    expect(aside.className).toMatch(/border-t-amber-600/);
    // Visually-hidden text is gone, so the label preserves tab context for SR users.
    expect(aside.getAttribute('aria-label')).toMatch(/Published/);
  });

  it('Games: renders the "Open game" CTA and fires onAction', () => {
    const onAction = vi.fn();
    render(<EmptyTabGuide tab="games" variant="partial" onAction={onAction} />);
    const cta = screen.getByRole('button', { name: PARTIAL_TAB_GUIDE.games.cta });
    fireEvent.click(cta);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('Clips partial renders NO Add Video button and NO tutorial target (T8380 invariant)', () => {
    const { container } = render(<EmptyTabGuide tab="clips" variant="partial" />);
    expect(screen.queryByRole('button', { name: 'Upload clip' })).toBeNull();
    expect(container.querySelector('[data-tutorial-target="clips-add-video"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('Reels and Published partials carry no CTA button (action lives above the row)', () => {
    for (const tab of ['reels', 'published']) {
      const { container, unmount } = render(<EmptyTabGuide tab={tab} variant="partial" />);
      expect(container.querySelector('button')).toBeNull();
      unmount();
    }
  });

  it('applies the caller-provided sizing className to the outer aside', () => {
    render(<EmptyTabGuide tab="games" variant="partial" className="aspect-video self-stretch" onAction={vi.fn()} />);
    const aside = screen.getByRole('complementary');
    expect(aside.className).toMatch(/aspect-video/);
    expect(aside.className).toMatch(/self-stretch/);
  });
});
