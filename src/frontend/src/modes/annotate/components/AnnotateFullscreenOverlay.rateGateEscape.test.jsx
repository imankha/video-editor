import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { RateThisPlayModal } from './RateThisPlayModal';

/**
 * T11120 (reviewer MINOR, now proven end-to-end): while the "Rate this play" gate
 * is open, Escape must mean ONLY "dismiss the gate" — it must not also reach the
 * fullscreen editor's own Escape handler and discard/close the editor.
 *
 * The container/AnnotateContainer.rateGate.test.jsx already covers the container's
 * document-level fullscreen-exit Escape via stopPropagation. This test exercises
 * the OTHER competing listener: the RateThisPlayModal's capture-phase document
 * handler (stopImmediatePropagation) vs the real AnnotateFullscreenOverlay's
 * window-level Escape handler, mounted TOGETHER (the modal really portals over the
 * live overlay), rather than proving each in isolation. Escape is dispatched on
 * `document` so it reaches BOTH the modal's document listener AND, absent the stop,
 * the overlay's window listener (a window-dispatched event skips document listeners
 * in jsdom — see AnnotateFullscreenOverlay.keys.test.jsx T10590).
 *
 * Expect: the gate dismisses (onDismiss), nothing is written (no onUpdateClip PUT,
 * no onPick), and the editor stays open (onClose never fires -> no fullscreen exit).
 */

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

// Unrated play — the exact state the gate guards.
const existingClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: null, tags: [], my_athlete: true,
  name: 'My cool play', notes: '', tagged_teammates: [],
};

beforeEach(() => mockViewport(false));

describe('Rate gate Escape ordering over the live fullscreen editor (T11120)', () => {
  it('Escape while the gate is open dismisses the gate ONLY — no write, editor stays open', () => {
    const onClose = vi.fn();
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    const onDismiss = vi.fn();
    const onPick = vi.fn();

    render(
      <>
        <AnnotateFullscreenOverlay
          isVisible
          currentTime={30}
          videoDuration={6000}
          existingClip={existingClip}
          onUpdateClip={onUpdateClip}
          onClose={onClose}
          onSeek={() => {}}
          videoController={{}}
          onDeleteClip={() => {}}
          layout="strip"
        />
        <RateThisPlayModal onPick={onPick} onDismiss={onDismiss} isMobile={false} rating={null} />
      </>
    );

    // The gate is really mounted over the editor.
    expect(screen.getByTestId('rate-gate-modal')).toBeTruthy();

    // Dispatch on `document` so both the modal's (document, capture) handler and
    // the overlay's (window, bubble) handler are on the path; the modal's
    // stopImmediatePropagation must win order-independently.
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onDismiss).toHaveBeenCalledTimes(1); // gate closed
    expect(onClose).not.toHaveBeenCalled();     // editor stayed open (no fullscreen exit)
    expect(onUpdateClip).not.toHaveBeenCalled(); // nothing written
    expect(onPick).not.toHaveBeenCalled();       // no rating picked
  });
});
