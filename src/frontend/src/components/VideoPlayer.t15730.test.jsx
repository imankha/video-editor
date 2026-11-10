/**
 * T15730: when the source game video is still uploading (backend 409
 * source_uploading), VideoPlayer must render a deliberate "still uploading"
 * panel INSTEAD of mounting a <video> against a dead URL -- same rationale as
 * T8310's isSourceExpired (avoids the "Video format not supported" banner,
 * bug 50p). Pins that isSourceUploading wins even when a (stale) videoUrl is
 * still present, and that it never collides with the expired panel.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { VideoPlayer } from './VideoPlayer';

function renderPlayer(props) {
  return render(
    <VideoPlayer
      videoRef={createRef()}
      handlers={{}}
      onRetryVideo={() => {}}
      {...props}
    />
  );
}

describe('T15730 VideoPlayer source-uploading state', () => {
  it('renders the uploading panel (not a video) even when a stale videoUrl is present', () => {
    const { container } = renderPlayer({
      videoUrl: 'https://r2.example.com/games/pending.mp4?sig=x',
      isSourceUploading: true,
    });
    expect(screen.getByTestId('source-uploading-panel')).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });

  it('does not render the uploading panel for a healthy clip', () => {
    renderPlayer({ videoUrl: 'https://r2.example.com/games/ok.mp4?sig=x', isSourceUploading: false });
    expect(screen.queryByTestId('source-uploading-panel')).toBeNull();
  });

  it('prefers the expired panel over the uploading panel if somehow both are set', () => {
    renderPlayer({ videoUrl: null, isSourceExpired: true, isSourceUploading: true });
    expect(screen.getByTestId('source-expired-panel')).toBeTruthy();
    expect(screen.queryByTestId('source-uploading-panel')).toBeNull();
  });
});
