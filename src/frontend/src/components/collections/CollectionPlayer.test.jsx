import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CollectionPlayer } from './CollectionPlayer';

// Plain button so we can query by title; drop the icon/variant props.
vi.mock('../shared/Button', () => ({
  // Mirror the real Button's disabled-or-loading semantics so `loading` (T8530's
  // Publish spinner) also disables the mocked button, matching production.
  Button: ({ onClick, disabled, loading, title, children }) => (
    <button onClick={onClick} disabled={disabled || loading} title={title}>{children}</button>
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

describe('CollectionPlayer modality (T5860)', () => {
  const reels = [{ id: 1, name: 'A', streamUrl: 'a', aspect_ratio: '9:16', duration: null }];

  it('renders a backdrop beneath the panel at all breakpoints', () => {
    // The backdrop is `fixed inset-0` (no md: reset), so it covers the viewport
    // on mobile AND desktop — the desktop md:inset-12 gutter can never expose tiles.
    render(<CollectionPlayer reels={reels} title="T" onClose={vi.fn()} />);
    const backdrop = screen.getByTestId('collection-player-backdrop');
    expect(backdrop.className).toContain('fixed');
    expect(backdrop.className).toContain('inset-0');
    expect(backdrop.className).not.toContain('md:inset');
  });

  it('does NOT close the player when the backdrop is clicked (project rule)', () => {
    const onClose = vi.fn();
    render(<CollectionPlayer reels={reels} title="T" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('collection-player-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('marks the panel as a modal dialog (role=dialog, aria-modal)', () => {
    render(<CollectionPlayer reels={reels} title="My Reel" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('My Reel');
  });

  it('locks background scroll while open and restores it on unmount', () => {
    const { unmount } = render(<CollectionPlayer reels={reels} title="T" onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
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

// T8540: Share is the player's primary action -- renders for every reel (no
// gating, unlike Re-rank/Re-edit above), and Download stays present alongside it.
describe('CollectionPlayer Share button (T8540)', () => {
  const plainReel = [{ id: 5, name: 'R', streamUrl: 's', aspect_ratio: '9:16', duration: null }];

  it('renders when onShare is set, with no gating on reel shape', () => {
    render(<CollectionPlayer reels={plainReel} title="T" onClose={vi.fn()} onShare={vi.fn()} />);
    expect(screen.getByTitle('Share')).toBeTruthy();
  });

  it('is absent when onShare is omitted (e.g. the public viewer)', () => {
    render(<CollectionPlayer reels={plainReel} title="T" onClose={vi.fn()} />);
    expect(screen.queryByTitle('Share')).toBeNull();
  });

  it('invokes onShare with the active reel on click', () => {
    const onShare = vi.fn();
    render(<CollectionPlayer reels={plainReel} title="T" onClose={vi.fn()} onShare={onShare} />);
    fireEvent.click(screen.getByTitle('Share'));
    expect(onShare).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
  });

  it('Download still renders alongside Share', () => {
    render(
      <CollectionPlayer reels={plainReel} title="T" onClose={vi.fn()} onShare={vi.fn()} onDownload={vi.fn()} />,
    );
    expect(screen.getByTitle('Share')).toBeTruthy();
    expect(screen.getByText('Download')).toBeTruthy();
  });
});

// T8530: the draft-preview props — onPublish (the primary slot's draft-state
// occupant), publishLoading, and the statusBanner slot between header and video.
describe('CollectionPlayer draft-preview props (T8530)', () => {
  const plainReel = [{ id: 5, name: 'R', streamUrl: 's', aspect_ratio: '9:16', duration: null }];

  it('renders a Publish button (found by its full accessible name) when onPublish is set', () => {
    render(<CollectionPlayer reels={plainReel} title="T" onClose={vi.fn()} onPublish={vi.fn()} />);
    expect(screen.getByTitle('Publish to Highlight Reels')).toBeTruthy();
  });

  it('omits Publish when onPublish is not set', () => {
    render(<CollectionPlayer reels={plainReel} title="T" onClose={vi.fn()} />);
    expect(screen.queryByTitle('Publish to Highlight Reels')).toBeNull();
  });

  it('invokes onPublish on click', () => {
    const onPublish = vi.fn();
    render(<CollectionPlayer reels={plainReel} title="T" onClose={vi.fn()} onPublish={onPublish} />);
    fireEvent.click(screen.getByTitle('Publish to Highlight Reels'));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('disables Publish while publishLoading', () => {
    render(<CollectionPlayer reels={plainReel} title="T" onClose={vi.fn()} onPublish={vi.fn()} publishLoading />);
    expect(screen.getByTitle('Publish to Highlight Reels').disabled).toBe(true);
  });

  it('renders the statusBanner slot when provided', () => {
    render(
      <CollectionPlayer
        reels={plainReel}
        title="T"
        onClose={vi.fn()}
        statusBanner={<div data-testid="draft-preview-banner">hi</div>}
      />,
    );
    expect(screen.getByTestId('draft-preview-banner')).toBeTruthy();
  });
});

// T6710: additive `renderScrubber` seam (design §4(v)/§8) — the composite
// (IntroStoryPlayer) mounts CollectionPlayer with renderScrubber={false} and
// supplies its own single bar; every OTHER existing caller (SharedCollectionView,
// RankingGame, the diag harness, and this file's other describe blocks) passes
// nothing and must keep rendering the internal segmented bar exactly as today.
describe('CollectionPlayer renderScrubber prop (T6710 — RED until Stage 4)', () => {
  const barReels = [
    { id: 1, name: 'One', streamUrl: 'a', aspect_ratio: '9:16', duration: null },
    { id: 2, name: 'Two', streamUrl: 'b', aspect_ratio: '9:16', duration: null },
  ];

  const segmentedBarRow = (container) => container.querySelector('.flex.gap-1.px-3.pt-2');

  it('default (prop unset) renders the internal segmented bar, unchanged from today', () => {
    const { container } = render(<CollectionPlayer reels={barReels} title="T" onClose={vi.fn()} />);
    expect(segmentedBarRow(container)).not.toBeNull();
  });

  it('renderScrubber={true} explicitly renders the internal segmented bar (same as default)', () => {
    const { container } = render(
      <CollectionPlayer reels={barReels} title="T" onClose={vi.fn()} renderScrubber />,
    );
    expect(segmentedBarRow(container)).not.toBeNull();
  });

  it('renderScrubber={false} suppresses the internal segmented bar entirely', () => {
    const { container } = render(
      <CollectionPlayer reels={barReels} title="T" onClose={vi.fn()} renderScrubber={false} />,
    );
    expect(segmentedBarRow(container)).toBeNull();
    // No per-reel segment buttons at all when the bar is suppressed.
    const segButtons = screen.queryAllByRole('button').filter((b) => /^(One|Two)/.test(b.getAttribute('aria-label') || ''));
    expect(segButtons).toHaveLength(0);
  });

  it('renderScrubber={false} still renders the video/content — only the bar is suppressed', () => {
    const { container } = render(
      <CollectionPlayer reels={barReels} title="T" onClose={vi.fn()} renderScrubber={false} />,
    );
    expect(container.querySelector('video')).not.toBeNull();
  });
});

// T6710 Stage 4.5 MAJOR #4: landingToken re-apply (not value-equality of
// initialIndex/initialSeekFraction) so a repeat scrub to the SAME (index,
// fraction) as a prior one is still honored -- a value-keyed guard silently
// dropped the second identical gesture.
describe('CollectionPlayer landingToken re-apply (T6710 Stage 4.5 MAJOR #4)', () => {
  const barReels = [
    { id: 1, name: 'One', streamUrl: 'a', aspect_ratio: '9:16', duration: 10 },
    { id: 2, name: 'Two', streamUrl: 'b', aspect_ratio: '9:16', duration: 6 },
  ];

  beforeEach(() => mockGoTo.mockClear());

  it('applies goTo on mount when initialSeekFraction is set', () => {
    render(
      <CollectionPlayer
        reels={barReels}
        title="T"
        onClose={vi.fn()}
        initialIndex={0}
        initialSeekFraction={0.4}
        landingToken={1}
      />,
    );
    expect(mockGoTo).toHaveBeenCalledWith(0, 0.4);
  });

  it('re-applies goTo when landingToken changes, even with the SAME (index, fraction) as before', () => {
    const { rerender } = render(
      <CollectionPlayer
        reels={barReels}
        title="T"
        onClose={vi.fn()}
        initialIndex={0}
        initialSeekFraction={0.4}
        landingToken={1}
      />,
    );
    expect(mockGoTo).toHaveBeenCalledTimes(1);

    // Same (index, fraction), but a NEW landingToken (a distinct gesture) --
    // must re-invoke goTo, not be dropped as a value-equality no-op.
    rerender(
      <CollectionPlayer
        reels={barReels}
        title="T"
        onClose={vi.fn()}
        initialIndex={0}
        initialSeekFraction={0.4}
        landingToken={2}
      />,
    );
    expect(mockGoTo).toHaveBeenCalledTimes(2);
    expect(mockGoTo).toHaveBeenLastCalledWith(0, 0.4);
  });

  it('does not re-apply goTo on a re-render with an unchanged landingToken', () => {
    const { rerender } = render(
      <CollectionPlayer
        reels={barReels}
        title="T"
        onClose={vi.fn()}
        initialIndex={0}
        initialSeekFraction={0.4}
        landingToken={1}
      />,
    );
    expect(mockGoTo).toHaveBeenCalledTimes(1);

    rerender(
      <CollectionPlayer
        reels={barReels}
        title="T"
        onClose={vi.fn()}
        initialIndex={0}
        initialSeekFraction={0.4}
        landingToken={1}
      />,
    );
    expect(mockGoTo).toHaveBeenCalledTimes(1);
  });
});

// T6710 Stage 4.5 BLOCKING #2: onProgress reports live {activeIndex,
// segmentProgress} off the existing useStoryPlayback-driven state -- no
// second rAF loop, no re-derivation.
describe('CollectionPlayer onProgress callback (T6710 Stage 4.5 BLOCKING #2)', () => {
  const barReels = [
    { id: 1, name: 'One', streamUrl: 'a', aspect_ratio: '9:16', duration: 10 },
  ];

  it('fires onProgress with the current activeIndex/segmentProgress from useStoryPlayback', () => {
    const onProgress = vi.fn();
    render(<CollectionPlayer reels={barReels} title="T" onClose={vi.fn()} onProgress={onProgress} />);
    expect(onProgress).toHaveBeenCalledWith({ activeIndex: 0, segmentProgress: 0 });
  });

  it('omitting onProgress is a safe no-op', () => {
    expect(() =>
      render(<CollectionPlayer reels={barReels} title="T" onClose={vi.fn()} />),
    ).not.toThrow();
  });
});
