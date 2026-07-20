/**
 * T5440: the missing-working-video state must read as "re-export", not "try again".
 *
 * VideoPlayer gates the "Retry Loading Video" button on isUrlExpiredError(). For a
 * hard 404 (asset genuinely gone) OverlayScreen passes isUrlExpiredError=() => false,
 * so the error message shows WITHOUT a retry button. A transient load error passes
 * () => true and still offers retry. This pins that contract.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { VideoPlayer } from './VideoPlayer';

const MISSING_MSG = 'This reel’s video is no longer available. Re-export to rebuild it.';

function renderPlayer(props) {
  return render(
    <VideoPlayer
      videoRef={createRef()}
      videoUrl={null}
      handlers={{}}
      onRetryVideo={() => {}}
      {...props}
    />
  );
}

describe('T5440 VideoPlayer missing-asset state', () => {
  it('shows the message but NO retry button when the asset is missing (isUrlExpiredError false)', () => {
    renderPlayer({ error: MISSING_MSG, isUrlExpiredError: () => false });
    // getByText throws if the message is absent — so this asserts it renders.
    expect(screen.getByText(MISSING_MSG)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry Loading Video/i })).toBeNull();
  });

  it('still offers retry for a transient load error (isUrlExpiredError true)', () => {
    renderPlayer({ error: 'Working video load failed', isUrlExpiredError: () => true });
    expect(screen.getByRole('button', { name: /Retry Loading Video/i })).toBeTruthy();
  });
});
