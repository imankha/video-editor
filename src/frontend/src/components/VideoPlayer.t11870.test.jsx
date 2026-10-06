/**
 * T11870: "Connecting to server..." describes a remote stream. While the player is
 * showing the local blob preview (annotate-during-upload) nothing is being fetched
 * from a server, so the buffering overlay must not render over it.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { VideoPlayer } from './VideoPlayer';

function renderPlayer(videoUrl) {
  return render(
    <VideoPlayer
      videoRef={createRef()}
      videoUrl={videoUrl}
      handlers={{}}
      isVideoElementLoading
      loadingProgress={null}
      loadingElapsedSeconds={0}
      onRetryVideo={() => {}}
    />
  );
}

describe('T11870 VideoPlayer loading overlay on a local blob source', () => {
  it('shows no "Connecting to server" overlay over a blob: preview', () => {
    renderPlayer('blob:http://localhost/abc');
    expect(screen.queryByText(/Connecting to server/i)).toBeNull();
  });

  it('still shows the overlay while a remote video loads', () => {
    renderPlayer('https://r2.example.com/game.mp4');
    expect(screen.getByText(/Connecting to server/i)).toBeTruthy();
  });
});
