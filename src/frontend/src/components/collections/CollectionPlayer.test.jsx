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
vi.mock('./useStoryPlayback', () => ({
  useStoryPlayback: (_ref, reels) => ({
    activeIndex: 0,
    activeReel: reels[0],
    segmentProgress: 0,
    next: vi.fn(),
    prev: vi.fn(),
    togglePlay: vi.fn(),
  }),
}));

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
