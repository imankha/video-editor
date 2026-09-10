import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmptyTabGuide } from './EmptyTabGuide';
import { EMPTY_TAB_GUIDE, PARTIAL_TAB_GUIDE } from '../../config/emptyStates';

// T8980: the shared empty state rendered by all four home tabs. Copy is APPROVED
// and binding; these tests assert the exact copy + the count-driven branching +
// the flow strip's lit-step color and collapsed-dots variant. (jsdom applies no
// CSS, so both the sm+ strip and the sub-sm dots render at once -- the tests
// assert both variants are present rather than which one is visible.)

describe('EmptyTabGuide flow strip', () => {
  it('lights the current step in its own tab color, others muted', () => {
    render(<EmptyTabGuide tab="games" gamesCount={0} onAddGame={vi.fn()} onNavigate={vi.fn()} />);

    // Games is step 1 -> lit green (GAME.bg). Some "1" element carries the color.
    const ones = screen.getAllByText('1');
    expect(ones.some((el) => el.className.includes('bg-green-600'))).toBe(true);

    // Step 2 (Clips) is not the current tab -> muted, never the cyan REEL color.
    const twos = screen.getAllByText('2');
    expect(twos.every((el) => !el.className.includes('bg-cyan-600'))).toBe(true);
    expect(twos.some((el) => el.className.includes('bg-gray-700'))).toBe(true);
  });

  it('each tab lights its own color (published -> amber)', () => {
    render(<EmptyTabGuide tab="published" clipCount={0} gamesCount={0} onAddGame={vi.fn()} onNavigate={vi.fn()} />);
    const fours = screen.getAllByText('4');
    expect(fours.some((el) => el.className.includes('bg-amber-600'))).toBe(true);
  });

  it('collapsed dots variant no longer prints the "Step N of M" line (T9320)', () => {
    render(<EmptyTabGuide tab="reels" hasClips gamesCount={1} clipCount={2} onNavigate={vi.fn()} onBuildReel={vi.fn()} />);
    // T9320 removed the noisy "Step 3 of 4: Reels" sentence; the numbered dots stay.
    expect(screen.queryByText(/Step \d+ of \d+/)).toBeNull();
  });
});

describe('EmptyTabGuide - Games tab', () => {
  it('shows the approved headline, body, Add Game CTA + cost caption, and the In Progress Clips footer link', () => {
    const onAddGame = vi.fn();
    const onNavigate = vi.fn();
    render(<EmptyTabGuide tab="games" gamesCount={0} onAddGame={onAddGame} onNavigate={onNavigate} />);

    expect(screen.getByText(EMPTY_TAB_GUIDE.games.headline)).toBeTruthy();
    expect(screen.getByText(EMPTY_TAB_GUIDE.games.body)).toBeTruthy();
    expect(screen.getByText(EMPTY_TAB_GUIDE.games.addGameCaption)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add Game' }));
    expect(onAddGame).toHaveBeenCalledTimes(1);

    // Footer link switches to the In Progress Clips tab (id 'projects').
    fireEvent.click(screen.getByRole('button', { name: EMPTY_TAB_GUIDE.games.footerLink }));
    expect(onNavigate).toHaveBeenCalledWith('projects');
  });
});

describe('EmptyTabGuide - Clips tab', () => {
  it('games > 0: offers Go to Games plus the always-present Add Video (with the tutorial anchor)', () => {
    const onNavigate = vi.fn();
    const onAddVideo = vi.fn();
    render(
      <EmptyTabGuide tab="clips" gamesCount={2} onNavigate={onNavigate} onAddGame={vi.fn()} onAddVideo={onAddVideo} />,
    );

    expect(screen.getByText(EMPTY_TAB_GUIDE.clips.openGameText)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Games' }));
    expect(onNavigate).toHaveBeenCalledWith('games');

    const addVideo = screen.getByRole('button', { name: 'Add Video' });
    expect(addVideo.getAttribute('data-tutorial-target')).toBe('clips-add-video');
    fireEvent.click(addVideo);
    expect(onAddVideo).toHaveBeenCalledTimes(1);
  });

  it('games = 0: the game path becomes Add Game, still with the Add Video upload path', () => {
    const onAddGame = vi.fn();
    render(
      <EmptyTabGuide tab="clips" gamesCount={0} onNavigate={vi.fn()} onAddGame={onAddGame} onAddVideo={vi.fn()} />,
    );

    expect(screen.getByText(EMPTY_TAB_GUIDE.clips.addGameText)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Game' }));
    expect(onAddGame).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add Video' })).toBeTruthy();
  });
});

describe('EmptyTabGuide - Reels tab', () => {
  it('no clips: Build New Reel is disabled with a VISIBLE reason (no hover title) + a cross-tab button', () => {
    const onNavigate = vi.fn();
    render(
      <EmptyTabGuide tab="reels" hasClips={false} clipCount={0} gamesCount={1} onNavigate={onNavigate} onBuildReel={vi.fn()} />,
    );

    const build = screen.getByRole('button', { name: 'Build New Reel' });
    expect(build.disabled).toBe(true);
    // Reason is on-screen text, never a hover-only title attribute.
    expect(screen.getByText(EMPTY_TAB_GUIDE.reels.noClipsReason)).toBeTruthy();
    expect(build.getAttribute('title')).toBeNull();

    // With games, "Cut a clip from a game" routes to Games.
    fireEvent.click(screen.getByRole('button', { name: EMPTY_TAB_GUIDE.reels.cutClipButton }));
    expect(onNavigate).toHaveBeenCalledWith('games');
  });

  it('no clips AND no games: the cross-tab button routes to Clips (projects) instead', () => {
    const onNavigate = vi.fn();
    render(
      <EmptyTabGuide tab="reels" hasClips={false} clipCount={0} gamesCount={0} onNavigate={onNavigate} onBuildReel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: EMPTY_TAB_GUIDE.reels.cutClipButton }));
    expect(onNavigate).toHaveBeenCalledWith('projects');
  });

  it('has clips but clipCount 0 (game-clips-only account): enabled button, no contradictory "0 clips"', () => {
    // hasClips counts game clips too, but clipCount is clipDrafts-only, so this
    // pairing is reachable (a game annotated into clips, no Add-Video drafts).
    // The button must be enabled and the caption must NOT claim "0 clips".
    render(
      <EmptyTabGuide tab="reels" hasClips clipCount={0} gamesCount={1} onNavigate={vi.fn()} onBuildReel={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Build New Reel' }).disabled).toBe(false);
    expect(screen.getByText('You have clips ready to use.')).toBeTruthy();
    expect(screen.queryByText(/0 clip/)).toBeNull();
  });

  it('has clips: Build New Reel is enabled with the "N clips ready" caption (pluralized)', () => {
    const onBuildReel = vi.fn();
    render(
      <EmptyTabGuide tab="reels" hasClips clipCount={3} gamesCount={1} onNavigate={vi.fn()} onBuildReel={onBuildReel} />,
    );
    const build = screen.getByRole('button', { name: 'Build New Reel' });
    expect(build.disabled).toBe(false);
    expect(screen.getByText('You have 3 clips ready to use.')).toBeTruthy();
    fireEvent.click(build);
    expect(onBuildReel).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyTabGuide - Published tab', () => {
  it('drafts > 0: names the in-progress clips and links to In Progress Clips (never "the Clips tab")', () => {
    const onNavigate = vi.fn();
    render(<EmptyTabGuide tab="published" clipCount={1} gamesCount={2} onNavigate={onNavigate} onAddGame={vi.fn()} />);

    expect(screen.getByText('You have 1 clip in progress. Publish one to see it here.')).toBeTruthy();
    expect(screen.queryByText(/the Clips tab/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open In Progress Clips' }));
    expect(onNavigate).toHaveBeenCalledWith('projects');
  });

  it('no drafts but games exist: points to Games', () => {
    const onNavigate = vi.fn();
    render(<EmptyTabGuide tab="published" clipCount={0} gamesCount={2} onNavigate={onNavigate} onAddGame={vi.fn()} />);
    expect(screen.getByText(EMPTY_TAB_GUIDE.published.noClipsGamesText)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Games' }));
    expect(onNavigate).toHaveBeenCalledWith('games');
  });

  it('nothing at all: offers Add Game', () => {
    const onAddGame = vi.fn();
    render(<EmptyTabGuide tab="published" clipCount={0} gamesCount={0} onNavigate={vi.fn()} onAddGame={onAddGame} />);
    expect(screen.getByText(EMPTY_TAB_GUIDE.published.nothingText)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Game' }));
    expect(onAddGame).toHaveBeenCalledTimes(1);
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
});

// T8990: the compact, tile-shaped partial variant kept until the first row fills.
describe('EmptyTabGuide - partial variant (T8990)', () => {
  it('renders the locked headline, body and footer for every tab', () => {
    for (const tab of ['games', 'clips', 'reels', 'published']) {
      const { unmount } = render(<EmptyTabGuide tab={tab} variant="partial" />);
      const c = PARTIAL_TAB_GUIDE[tab];
      expect(screen.getByText(c.headline)).toBeTruthy();
      expect(screen.getByText(c.body)).toBeTruthy();
      expect(screen.getByText(c.footer)).toBeTruthy();
      unmount();
    }
  });

  it('renders the headline as an h3 (the enclosing group owns the h2)', () => {
    render(<EmptyTabGuide tab="clips" variant="partial" />);
    const h3 = screen.getByRole('heading', { level: 3 });
    expect(h3.textContent).toBe(PARTIAL_TAB_GUIDE.clips.headline);
  });

  it('no longer shows the compact "Step N of M" line (T9320)', () => {
    render(<EmptyTabGuide tab="reels" variant="partial" />);
    expect(screen.queryByText(/Step \d+ of \d+/)).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Add Video' })).toBeNull();
    expect(container.querySelector('[data-tutorial-target="clips-add-video"]')).toBeNull();
    // Copy-only: no buttons at all on the clips/reels/published partial.
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
