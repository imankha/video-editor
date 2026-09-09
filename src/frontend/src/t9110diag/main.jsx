import { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { CollectionPlayer } from '../components/collections/CollectionPlayer';
import { OverlayPublishActionBar } from '../components/OverlayPublishActionBar';
import { ToastContainer, toast } from '../components/shared/Toast';
import { FOCUS_PUBLISH_LATER_TOAST, OVERLAY_REAPPLY_FOCUS_TOAST } from '../config/displayNames';
import '../index.css'; // Tailwind — CollectionPlayer's fixed/inset classes need it

/**
 * T9110 — DEV-ONLY real-browser harness for Overlay's post-export completion
 * preview + publish-exit action bar (the Overlay sibling of t8520diag.html).
 *
 * Mounts the REAL CollectionPlayer + REAL OverlayPublishActionBar with the same
 * `actionBar` wiring OverlayScreen uses (handlePublishNow / handleReapplyOverlay
 * / handleReapplyFocus / handlePublishLater), including the REAL toasts. The
 * synthetic parts are only the premise ("an overlay export just finished", no
 * real Modal/FFmpeg render ran) and the video source (a data: URI).
 *
 * Diag params (via location.hash): `#isAutoCreated=1` selects the single-clip
 * "Publish Later" toast copy branch; omitted/0 selects multi-clip.
 */
const params = new URLSearchParams((window.__T9110_DIAG_HASH__ || location.hash || '').replace(/^#/, ''));
const isAutoCreated = params.get('isAutoCreated') === '1';
const PROJECT_ID = Number(params.get('projectId') || 424242);

function OverlayPublishExitDiagHarness() {
  const [open, setOpen] = useState(true);
  const [lastAction, setLastAction] = useState('none');

  // Mirrors OverlayScreen.handlePublishNow — the diag stops short of the real
  // publish gesture + openFinishedReel (no real final video / account here);
  // the assertable contract this harness exists to prove is the responsive
  // layout of the action bar, plus that each choice fires + closes.
  const handlePublishNow = useCallback(() => {
    setOpen(false);
    toast.success('Published', { message: 'Anyone with the link can watch it.' });
    setLastAction('publish-now');
  }, []);

  // Mirrors OverlayScreen.handleReapplyOverlay (no toast — pure return to the
  // editor). Also CollectionPlayer's onClose (X / Escape), as OverlayScreen wires.
  const handleReapplyOverlay = useCallback(() => {
    setOpen(false);
    setLastAction('reapply-overlay');
  }, []);

  // Mirrors OverlayScreen.handleReapplyFocus (verbatim toast).
  const handleReapplyFocus = useCallback(() => {
    setOpen(false);
    toast.success(OVERLAY_REAPPLY_FOCUS_TOAST.title, { message: OVERLAY_REAPPLY_FOCUS_TOAST.message });
    setLastAction('reapply-focus');
  }, []);

  // Mirrors OverlayScreen.handlePublishLater (verbatim, incl. the
  // is_auto_created-routed toast).
  const handlePublishLater = useCallback(() => {
    setOpen(false);
    const copy = isAutoCreated ? FOCUS_PUBLISH_LATER_TOAST.SINGLE_CLIP : FOCUS_PUBLISH_LATER_TOAST.MULTI_CLIP;
    toast.success(copy.title, { message: copy.message, duration: 10000 });
    setLastAction('publish-later');
  }, []);

  const reopen = useCallback(() => {
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
        Reopen
      </button>

      {open && (
        <CollectionPlayer
          reels={[{
            id: PROJECT_ID,
            name: 'QA Overlay Draft',
            streamUrl: 'data:video/mp4;base64,',
            aspect_ratio: '9:16',
            duration: null,
          }]}
          title="QA Overlay Draft"
          onClose={handleReapplyOverlay}
          actionBar={(
            <OverlayPublishActionBar
              onPublishNow={handlePublishNow}
              onReapplyOverlay={handleReapplyOverlay}
              onReapplyFocus={handleReapplyFocus}
              onPublishLater={handlePublishLater}
            />
          )}
        />
      )}
      <ToastContainer />
    </div>
  );
}

createRoot(document.getElementById('t9110diag-root')).render(<OverlayPublishExitDiagHarness />);
