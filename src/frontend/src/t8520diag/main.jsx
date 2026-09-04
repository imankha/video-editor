import { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { CollectionPlayer } from '../components/collections/CollectionPlayer';
import { FocusPublishActionBar } from '../components/FocusPublishActionBar';
import { ToastContainer, toast } from '../components/shared/Toast';
import { FOCUS_PUBLISH_LATER_TOAST } from '../config/displayNames';
import { usePublishIntentStore } from '../stores/publishIntentStore';
import { useQuestStore } from '../stores/questStore';
import '../index.css'; // Tailwind — CollectionPlayer's fixed/inset classes need it

/**
 * T8390 — DEV-ONLY real-browser harness for Focus's post-export preview +
 * publish-exit action bar (supersedes the T8520 3-button completion-choice
 * card this file used to mount — FocusScreen.jsx now shows the preview FIRST,
 * decision after; see FocusScreen.jsx's handleAddSpotlight/
 * handleAddSpotlightLater/handlePublish/handleRefocus, ~L1047-1103).
 *
 * Mounts the REAL CollectionPlayer + REAL FocusPublishActionBar with the same
 * `actionBar` wiring FocusScreen uses, including REAL
 * `useQuestStore.getState().recordAchievement(...)` calls and a REAL
 * `usePublishIntentStore` stake on Publish (Focus's one-tap-publish flag) — so
 * a Playwright spec asserting the achievement POST / flag state is asserting
 * the real gesture-handler code path, not a mock.
 *
 * Diag params (via location.hash): `#isAutoCreated=1` selects the single-clip
 * "Add Spotlight Later" toast copy branch; omitted/0 selects multi-clip.
 *
 * What's synthetic: the premise "an export just finished" (no real Focus
 * render ran) and the video source (a data: URI, no real stream). What's
 * real: CollectionPlayer, FocusPublishActionBar, Button, questStore.
 * recordAchievement's fetch, publishIntentStore.
 */
// T8390: read the hash stashed by t8520diag.html's inline script, NOT
// location.hash directly -- by the time this module's top-level code runs,
// the questStore->analytics->editorStore import chain below has already
// fired editorStore's module-scope URL canonicalization and stripped it
// (see t8520diag.html's inline script comment for the full mechanism).
const params = new URLSearchParams((window.__T8390_DIAG_HASH__ || location.hash || '').replace(/^#/, ''));
const isAutoCreated = params.get('isAutoCreated') === '1';
const PROJECT_ID = Number(params.get('projectId') || 424242);

function FocusPublishExitDiagHarness() {
  const [open, setOpen] = useState(true);
  const [lastAction, setLastAction] = useState('none');

  // Mirrors FocusScreen.jsx handleAddSpotlight (verbatim).
  const handleAddSpotlight = useCallback(() => {
    setOpen(false);
    setLastAction('add-spotlight');
  }, []);

  // Mirrors FocusScreen.jsx handleAddSpotlightLater (verbatim, incl. the
  // is_auto_created-routed toast).
  const handleAddSpotlightLater = useCallback(() => {
    setOpen(false);
    useQuestStore.getState().recordAchievement('overlay_deferred');
    const copy = isAutoCreated ? FOCUS_PUBLISH_LATER_TOAST.SINGLE_CLIP : FOCUS_PUBLISH_LATER_TOAST.MULTI_CLIP;
    toast.success(copy.title, { message: copy.message, duration: 10000 });
    setLastAction('add-spotlight-later');
  }, []);

  // Mirrors FocusScreen.jsx handlePublish (verbatim, incl. the publish-intent
  // stake; the diag stops short of the 500ms triggerExport() timer since no
  // real export button is mounted here — the flag stake is the assertable
  // contract this harness exists to prove).
  const handlePublish = useCallback(() => {
    setOpen(false);
    useQuestStore.getState().recordAchievement('overlay_declined');
    usePublishIntentStore.getState().set(PROJECT_ID);
    setLastAction('publish');
  }, []);

  // Mirrors FocusScreen.jsx handleRefocus (verbatim) — also CollectionPlayer's
  // onClose (X / Escape), same as FocusScreen wires it.
  const handleRefocus = useCallback(() => {
    setOpen(false);
    setLastAction('refocus');
  }, []);

  const reopen = useCallback(() => {
    useQuestStore.getState().recordAchievement('overlay_offered');
    setOpen(true);
    setLastAction('none');
  }, []);

  return (
    <div style={{ minHeight: '100dvh', background: '#111827' }}>
      <div
        data-testid="status"
        data-last-action={lastAction}
        data-open={open}
        style={{ position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 200, color: '#fff', fontSize: 12, padding: 4 }}
      >
        {`lastAction=${lastAction} open=${open}`}
      </div>
      <button
        type="button"
        data-testid="diag-reopen"
        onClick={reopen}
        style={{ position: 'fixed', top: 24, left: 8, zIndex: 200 }}
      >
        Reopen (fires overlay_offered)
      </button>

      {open && (
        <CollectionPlayer
          reels={[{
            id: PROJECT_ID,
            name: 'QA Focus Draft',
            streamUrl: 'data:video/mp4;base64,',
            aspect_ratio: '9:16',
            duration: null,
          }]}
          title="QA Focus Draft"
          onClose={handleRefocus}
          actionBar={(
            <FocusPublishActionBar
              onPublish={handlePublish}
              onAddSpotlight={handleAddSpotlight}
              onAddSpotlightLater={handleAddSpotlightLater}
              onRefocus={handleRefocus}
            />
          )}
        />
      )}
      <ToastContainer />
    </div>
  );
}

// Expose for the spec to inspect the publish-intent flag without a second
// module context (same technique t8530diag uses for reelPreviewStore).
window.__t8390PublishIntentStore = usePublishIntentStore;

createRoot(document.getElementById('t8520diag-root')).render(<FocusPublishExitDiagHarness />);
