import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Component, Suspense } from 'react';
import { lazyWithReload } from './lazyWithReload';

class Boundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() { return this.state.err ? <div>failed</div> : this.props.children; }
}

describe('lazyWithReload', () => {
  const reload = vi.fn();
  const realLocation = window.location;

  beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    Object.defineProperty(window, 'location', { value: { reload }, configurable: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, configurable: true });
    vi.restoreAllMocks();
  });

  const mount = () => {
    const Comp = lazyWithReload(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    render(<Boundary><Suspense fallback="loading"><Comp /></Suspense></Boundary>);
  };

  it('reloads on a stale chunk even when a reload happened earlier in this tab session', async () => {
    // Flag left behind by an earlier deploy's reload that never loaded a lazy chunk
    sessionStorage.setItem('chunk-reload', String(Date.now() - 60 * 60 * 1000));
    mount();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('does not reload-loop: a failure right after a reload surfaces the error', async () => {
    sessionStorage.setItem('chunk-reload', String(Date.now()));
    mount();
    await waitFor(() => expect(screen.getByText('failed')).toBeTruthy());
    expect(reload).not.toHaveBeenCalled();
  });
});
