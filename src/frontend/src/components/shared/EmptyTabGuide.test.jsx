import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EmptyTabGuide, TabGuideHeader } from './EmptyTabGuide';
import { EMPTY_TAB_GUIDE, PARTIAL_TAB_GUIDE } from '../../config/emptyStates';

// T8980/T9390/T10280: the shared empty state rendered by the home tabs. Copy is
// binding; these tests assert the exact copy + the count-driven branching. T10280
// deleted the flow strip and consolidated every tab onto the one TabGuideHeader
// structure (a centered headline; the Games tab adds a floating coach line that
// depends on whether any games exist), used by the empty state AND the populated
// Games/Clips tabs. T11230 removed the 'reels' tab/variant with the Reels building
// surfaces.

describe('EmptyTabGuide shared guidance structure (T10280)', () => {
  it('renders the same centered headline for every tab, and NO flow strip', () => {
    for (const tab of ['games', 'clips', 'published']) {
      const { container, unmount } = render(
        <EmptyTabGuide
          tab={tab}
          gamesCount={0}
          onNavigate={vi.fn()}
          onAddGame={vi.fn()}
          onAddVideo={vi.fn()}
        />,
      );
      const c = EMPTY_TAB_GUIDE[tab];
      // Headline is the h2. No body paragraph is rendered (4e4a18c1b removed it).
      const h2 = screen.getByRole('heading', { level: 2 });
      expect(h2.textContent).toBe(c.headline);
      expect(h2.className).toMatch(/text-lg/);
      expect(h2.className).toMatch(/font-semibold/);
      expect(c.body).toBeUndefined();
      // The flow strip (an <ol> of Games/Clips/Reels/Published peers + the dashed
      // "optional" pill) is gone entirely on every tab (T10280).
      expect(container.querySelector('ol')).toBeNull();
      expect(screen.queryByText(/optional/i)).toBeNull();
      unmount();
    }
  });

  it('exports TabGuideHeader, which renders the tab headline standalone', () => {
    render(<TabGuideHeader tab="clips" />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(EMPTY_TAB_GUIDE.clips.headline);
  });

  it('Games coach tells a user with NO games to upload one, and points at the upload button', () => {
    render(
      <div>
        <button data-guidance-target="upload-games">Upload game</button>
        <TabGuideHeader tab="games" gamesCount={0} />
      </div>,
    );
    expect(screen.getByText(EMPTY_TAB_GUIDE.games.coachNoGames)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TAB_GUIDE.games.coachWithGames)).toBeNull();
  });

  it('Games coach tells a user WITH games to press on a game', () => {
    render(<TabGuideHeader tab="games" gamesCount={2} />);
    expect(screen.getByText(EMPTY_TAB_GUIDE.games.coachWithGames)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TAB_GUIDE.games.coachNoGames)).toBeNull();
  });
});

describe('EmptyTabGuide - Games tab', () => {
  it('shows the approved headline, the upload-a-game coach, Add Game CTA, and the Clips footer link without a cost caption', () => {
    const onAddGame = vi.fn();
    const onNavigate = vi.fn();
    render(<EmptyTabGuide tab="games" gamesCount={0} onAddGame={onAddGame} onNavigate={onNavigate} />);

    expect(screen.getByText(EMPTY_TAB_GUIDE.games.headline)).toBeTruthy();
    // Zero games: the coach instructs the user to upload (not "press on a game").
    expect(screen.getByText(EMPTY_TAB_GUIDE.games.coachNoGames)).toBeTruthy();
    expect(screen.queryByText(EMPTY_TAB_GUIDE.games.coachWithGames)).toBeNull();
    expect(EMPTY_TAB_GUIDE.games.addGameCaption).toBeNull();
    expect(screen.queryByText(/from your phone or computer/i)).toBeNull();

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

    const addVideo = screen.getByRole('button', { name: 'Upload highlight' });
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
    const addVideos = screen.getAllByRole('button', { name: 'Upload highlight' });
    expect(addVideos).toHaveLength(1);
    expect(addVideos[0].getAttribute('data-tutorial-target')).toBe('clips-add-video');
    fireEvent.click(addVideos[0]);
    expect(onAddVideo).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyTabGuide - Reels tab removed (T11230)', () => {
  it('renders nothing for the retired reels tab (no copy entry, no Create reel button)', () => {
    const { container } = render(
      <EmptyTabGuide tab="reels" onNavigate={vi.fn()} />,
    );
    // EMPTY_TAB_GUIDE.reels is gone, so EmptyTabGuide returns null for this tab.
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button', { name: /Create reel/i })).toBeNull();
  });
});

describe('EmptyTabGuide - Published tab (T10310: headline/body only, no fallback action)', () => {
  it('shows the headline and NO "Cut your first clip" text or Go to Games button', () => {
    // T10310 (2026-09-18 user request) dropped the "Cut your first clip to get
    // started." line + Go to Games button -- headline/body is the whole guide now,
    // regardless of clip/game count.
    render(<EmptyTabGuide tab="published" clipCount={3} gamesCount={2} onNavigate={vi.fn()} />);

    expect(screen.getByText(EMPTY_TAB_GUIDE.published.headline)).toBeTruthy();
    expect(screen.queryByText(/cut your first clip/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go to Games' })).toBeNull();
    expect(screen.queryByText(/in progress/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Clips' })).toBeNull();
  });

  it('offers NO cross-tab Add Game (the zero-everything branch was deleted)', () => {
    render(<EmptyTabGuide tab="published" clipCount={0} gamesCount={0} onNavigate={vi.fn()} onAddGame={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Upload game' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go to Games' })).toBeNull();
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

  it('every empty-variant tab has a non-empty headline; Games has both coach lines', () => {
    for (const tab of ['games', 'clips', 'published']) {
      expect(EMPTY_TAB_GUIDE[tab].headline.trim().length).toBeGreaterThan(0);
    }
    expect(EMPTY_TAB_GUIDE.games.coachNoGames.trim().length).toBeGreaterThan(0);
    expect(EMPTY_TAB_GUIDE.games.coachWithGames.trim().length).toBeGreaterThan(0);
  });
});

// T8990/T9390: the compact, tile-shaped partial variant kept until the first row
// fills. T9390 dropped the strip + footer, added a decorative top accent border.
describe('EmptyTabGuide - partial variant', () => {
  it('renders the locked headline and body for every tab, and NO footer line', () => {
    for (const tab of ['games', 'clips', 'published']) {
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
    const { container } = render(<EmptyTabGuide tab="clips" variant="partial" />);
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
    expect(aside.getAttribute('aria-label')).toMatch(/Finished/);
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
    expect(screen.queryByRole('button', { name: 'Upload highlight' })).toBeNull();
    expect(container.querySelector('[data-tutorial-target="clips-add-video"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('Published partial carries no CTA button (action lives above the row)', () => {
    const { container } = render(<EmptyTabGuide tab="published" variant="partial" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('applies the caller-provided sizing className to the outer aside', () => {
    render(<EmptyTabGuide tab="games" variant="partial" className="aspect-video self-stretch" onAction={vi.fn()} />);
    const aside = screen.getByRole('complementary');
    expect(aside.className).toMatch(/aspect-video/);
    expect(aside.className).toMatch(/self-stretch/);
  });
});
