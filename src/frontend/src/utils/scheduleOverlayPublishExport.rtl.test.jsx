import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { scheduleOverlayPublishExport } from './scheduleExportWhenReady';
import { usePublishIntentStore } from '../stores/publishIntentStore';

// T9740 v2 — RTL-style proof that mirrors the REAL React mount lifecycle, using
// genuine `forwardRef`/`useImperativeHandle` FakeButtons so React's actual
// attach/detach ordering runs (not synthetic `{current}` objects). This is the
// coverage the merged PR #417 fix's tests could NOT provide:
//
//   `src/screens/__tests__/focusPublishExit.test.jsx` (the first fix's test)
//   injects a SINGLE `isReady` spy that DEFAULTS TO `false` (`makeDeps().isReady
//   = vi.fn().mockReturnValue(false)`) and a SINGLE identity-free `triggerExport`
//   spy. That harness bakes in two false premises: (1) the readiness gate starts
//   CLOSED, and (2) there is only one button whose fire is indistinguishable
//   from any other. In production BOTH are false — Focus's own export button is
//   already mounted on the shared ref, so the gate starts OPEN against the WRONG
//   instance, and "which button fired" is exactly the bug. A boolean-driven,
//   single-spy harness structurally cannot express "fired the framing button
//   instead of the overlay button", so it stayed green while staging regressed.
//
// Here TWO distinct mode-scoped refs mount/unmount with `mode`, exactly as
// App.jsx now wires `focusExportButtonRef` / `overlayExportButtonRef` to
// FocusScreen / OverlayScreen. We assert the framing button's `triggerExport`
// is never called across the whole transition, then that overlay's fires once
// its video hydration lets its button mount.

const FakeButton = forwardRef(function FakeButton({ onTrigger }, ref) {
  useImperativeHandle(ref, () => ({ triggerExport: onTrigger }), [onTrigger]);
  return null;
});

function Harness({ focusSpy, overlaySpy, projectId = 9 }) {
  const [mode, setMode] = useState('framing');
  const [videoReady, setVideoReady] = useState(false);
  // Two SEPARATE refs — one per mode's button instance, never shared.
  const focusRef = useRef(null);
  const overlayRef = useRef(null);

  const handlePublish = () => {
    // Mirrors FocusScreen.handlePublish: stake the intent, flip to overlay,
    // then schedule the OVERLAY export against overlayRef specifically.
    usePublishIntentStore.getState().set(projectId);
    setMode('overlay');
    scheduleOverlayPublishExport({ overlayExportButtonRef: overlayRef, projectId });
  };

  return (
    <>
      <button onClick={handlePublish}>publish</button>
      <button onClick={() => setVideoReady(true)}>hydrate</button>
      {/* Focus's button: mounted unconditionally while in framing mode. */}
      {mode === 'framing' && <FakeButton ref={focusRef} onTrigger={focusSpy} />}
      {/* Overlay's button: mounts ONLY once its video hydration resolves,
          mirroring OverlayScreen's effectiveOverlayVideoUrl gate. */}
      {mode === 'overlay' && videoReady && <FakeButton ref={overlayRef} onTrigger={overlaySpy} />}
    </>
  );
}

describe('scheduleOverlayPublishExport — real React mount lifecycle (T9740 v2)', () => {
  beforeEach(() => { vi.useFakeTimers(); usePublishIntentStore.getState().clear(); });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    usePublishIntentStore.getState().clear();
  });

  it('never triggers the framing button through the mode transition; fires the overlay button exactly once it mounts', () => {
    const focusSpy = vi.fn();
    const overlaySpy = vi.fn();
    render(<Harness focusSpy={focusSpy} overlaySpy={overlaySpy} projectId={9} />);

    // Click Publish. At this instant React has NOT yet unmounted the framing
    // button — its ref is non-null — but we polled overlayRef (null) so the
    // synchronous tick-zero cannot fire the framing button.
    act(() => { fireEvent.click(screen.getByText('publish')); });

    // Overlay's button hasn't mounted yet (videoReady still false). Advance well
    // past the old 500ms window — the framing button must stay untouched.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(focusSpy).not.toHaveBeenCalled();
    expect(overlaySpy).not.toHaveBeenCalled();

    // Video hydration resolves -> overlay's export button mounts -> its ref
    // attaches via useImperativeHandle -> the next poll tick fires it once.
    act(() => { fireEvent.click(screen.getByText('hydrate')); });
    act(() => { vi.advanceTimersByTime(150); });

    expect(overlaySpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).not.toHaveBeenCalled();
  });
});
