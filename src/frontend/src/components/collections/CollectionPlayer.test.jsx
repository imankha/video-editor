import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CollectionPlayer } from './CollectionPlayer';

// Plain button so we can query by title; drop the icon/variant props.
vi.mock('../shared/Button', () => ({
  Button: ({ onClick, disabled, title, children }) => (
    <button onClick={onClick} disabled={disabled} title={title}>{children}</button>
  ),
}));

// Drive activeReel deterministically from the first passed reel.
const { mockGoTo } = vi.hoisted(() => ({ mockGoTo: vi.fn() }));
vi.mock('./useStoryPlayback', () => ({
  useStoryPlayback: (_ref, reels) => ({
    activeIndex: 0,
    activeReel: reels[0],
    segmentProgress: 0,
    next: vi.fn(),
    prev: vi.fn(),
    goTo: mockGoTo,
    togglePlay: vi.fn(),
  }),
}));

describe('CollectionPlayer timeline segments (T5100)', () => {
  // reel0 is the active reel (its name shows in the bottom overlay); hover
  // assertions target reels 1 and 2 so the tooltip is the only place the text
  // appears. reel2 carries a game -> header-style "gameName clock" label.
  const segReels = [
    { id: 1, name: 'Active', streamUrl: 'a', aspect_ratio: '9:16', duration: null },
    { id: 2, name: 'Reel Two', streamUrl: 'b', aspect_ratio: '9:16', duration: null },
    { id: 3, name: 'plain', streamUrl: 'c', aspect_ratio: '9:16', duration: null,
      gameName: 'Lakers', gameStartTime: 750 },
  ];

  beforeEach(() => mockGoTo.mockClear());

  const segmentButtons = () =>
    screen.getAllByRole('button').filter((b) => /^(Active|Reel Two|Lakers)/.test(b.getAttribute('aria-label') || ''));

  it('shows the reel name on hover (game-name + clock semantics like the header)', () => {
    render(<CollectionPlayer reels={segReels} title="T" onClose={vi.fn()} />);
    const [, seg1, seg2] = segmentButtons();

    // No tooltip until hovered.
    expect(screen.queryByText('Reel Two')).toBeNull();
    fireEvent.mouseEnter(seg1);
    expect(screen.getByText('Reel Two')).toBeTruthy();

    // Reel with a game uses "gameName clock" (matches the header), not the plain name.
    fireEvent.mouseLeave(seg1);
    fireEvent.mouseEnter(seg2);
    expect(screen.getByText('Lakers 12\'30"')).toBeTruthy();
    expect(screen.queryByText('plain')).toBeNull(); // name is superseded by the game label
  });

  it('clicking a segment jumps to that reel and seeks to the clicked fraction', () => {
    render(<CollectionPlayer reels={segReels} title="T" onClose={vi.fn()} />);
    const [, seg1] = segmentButtons();
    seg1.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, right: 100, bottom: 0, height: 20, x: 0, y: 0 });

    fireEvent.click(seg1, { clientX: 60 });
    expect(mockGoTo).toHaveBeenCalledWith(1, 0.6);
  });

  it('computes the fraction relative to the segment left edge', () => {
    render(<CollectionPlayer reels={segReels} title="T" onClose={vi.fn()} />);
    const [seg0] = segmentButtons();
    seg0.getBoundingClientRect = () => ({ left: 10, width: 100, top: 0, right: 110, bottom: 0, height: 20, x: 10, y: 0 });

    fireEvent.click(seg0, { clientX: 60 }); // (60 - 10) / 100
    expect(mockGoTo).toHaveBeenLastCalledWith(0, 0.5);
  });
});

const RE_EDIT = 'Re-edit this reel';
const reelWith = (project_id) => [{ id: 99, name: 'R', streamUrl: 's', aspect_ratio: '9:16', duration: null, project_id }];

const renderPlayer = (props) =>
  render(<CollectionPlayer reels={reelWith(7)} title="T" onClose={vi.fn()} {...props} />);

describe('CollectionPlayer Re-edit button gating (T3940)', () => {
  it('shows the button when onReEdit is set AND the active reel has a project', () => {
    renderPlayer({ onReEdit: vi.fn() });
    expect(screen.getByTitle(RE_EDIT)).toBeTruthy();
  });

  it('hides the button on the public viewer (no onReEdit prop)', () => {
    renderPlayer({}); // SharedCollectionView omits onReEdit
    expect(screen.queryByTitle(RE_EDIT)).toBeNull();
  });

  it('hides the button when the active reel has no editable project (null)', () => {
    render(<CollectionPlayer reels={reelWith(null)} title="T" onClose={vi.fn()} onReEdit={vi.fn()} />);
    expect(screen.queryByTitle(RE_EDIT)).toBeNull();
  });

  it('hides the button when project_id is 0 (non-editable export)', () => {
    render(<CollectionPlayer reels={reelWith(0)} title="T" onClose={vi.fn()} onReEdit={vi.fn()} />);
    expect(screen.queryByTitle(RE_EDIT)).toBeNull();
  });

  it('invokes onReEdit with the active reel on click', () => {
    const onReEdit = vi.fn();
    renderPlayer({ onReEdit });
    fireEvent.click(screen.getByTitle(RE_EDIT));
    expect(onReEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 99, project_id: 7 }));
  });

  it('disables the button while that reel is restoring', () => {
    renderPlayer({ onReEdit: vi.fn(), reEditLoadingId: 99 });
    expect(screen.getByTitle(RE_EDIT).disabled).toBe(true);
  });
});

const RE_RANK = 'Re-rank this reel';
const rankReel = ({ project_id = 7, clip_count = 1 } = {}) =>
  [{ id: 99, name: 'R', streamUrl: 's', aspect_ratio: '9:16', duration: null, project_id, clip_count }];

describe('CollectionPlayer Re-rank button gating (T4030)', () => {
  it('shows the button when onReRank is set AND the reel is single-clip with a project', () => {
    render(<CollectionPlayer reels={rankReel()} title="T" onClose={vi.fn()} onReRank={vi.fn()} />);
    expect(screen.getByTitle(RE_RANK)).toBeTruthy();
  });

  it('hides the button on the public viewer (no onReRank prop)', () => {
    render(<CollectionPlayer reels={rankReel()} title="T" onClose={vi.fn()} />);
    expect(screen.queryByTitle(RE_RANK)).toBeNull();
  });

  it('hides the button for a multi-clip reel (Mix)', () => {
    render(<CollectionPlayer reels={rankReel({ clip_count: 2 })} title="T" onClose={vi.fn()} onReRank={vi.fn()} />);
    expect(screen.queryByTitle(RE_RANK)).toBeNull();
  });

  it('hides the button when the reel has no editable project', () => {
    render(<CollectionPlayer reels={rankReel({ project_id: null })} title="T" onClose={vi.fn()} onReRank={vi.fn()} />);
    expect(screen.queryByTitle(RE_RANK)).toBeNull();
  });

  it('invokes onReRank with the active reel on click', () => {
    const onReRank = vi.fn();
    render(<CollectionPlayer reels={rankReel()} title="T" onClose={vi.fn()} onReRank={onReRank} />);
    fireEvent.click(screen.getByTitle(RE_RANK));
    expect(onReRank).toHaveBeenCalledWith(expect.objectContaining({ id: 99, clip_count: 1 }));
  });

  it('disables the button while that reel is re-ranking', () => {
    render(<CollectionPlayer reels={rankReel()} title="T" onClose={vi.fn()} onReRank={vi.fn()} reRankLoadingId={99} />);
    expect(screen.getByTitle(RE_RANK).disabled).toBe(true);
  });
});
