import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HighlightChoiceCard } from '../modes/annotate/components/HighlightChoiceCard';
import { PlayEditorFooter } from '../modes/annotate/components/PlayEditorFooter';
import { HighlightOrientationSlots } from '../modes/annotate/components/HighlightOrientationSlots';
import { ClipListItem } from '../modes/annotate/components/ClipListItem';
import { PublishLinkFlow } from './PublishLinkFlow';
import { LinkReadyCard } from './LinkReadyCard';
import { FocusPublishActionBar } from './FocusPublishActionBar';
import { OverlayPublishActionBar } from './OverlayPublishActionBar';
import { GuideScope } from './instructions/GuideScope';
import { GUIDE_PULSE, GUIDE_PULSE_CLASS } from './instructions/guideTargets';
import { resolveGuide } from './instructions/resolveGuide';
import { useSettingsStore } from '../stores/settingsStore';
import { EXPORT_JOBS } from '../config/displayNames';

// T12760: each control a guide sentence names pulses when its screen's GuideScope targets it.
const setCoach = (coachEnabled) => useSettingsStore.setState((s) => ({
  settings: { ...s.settings, guidance: { ...s.settings.guidance, coachEnabled } },
}));
const scope = (pulse, children) => <GuideScope guides={[{ pulse }]}>{children}</GuideScope>;
const pulses = (el) => el.className.includes(GUIDE_PULSE_CLASS);

describe('T12760 gap controls pulse via GuideScope', () => {
  beforeEach(() => setCoach(true));

  it('choice card "make now" pulses for CHOICE_NOW', () => {
    render(scope(GUIDE_PULSE.CHOICE_NOW, <HighlightChoiceCard onMakeNow={vi.fn()} />));
    expect(pulses(screen.getByTestId('highlight-choice-now'))).toBe(true);
  });

  it('play editor Done pulses for PLAY_EDITOR_DONE', () => {
    render(scope(GUIDE_PULSE.PLAY_EDITOR_DONE, <PlayEditorFooter onDone={vi.fn()} onDelete={vi.fn()} />));
    expect(pulses(screen.getByTestId('play-editor-done'))).toBe(true);
  });

  it('BOTH orientation slots pulse for HIGHLIGHT_SLOT', () => {
    render(scope(GUIDE_PULSE.HIGHLIGHT_SLOT, <HighlightOrientationSlots instances={[]} onMake={vi.fn()} onOpen={vi.fn()} inline />));
    expect(pulses(screen.getByTestId('annotate-highlight-slot-portrait'))).toBe(true);
    expect(pulses(screen.getByTestId('annotate-highlight-slot-landscape'))).toBe(true);
  });

  it('a play row pulses only when handed the FIRST_PLAY target', () => {
    const region = { id: 'r1', startTime: 1, endTime: 5, rating: 4, tags: [] };
    render(scope(GUIDE_PULSE.FIRST_PLAY, <>
      <ClipListItem region={region} index={0} guideTarget={GUIDE_PULSE.FIRST_PLAY} onClick={vi.fn()} />
      <ClipListItem region={{ ...region, id: 'r2' }} index={1} onClick={vi.fn()} />
    </>));
    const [first, second] = screen.getAllByTestId('clip-row');
    expect(pulses(first)).toBe(true);
    expect(pulses(second)).toBe(false);
  });

  it('Get link pulses in the idle flow and in the link-less ready card', () => {
    const { unmount } = render(scope(GUIDE_PULSE.GET_LINK, <PublishLinkFlow phase="idle" onPublishClick={vi.fn()} />));
    expect(pulses(screen.getByTestId('finished-get-link'))).toBe(true);
    unmount();
    render(scope(GUIDE_PULSE.GET_LINK, <LinkReadyCard link={null} onGetLink={vi.fn()} />));
    expect(pulses(screen.getByTestId('finished-get-link'))).toBe(true);
  });

  it('Focus ready panel pulses Add spotlight; Overlay ready panel pulses Finish', () => {
    const { unmount } = render(scope(GUIDE_PULSE.FOCUS_ADD_SPOTLIGHT, <FocusPublishActionBar onPublish={vi.fn()} onAddSpotlight={vi.fn()} onRefocus={vi.fn()} onSaveDraft={vi.fn()} />));
    expect(pulses(screen.getByTestId('focus-choice-primary'))).toBe(true);
    unmount();
    render(scope(GUIDE_PULSE.OVERLAY_FINISH, <OverlayPublishActionBar onPublishNow={vi.fn()} onReapplyOverlay={vi.fn()} onReapplyFocus={vi.fn()} onSaveDraft={vi.fn()} />));
    expect(pulses(screen.getByTestId('overlay-choice-primary'))).toBe(true);
  });

  it('Guidance off pulses none of them', () => {
    setCoach(false);
    render(scope(GUIDE_PULSE.CHOICE_NOW, <HighlightChoiceCard onMakeNow={vi.fn()} />));
    expect(pulses(screen.getByTestId('highlight-choice-now'))).toBe(false);
  });
});

describe('T12760 failed-export copy names the real control', () => {
  it.each([
    ['focus', 'framing'],
    ['overlay', 'overlay'],
  ])('%s.failed says "Tap {action} to try again." and pulses the export CTA', (screen_, job) => {
    const g = resolveGuide({ screen: screen_, job: { status: 'failed' }, local: {} });
    expect(g.message.title).toContain(`Tap ${EXPORT_JOBS[job].action} to try again.`);
    expect(g.message.title).not.toContain('Try again.');
    expect(g.pulse).toBe(GUIDE_PULSE.EXPORT);
  });
});
