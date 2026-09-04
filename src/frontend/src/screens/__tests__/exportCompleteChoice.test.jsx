import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState, useCallback } from 'react';
import { Sparkles } from 'lucide-react';
import { ConfirmationDialog, OverlayEffectIllustration } from '../../components/shared';

// T8520: FocusScreen is a very large screen that cannot be mounted in isolation
// (dozens of stores/hooks/contexts). This test harness reproduces the completion
// choice card exactly as FocusScreen renders it, plus the three gesture handlers
// verbatim, wired to injectable spies. It asserts the WIRING CONTRACT: which store
// call and navigation each button fires, and that the render trigger is deferred.
// The card render (labels, no "skip", illustration) is real.

vi.mock('../../utils/uiTelemetry', () => ({ recordUiImpression: vi.fn() }));

/**
 * Mirrors FocusScreen's post-export completion choice. `deps` injects the same
 * store actions FocusScreen calls through getState(), so we can spy on them.
 */
function ExportCompleteChoiceHarness({ deps, startOpen = false }) {
  const { setEditorMode, recordAchievement, goToProjectManager, triggerExport } = deps;
  const [showExportCompleteChoice, setShowExportCompleteChoice] = useState(startOpen);

  // The gesture-driven completion callback (export finished).
  const onExportComplete = useCallback(() => {
    setShowExportCompleteChoice(true);
    recordAchievement('overlay_offered');
  }, [recordAchievement]);

  const handleAddSpotlight = useCallback(() => {
    setShowExportCompleteChoice(false);
    setEditorMode('overlay');
  }, [setEditorMode]);

  const handleAddSpotlightLater = useCallback(() => {
    setShowExportCompleteChoice(false);
    recordAchievement('overlay_deferred');
    goToProjectManager();
  }, [recordAchievement, goToProjectManager]);

  const handleFinishNow = useCallback(() => {
    setShowExportCompleteChoice(false);
    recordAchievement('overlay_declined');
    setEditorMode('overlay');
    setTimeout(() => triggerExport(), 500);
  }, [recordAchievement, setEditorMode, triggerExport]);

  return (
    <>
      <button onClick={onExportComplete}>fire-export-complete</button>
      <ConfirmationDialog
        isOpen={showExportCompleteChoice}
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
    </>
  );
}

function makeDeps() {
  return {
    setEditorMode: vi.fn(),
    recordAchievement: vi.fn(),
    goToProjectManager: vi.fn(),
    triggerExport: vi.fn(),
  };
}

describe('T8520 completion choice card', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('on completion: shows the card, records overlay_offered once, and does NOT switch editorMode', () => {
    const deps = makeDeps();
    render(<ExportCompleteChoiceHarness deps={deps} />);

    expect(screen.queryByTestId('export-complete-choice')).toBeNull();

    fireEvent.click(screen.getByText('fire-export-complete'));

    expect(screen.getByTestId('export-complete-choice')).toBeTruthy();
    expect(deps.recordAchievement).toHaveBeenCalledTimes(1);
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_offered');
    expect(deps.setEditorMode).not.toHaveBeenCalled();
  });

  it('renders the three exact labels and contains no "skip" text', () => {
    const deps = makeDeps();
    render(<ExportCompleteChoiceHarness deps={deps} startOpen />);

    expect(screen.getByText('Add Spotlight')).toBeTruthy();
    expect(screen.getByText('Add Spotlight Later')).toBeTruthy();
    expect(screen.getByText('Finish Now')).toBeTruthy();

    const panel = screen.getByTestId('export-complete-choice');
    expect(panel.textContent.toLowerCase()).not.toContain('skip');
  });

  it('"Add Spotlight" switches to overlay mode and fires no deferred/declined event', () => {
    const deps = makeDeps();
    render(<ExportCompleteChoiceHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByText('Add Spotlight'));

    expect(deps.setEditorMode).toHaveBeenCalledWith('overlay');
    expect(deps.recordAchievement).not.toHaveBeenCalled();
    expect(deps.goToProjectManager).not.toHaveBeenCalled();
    expect(deps.triggerExport).not.toHaveBeenCalled();
  });

  it('"Add Spotlight Later" records overlay_deferred once and navigates home; no render', () => {
    const deps = makeDeps();
    render(<ExportCompleteChoiceHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByText('Add Spotlight Later'));

    expect(deps.recordAchievement).toHaveBeenCalledTimes(1);
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_deferred');
    expect(deps.goToProjectManager).toHaveBeenCalledTimes(1);
    expect(deps.setEditorMode).not.toHaveBeenCalled();
    expect(deps.triggerExport).not.toHaveBeenCalled();
  });

  it('the X / onClose maps to "Add Spotlight Later" (defer + navigate home)', () => {
    const deps = makeDeps();
    render(<ExportCompleteChoiceHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByLabelText('Close dialog'));

    expect(deps.recordAchievement).toHaveBeenCalledTimes(1);
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_deferred');
    expect(deps.goToProjectManager).toHaveBeenCalledTimes(1);
    expect(deps.triggerExport).not.toHaveBeenCalled();
  });

  it('"Finish Now" records overlay_declined, switches to overlay, and triggers the render after the timer', () => {
    const deps = makeDeps();
    render(<ExportCompleteChoiceHarness deps={deps} startOpen />);

    fireEvent.click(screen.getByText('Finish Now'));

    expect(deps.recordAchievement).toHaveBeenCalledTimes(1);
    expect(deps.recordAchievement).toHaveBeenCalledWith('overlay_declined');
    expect(deps.setEditorMode).toHaveBeenCalledWith('overlay');
    // Render is deferred until the overlay export button mounts.
    expect(deps.triggerExport).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(deps.triggerExport).toHaveBeenCalledTimes(1);
  });
});
