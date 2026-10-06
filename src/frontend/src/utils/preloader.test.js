import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dismissPreloader } from './preloader';

// T11830: the preloader must never say "Ready" while still covering the page, and
// removal must not depend on anything that can stall (throttled timers, no transition).

function mkPreloader() {
  const el = document.createElement('div');
  el.id = 'preloader';
  el.innerHTML = '<div id="preloader-status">Loading</div>';
  document.body.appendChild(el);
  return el;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('dismissPreloader', () => {
  it('adds fade-out immediately and never writes "Ready"', () => {
    const el = mkPreloader();
    dismissPreloader(el);
    expect(el.classList.contains('fade-out')).toBe(true);
    expect(document.body.textContent).not.toContain('Ready');
    expect(el.isConnected).toBe(true);
  });

  it('removes the element on transitionend', () => {
    const el = mkPreloader();
    dismissPreloader(el);
    el.dispatchEvent(new Event('transitionend'));
    expect(el.isConnected).toBe(false);
  });

  it('removes the element after a 500ms fallback when no transition fires', () => {
    const el = mkPreloader();
    dismissPreloader(el);
    vi.advanceTimersByTime(499);
    expect(el.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.isConnected).toBe(false);
  });

  it('is a no-op when the preloader is already gone', () => {
    expect(() => dismissPreloader(null)).not.toThrow();
  });
});
