/**
 * T9510: A transient "Unable to play media" must not be exposed to assistive
 * technology during a normal load. Chromium announces that native string when a
 * <video>'s computed accessible NAME flips (MediaError momentarily set / the
 * hard-reset drives the element through NETWORK_NO_SOURCE) during the T5620
 * format-error retry race. Our app-level `error` store stays null on that
 * transient path, so the fix is entirely in the view's ARIA contract:
 *
 *   1. A stable author-supplied `aria-label` on the <video> overrides Blink's
 *      computed fallback name, so the name never flips to "Unable to play media".
 *      `aria-busy` tracks the existing `isVideoElementLoading` flag that brackets
 *      the whole transient window.
 *   2. An ESTABLISHED failure (our `error` is truthy — only set after retries are
 *      exhausted) announces ONCE via a role="alert" / aria-live="assertive"
 *      region, so a genuine failure is still surfaced (no over-suppression).
 *
 * NOTE: jsdom has no media pipeline (no MediaError, no Blink AX name), so this
 * suite is a regression guard on the ARIA ATTRIBUTES only. It cannot prove the
 * native announcement is actually gone -- real NVDA/Chrome verification on the
 * repro is owed (see task STAGING handoff).
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

describe('T9510 VideoPlayer accessibility during load / error', () => {
  it('gives the <video> a stable aria-label and marks it aria-busy while loading', () => {
    const { container } = renderPlayer({
      videoUrl: 'https://r2.example.com/games/ok.mp4?sig=x',
      isVideoElementLoading: true,
      error: null,
    });
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video.getAttribute('aria-label')).toBeTruthy();
    expect(video.getAttribute('aria-busy')).toBe('true');
  });

  it('clears aria-busy once the element is no longer loading', () => {
    const { container } = renderPlayer({
      videoUrl: 'https://r2.example.com/games/ok.mp4?sig=x',
      isVideoElementLoading: false,
      error: null,
    });
    const video = container.querySelector('video');
    expect(video.getAttribute('aria-busy')).toBe('false');
  });

  it('does NOT expose any alert to AT during a normal load (no established error)', () => {
    renderPlayer({
      videoUrl: 'https://r2.example.com/games/ok.mp4?sig=x',
      isVideoElementLoading: true,
      error: null,
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces an established failure once via an assertive alert region (with videoUrl)', () => {
    renderPlayer({
      videoUrl: 'https://r2.example.com/games/ok.mp4?sig=x',
      error: 'Video format not supported.',
    });
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toContain('Video format not supported.');
  });

  it('announces an established failure via an alert region when no videoUrl is present', () => {
    renderPlayer({
      videoUrl: null,
      error: 'This video is no longer available. Its source storage may have expired.',
    });
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toContain('no longer available');
  });
});
