/**
 * T10800: when `fitToAspect` is set (the parent is an aspect-sized stage box),
 * VideoPlayer's picture-less states (loading / error / empty) must FILL the
 * parent (`h-full`) instead of imposing their own fixed `h-[40vh] sm:h-[60vh]`
 * height — otherwise the box would jump when the video element finally paints.
 * Without `fitToAspect` the states are unchanged (Focus/Annotate legacy path).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { VideoPlayer } from './VideoPlayer';

function renderPlayer(props) {
  return render(
    <VideoPlayer videoRef={createRef()} handlers={{}} onRetryVideo={() => {}} {...props} />
  );
}

// The flex state wrapper is the nearest ancestor carrying the height class.
const stateBox = (node) => node.closest('div.flex');

describe('T10800 VideoPlayer picture-less states honor fitToAspect', () => {
  describe('empty state (no url, no error, no loading)', () => {
    it('fills the parent when fitToAspect', () => {
      renderPlayer({ videoUrl: null, isLoading: false, error: null, fitToAspect: true });
      const box = stateBox(screen.getByText(/no video loaded/i));
      expect(box.className).toContain('h-full');
      expect(box.className).not.toContain('h-[40vh]');
    });
    it('keeps the fixed box without fitToAspect', () => {
      renderPlayer({ videoUrl: null, isLoading: false, error: null, fitToAspect: false });
      const box = stateBox(screen.getByText(/no video loaded/i));
      expect(box.className).toContain('h-[40vh]');
      expect(box.className).toContain('sm:h-[60vh]');
    });
  });

  describe('loading state', () => {
    it('fills the parent when fitToAspect', () => {
      renderPlayer({ videoUrl: null, isLoading: true, error: null, fitToAspect: true, loadingMessage: 'Loading video...' });
      const box = stateBox(screen.getByText(/loading video/i));
      expect(box.className).toContain('h-full');
      expect(box.className).not.toContain('h-[40vh]');
    });
    it('keeps the fixed box without fitToAspect', () => {
      renderPlayer({ videoUrl: null, isLoading: true, error: null, fitToAspect: false, loadingMessage: 'Loading video...' });
      const box = stateBox(screen.getByText(/loading video/i));
      expect(box.className).toContain('h-[40vh]');
    });
  });

  describe('error state (no url)', () => {
    it('fills the parent when fitToAspect', () => {
      renderPlayer({ videoUrl: null, isLoading: false, error: 'boom', fitToAspect: true });
      const box = stateBox(screen.getByText(/video failed to load/i));
      expect(box.className).toContain('h-full');
      expect(box.className).not.toContain('h-[40vh]');
    });
    it('keeps the fixed box without fitToAspect', () => {
      renderPlayer({ videoUrl: null, isLoading: false, error: 'boom', fitToAspect: false });
      const box = stateBox(screen.getByText(/video failed to load/i));
      expect(box.className).toContain('h-[40vh]');
    });
  });
});
