import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FramedBanner } from './FramedBanner';
import { useGalleryStore } from '../stores/galleryStore';

const framed = { projectId: 7, clipName: 'Play 1' };

function setup(props = {}) {
  const handlers = { onAddSpotlight: vi.fn(), onViewInClips: vi.fn() };
  const utils = render(<FramedBanner selectedRegion={{ autoProjectId: 7 }} {...handlers} {...props} />);
  return { ...utils, ...handlers };
}

describe('FramedBanner (T11800)', () => {
  beforeEach(() => {
    useGalleryStore.setState({ justFramed: framed });
  });

  it('names the play, spends the marker, and never reappears on a remount', () => {
    const first = setup();
    expect(screen.getByText('Play 1 is framed')).toBeTruthy();
    expect(useGalleryStore.getState().justFramed).toBeNull();
    first.unmount();
    setup();
    expect(screen.queryByTestId('framed-banner')).toBeNull();
  });

  it('Add spotlight and View in Clips pass the framed project id', () => {
    const { onAddSpotlight, onViewInClips } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add spotlight' }));
    fireEvent.click(screen.getByRole('button', { name: 'View in Clips' }));
    expect(onAddSpotlight).toHaveBeenCalledWith(7);
    expect(onViewInClips).toHaveBeenCalledWith(7);
  });

  it('dismisses via the X', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('framed-banner')).toBeNull();
  });

  it('dismisses when a different play is selected, stays while selection is still empty', () => {
    const { rerender, onAddSpotlight, onViewInClips } = setup({ selectedRegion: null });
    expect(screen.getByTestId('framed-banner')).toBeTruthy();
    rerender(<FramedBanner selectedRegion={{ autoProjectId: 99 }} onAddSpotlight={onAddSpotlight} onViewInClips={onViewInClips} />);
    expect(screen.queryByTestId('framed-banner')).toBeNull();
  });

  it('renders nothing when no play was just framed', () => {
    useGalleryStore.setState({ justFramed: null });
    setup();
    expect(screen.queryByTestId('framed-banner')).toBeNull();
  });
});
