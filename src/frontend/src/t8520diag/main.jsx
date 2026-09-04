import { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmationDialog, OverlayEffectIllustration } from '../components/shared';
import { Sparkles } from 'lucide-react';
import { useQuestStore } from '../stores/questStore';
import '../index.css'; // Tailwind — ConfirmationDialog's fixed/inset classes need it

/**
 * T8520 — DEV-ONLY real-browser harness for the export-complete choice card.
 *
 * Reproduces the exact card FocusScreen renders (FocusScreen.jsx:1296-1311):
 * same ConfirmationDialog props, same panelTestId ("export-complete-choice"),
 * same three buttons in the same order, same onClose semantics (maps to
 * "Add Spotlight Later", never a silent dismiss), and the SAME
 * `useQuestStore.getState().recordAchievement(...)` calls FocusScreen's real
 * handlers make — so a Playwright spec asserting the achievement POST fires
 * is asserting the real gesture-to-network path, not a mock.
 *
 * What's synthetic: the premise "an export just finished" (no real Focus
 * render ran). What's real: ConfirmationDialog, OverlayEffectIllustration,
 * Button, and questStore.recordAchievement's fetch to
 * POST /api/quests/achievements/{key}.
 */
function ExportCompleteChoiceDiagHarness() {
  const [open, setOpen] = useState(true);
  const [lastAction, setLastAction] = useState('none');

  // Mirrors FocusScreen.jsx handleAddSpotlight/handleAddSpotlightLater/handleFinishNow.
  const handleAddSpotlight = useCallback(() => {
    setOpen(false);
    setLastAction('add-spotlight');
  }, []);

  const handleAddSpotlightLater = useCallback(() => {
    setOpen(false);
    useQuestStore.getState().recordAchievement('overlay_deferred');
    setLastAction('add-spotlight-later');
  }, []);

  const handleFinishNow = useCallback(() => {
    setOpen(false);
    useQuestStore.getState().recordAchievement('overlay_declined');
    setLastAction('finish-now');
  }, []);

  // Mirrors FocusScreen's export-complete callback firing overlay_offered once,
  // available via a reset button so a spec can re-arm the card between paths.
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

      {/* Primary ("Add Spotlight") is LAST so the footer's flex-col-reverse puts
          it lowest on mobile / rightmost on desktop — identical to
          FocusScreen.jsx:1306-1310. */}
      <ConfirmationDialog
        isOpen={open}
        panelTestId="export-complete-choice"
        title="Your reel is exported"
        illustration={<OverlayEffectIllustration />}
        message={"Add a spotlight overlay? Optional - it draws a glowing highlight around your athlete and can add text on the video."}
        onClose={handleAddSpotlightLater}
        buttons={[
          { label: 'Add Spotlight Later', variant: 'secondary', onClick: handleAddSpotlightLater },
          { label: 'Finish Now', variant: 'secondary', onClick: handleFinishNow },
          { label: 'Add Spotlight', variant: 'cyan', icon: Sparkles, onClick: handleAddSpotlight },
        ]}
      />
    </div>
  );
}

createRoot(document.getElementById('t8520diag-root')).render(<ExportCompleteChoiceDiagHarness />);
