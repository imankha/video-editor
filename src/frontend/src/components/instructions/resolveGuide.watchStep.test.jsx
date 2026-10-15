import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { resolveGuide } from './resolveGuide';
import { GuideScope } from './GuideScope';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from './guideTargets';
import { AnnotateControls } from '../../modes/annotate/components/AnnotateControls';
import { useSettingsStore } from '../../stores/settingsStore';

// Staging 2026-10-14: "Tap Play to watch the game ... tap Mark play." pulsed only Mark play, and
// its keepClear was the whole Annotate stage, so the timeline and the other action cards stayed
// bright. The sentence names Play too, and only the video and its controls should stay unshaded.
const watch = resolveGuide({ screen: 'annotate', progress: {}, local: { playCount: 0 } });
const noop = () => {};
const controls = { isPlaying: false, currentTime: 0, duration: 60, onTogglePlay: noop, onStepForward: noop, onStepBackward: noop, onSeekBackward: noop, onRestart: noop, onSpeedChange: noop, onToggleFullscreen: noop };

beforeEach(() => useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } }));
afterEach(() => { cleanup(); useSettingsStore.getState().reset(); });

describe('Annotate watch step', () => {
  it('pulses both Play and Mark play', () => {
    expect(watch.id).toBe('annotate.progress.watch');
    expect([watch.pulse].flat()).toEqual(expect.arrayContaining([GUIDE_PULSE.ANNOTATE_PLAY, GUIDE_PULSE.MARK_PLAY]));
  });

  it('keeps only the video and its controls clear, not the whole stage (timeline and other cards shade)', () => {
    expect(watch.keepClear).not.toContain('[data-testid="annotate-coach-stage"]');
    expect(watch.keepClear).toEqual(expect.arrayContaining(['[data-testid="annotate-coach-stage"] video', '[data-testid="annotate-controls"]']));
  });

  it('the Annotate Play button pulses inside the watch scope, and not while playing', () => {
    render(<GuideScope guides={[watch]}><AnnotateControls {...controls} /></GuideScope>);
    expect(screen.getByTestId('annotate-play-button').className).toContain(GUIDE_PULSE_CLASS);
    expect(screen.getByTestId('annotate-controls')).toBeTruthy();
    cleanup();
    render(<GuideScope guides={[watch]}><AnnotateControls {...controls} isPlaying /></GuideScope>);
    expect(screen.getByTestId('annotate-play-button').className).not.toContain(GUIDE_PULSE_CLASS);
  });
});
