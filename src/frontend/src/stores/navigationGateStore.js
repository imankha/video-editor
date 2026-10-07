import { create } from 'zustand';

// Leaving Annotate for Focus/Overlay starts its progress writes immediately and in
// parallel with the editor's loads. `track(promise)` raises the handoff gate;
// NavigationGateOverlay blocks input only while Annotate is still active, so slow
// game progress saves never lock the destination editor. The writes swallow their
// own errors, so they always settle;
// the timeout is only a backstop so a hung request can never lock the UI.
export const NAVIGATION_GATE_TIMEOUT_MS = 8000;

export const useNavigationGateStore = create((set, get) => ({
  pending: 0,

  track: (promise) => {
    set({ pending: get().pending + 1 });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      set({ pending: Math.max(0, get().pending - 1) });
    };
    const timer = setTimeout(() => {
      console.warn('[navigationGate] writes still pending after timeout; releasing the gate');
      release();
    }, NAVIGATION_GATE_TIMEOUT_MS);
    Promise.resolve(promise).then(release, release);
    return promise;
  },
}));
