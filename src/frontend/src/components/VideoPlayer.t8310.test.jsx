/**
 * T8310: when the source game video was reclaimed (backend 410 source_expired),
 * VideoPlayer must render the deliberate expired panel INSTEAD of mounting a
 * <video> against a dead URL — that is what avoids the "format not supported"
 * banner + retry loop (bug 50p). Pins that isSourceExpired wins even when a
 * (stale) videoUrl is still present, and forwards canExtendSource to the panel.
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

describe('T8310 VideoPlayer source-expired state', () => {
  it('renders the expired panel (not a video) even when a stale videoUrl is present', () => {
    const { container } = renderPlayer({
      videoUrl: 'https://r2.example.com/games/gone.mp4?sig=x',
      isSourceExpired: true,
      canExtendSource: false,
    });
    expect(screen.getByTestId('source-expired-panel')).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
  });

  it('forwards canExtendSource so the Extend affordance appears when extendable', () => {
    renderPlayer({ videoUrl: null, isSourceExpired: true, canExtendSource: true });
    expect(screen.getByTestId('source-expired-extend')).toBeTruthy();
  });

  it('does not render the panel for a healthy clip', () => {
    renderPlayer({ videoUrl: 'https://r2.example.com/games/ok.mp4?sig=x', isSourceExpired: false });
    expect(screen.queryByTestId('source-expired-panel')).toBeNull();
  });
});
