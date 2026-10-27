import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createRef } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { useVideoStore } from '../stores';

afterEach(() => { cleanup(); useVideoStore.setState({ isPlaying: false, isBuffering: false, isWaitingForData: false }); });

describe('VideoPlayer spinner while Play waits on data (T13700:C4)', () => {
  const renderPlayer = () => render(<VideoPlayer videoRef={createRef()} handlers={{}} onRetryVideo={() => {}} videoUrl="https://x/v.mp4" />);

  it('shows when playing and waiting for data even though isBuffering is false', () => {
    useVideoStore.setState({ isPlaying: true, isBuffering: false, isWaitingForData: true, isVideoElementLoading: false });
    renderPlayer();
    expect(screen.getByTestId('buffering-spinner')).toBeTruthy();
  });

  it('is absent when nothing is waiting', () => {
    useVideoStore.setState({ isPlaying: true, isBuffering: false, isWaitingForData: false, isVideoElementLoading: false });
    renderPlayer();
    expect(screen.queryByTestId('buffering-spinner')).toBeNull();
  });
});
