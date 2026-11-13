import { createRoot } from 'react-dom/client';
import { DraftReelPreview } from '../components/DraftReelPreview';
import { useReelPreviewStore } from '../stores/reelPreviewStore';
import { ToastContainer, toast } from '../components/shared/Toast';
import '../index.css'; // Tailwind — CollectionPlayer/ConfirmationDialog fixed/inset classes need it

/**
 * T8530 — DEV-ONLY real-browser harness for the draft preview publish surface.
 *
 * Mounts the REAL <DraftReelPreview /> (the same component App.jsx mounts
 * unconditionally at the top level) and seeds reelPreviewStore synchronously
 * BEFORE render, in the SAME module graph this entry bundles — sidestepping
 * the cross-context Zustand-module-instance mismatch that collections.spec.js
 * documents (a page.evaluate `import()` from a Playwright spec resolves a
 * SEPARATE module instance than the one the mounted app subscribes to).
 *
 * Diag params (via location.hash, read synchronously) let a spec choose the
 * payload: `#finalVideoId=999001&name=QA%20Draft` etc. Defaults are provided
 * so the harness works with zero params for the common case.
 */
// An imported app module rewrites the URL before this line runs (the hash is gone by now), so a
// spec can also pass the params as window.__T8530DIAG from an init script (cropdiag's pattern).
const params = new URLSearchParams(window.__T8530DIAG || (location.hash || '').replace(/^#/, ''));

const payload = {
  projectId: Number(params.get('projectId') || 424242),
  finalVideoId: Number(params.get('finalVideoId') || 999001),
  // T11510 check: `name=` (present but empty) exercises the no-name share fallbacks.
  name: params.has('name') ? params.get('name') : 'QA Draft Reel',
  aspectRatio: params.get('aspectRatio') || '9:16',
  clipCount: Number(params.get('clipCount') || 3),
  gameName: params.get('gameName') || 'QA Game',
  gameStartTime: null,
  // T11510 check: `alreadyPublished=1` opens the R5 'ready-capable' phase (published, no link yet).
  alreadyPublished: params.get('alreadyPublished') === '1',
};

useReelPreviewStore.getState().open(payload);

// Expose for the spec to re-open/close/inspect without a second module context.
window.__t8530Store = useReelPreviewStore;
// T11510 check: fire a toast into THIS module graph's ToastContainer (a spec's own
// import('/src/...') resolves a separate Toast store instance, see the header above).
window.__t8530Toast = toast;

function T8530DiagHarness() {
  return (
    <div style={{ minHeight: '100dvh', background: '#111827' }}>
      <DraftReelPreview />
      <ToastContainer />
    </div>
  );
}

createRoot(document.getElementById('t8530diag-root')).render(<T8530DiagHarness />);
