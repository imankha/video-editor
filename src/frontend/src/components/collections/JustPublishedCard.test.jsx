import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { JustPublishedCard } from './JustPublishedCard';

const makeCollections = ({ members = {}, memberStates = {}, fetchMembers = vi.fn() } = {}) => ({
  members,
  memberStates,
  fetchMembers,
});

const baseProps = {
  justPublished: { finalVideoId: 501, gameId: 7, aspectRatio: '9:16' },
  onDismiss: vi.fn(),
  buildPosterUrl: (id) => `poster/${id}`,
  onPlay: vi.fn(),
  onShare: vi.fn(),
  onCopyLink: vi.fn(),
  onDownload: vi.fn(),
  formatMeta: () => '2 days ago · 0:32',
};

const highlight = { id: 501, project_name: 'Great Save', game_names: ['Vs Alpha'], aspect_ratio: '9:16' };

describe('JustPublishedCard (T11580)', () => {
  it('renders nothing while the member fetch has not resolved the highlight yet', () => {
    const collections = makeCollections({ members: {}, memberStates: { 'game:7': 'loading' } });
    const { container } = render(<JustPublishedCard {...baseProps} collections={collections} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the highlight is no longer in the published set (missing-highlight spec)', () => {
    const collections = makeCollections({ members: { 'game:7': [] }, memberStates: { 'game:7': 'ready' } });
    const { container } = render(<JustPublishedCard {...baseProps} collections={collections} />);
    expect(container.firstChild).toBeNull();
  });

  it('fetches the game members lazily via the cached/lazy member fetch', () => {
    const fetchMembers = vi.fn();
    const collections = makeCollections({ members: {}, memberStates: {}, fetchMembers });
    render(<JustPublishedCard {...baseProps} collections={collections} />);
    expect(fetchMembers).toHaveBeenCalledWith({ key: 'game:7', query: 'game_id=7' });
  });

  it('targets the mixes key when gameId is null (multi-game highlight)', () => {
    const fetchMembers = vi.fn();
    const collections = makeCollections({ members: {}, memberStates: {}, fetchMembers });
    render(
      <JustPublishedCard
        {...baseProps}
        justPublished={{ finalVideoId: 501, gameId: null, aspectRatio: '16:9' }}
        collections={collections}
      />,
    );
    expect(fetchMembers).toHaveBeenCalledWith({ key: 'mixes', query: 'mixes=true' });
  });

  it('renders the resolved highlight: title, game/meta line, and the "Just published" pill', () => {
    const collections = makeCollections({ members: { 'game:7': [highlight] }, memberStates: { 'game:7': 'ready' } });
    render(<JustPublishedCard {...baseProps} collections={collections} />);
    expect(screen.getByText('Great Save')).toBeTruthy();
    expect(screen.getByText(/Vs Alpha/)).toBeTruthy();
    expect(screen.getByText('Just published')).toBeTruthy();
  });

  it('dismiss (X) calls onDismiss', () => {
    const onDismiss = vi.fn();
    const collections = makeCollections({ members: { 'game:7': [highlight] }, memberStates: { 'game:7': 'ready' } });
    render(<JustPublishedCard {...baseProps} collections={collections} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Share is wired as the primary action and calls onShare with the resolved download', () => {
    const onShare = vi.fn();
    const collections = makeCollections({ members: { 'game:7': [highlight] }, memberStates: { 'game:7': 'ready' } });
    render(<JustPublishedCard {...baseProps} collections={collections} onShare={onShare} />);
    fireEvent.click(screen.getByTestId('just-published-share'));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onShare.mock.calls[0][1]).toEqual(highlight);
  });

  it('Copy link and Download call their respective handlers with the resolved download', () => {
    const onCopyLink = vi.fn();
    const onDownload = vi.fn();
    const collections = makeCollections({ members: { 'game:7': [highlight] }, memberStates: { 'game:7': 'ready' } });
    render(<JustPublishedCard {...baseProps} collections={collections} onCopyLink={onCopyLink} onDownload={onDownload} />);
    fireEvent.click(screen.getByLabelText('Copy link'));
    fireEvent.click(screen.getByLabelText('Download'));
    expect(onCopyLink.mock.calls[0][1]).toEqual(highlight);
    expect(onDownload.mock.calls[0][1]).toEqual(highlight);
  });

  it('tapping the poster calls onPlay with the resolved download', () => {
    const onPlay = vi.fn();
    const collections = makeCollections({ members: { 'game:7': [highlight] }, memberStates: { 'game:7': 'ready' } });
    render(<JustPublishedCard {...baseProps} collections={collections} onPlay={onPlay} />);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(onPlay.mock.calls[0][1]).toEqual(highlight);
  });
});
