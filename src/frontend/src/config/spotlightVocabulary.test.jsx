// T14630: Spotlight copy follows the copy glossary (.claude/references/copy-glossary.md).
// The circle on the athlete is always "spotlight": never a highlight, region, layer, ellipse
// or player box. "highlight" stays the finished video, "cover" the still shown before play.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as names from './displayNames';
import { describeHighlightCarryNote } from '../utils/highlightCarryNote';
import FocusSettingsPanel from '../components/settings/FocusSettingsPanel';
import OverlaySpotlightPanel from '../components/settings/OverlaySpotlightPanel';
import ThumbnailPanel from '../components/overlay/ThumbnailPanel';
import PositionPresetGrid from '../components/overlay/PositionPresetGrid';
import { useOverlayActionStore } from '../stores/overlayActionStore';
import { useToastStore } from '../components/shared/Toast';

vi.mock('../components/VideoPlayer', () => ({ VideoPlayer: () => <div /> }));
vi.mock('../components/Controls', () => ({ Controls: () => <div /> }));
vi.mock('../components/ZoomControls', () => ({ default: () => <div /> }));
vi.mock('../components/ExportButtonView', () => ({ default: () => <div /> }));
vi.mock('../containers/ExportButtonContainer', () => ({
  ExportButtonContainer: () => ({}), HIGHLIGHT_EFFECT_LABELS: {}, EXPORT_CONFIG: {},
}));
vi.mock('../components/PosterFramePreview', () => ({ default: () => <div /> }));
vi.mock('../modes/overlay', () => ({
  OverlayMode: () => <div />, HighlightOverlay: () => <div />, PlayerDetectionOverlay: () => <div />,
}));
vi.mock('../hooks/useFullscreenControls', () => ({
  useFullscreenControls: () => ({
    isVisible: true, handleInteraction: () => {}, handleLongPressTouchStart: () => {},
    handleLongPressTouchMove: () => {}, handleLongPressTouchEnd: () => {},
  }),
}));
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false, useIsLandscape: () => false, useIsPhonePortrait: () => false,
  useIsSmallPhoneViewport: () => false,
}));

import { OverlayModeView } from '../modes/OverlayModeView';

const { EDITOR_PANELS, GUIDE, MODE_SWITCHER_LOCKED, STAGE_REASONS } = names;

afterEach(cleanup);

const source = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const renderView = (overrides = {}) => render(
  <OverlayModeView
    videoRef={{ current: null }}
    effectiveOverlayVideoUrl={null}
    effectiveOverlayMetadata={null}
    isFullscreen={false}
    handlers={{}}
    highlightRegions={[]}
    highlightBoundaries={[]}
    highlightRegionKeyframes={[]}
    getTimelineScale={() => 1}
    getRegionsForExport={() => []}
    framingVideoUrl="blob:framing"
    hasFramingEdits
    hasMultipleClips={false}
    {...overrides}
  />,
);

// Every phrase is one the audit found on screen; each file must no longer ship it.
const RETIRED = {
  'modes/OverlayModeView.jsx': ['Focus export', 'Re-run Focus', 'Generate required', 'adding overlays', 'text region', 'playhead"', ' Mode\n'],
  'modes/overlay/OverlayMode.jsx': ['highlight region', 'text layer', 'player boxes', 'highlight notice'],
  'modes/overlay/OverlayTimeline.jsx': ['highlight layer'],
  'modes/overlay/layers/HighlightLayer.jsx': ['highlight layer', 'highlight ellipse', 'Highlight keyframe', '[SELECTED]'],
  'modes/overlay/layers/DetectionMarkerLayer.jsx': ['Click to', 'detected at frame', 'assigned at frame'],
  'modes/overlay/layers/PosterMarkerLayer.jsx': ['Cover frame', 'cover frame', 'cover-image marker', 'marker is inactive'],
  'modes/overlay/overlays/PlayerDetectionOverlay.jsx': ['Click to highlight', 'detected</span>'],
  'components/timeline/RegionLayer.jsx': ['Delete region', 'Highlight Region', 'Trim segment', 'Auto keyframe', '`Keyframe at', 'Boundary at', 'Delete boundary', '`Segment ', 'Click to add'],
  'components/timeline/TextLayer.jsx': ['Text region', 'Delete region', '" -- drag'],
  'components/textspec/TextSpecEditor.jsx': ['Shadow blur', 'Stroke width', '>Align<', '"Align"'],
  'components/overlay/TextManagementPanel.jsx': ['Collapse region', 'Expand region', 'Delete region', 'keep element', 'text block', 'text element'],
  'components/shared/ModeSwitcher.jsx': ['Reframe, trim &', 'Spotlight, text &'],
  'components/settings/OverlaySpotlightPanel.jsx': ['Moment {n}', 'to tune its color'],
  'screens/OverlayScreen.jsx': ['working video...'],
  'stores/overlayActionStore.js': ['highlight edits', 'highlight change', 'not stored', 'before generating'],
  'utils/updateFlush.js': ['highlight edits'],
};

const BANNED = /\b(moments?|keyframes?|ellipse|presets?|overlays?|focus|generat\w*|kit|click)\b|--|—/i;

describe('T14630 Spotlight copy', () => {
  it('T14630:C1 retired Spotlight words are gone from every shipped surface', () => {
    const found = Object.entries(RETIRED).flatMap(([file, phrases]) => {
      const text = source(file);
      return phrases.filter((p) => text.includes(p)).map((p) => `${file}: ${p}`);
    });
    expect(found).toEqual([]);
  });

  it('T14630:C2 stale-framing warning names the play and offers Redo framing', () => {
    renderView({ framingOutdated: true, effectiveOverlayVideoUrl: 'blob:x' });
    expect(screen.getByText("You changed this play's start or end after framing. Your spotlight still uses the old framing.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Redo framing' })).toBeTruthy();
  });

  it('T14630:C3 lock copy says make your highlight first and never says overlays', () => {
    expect(MODE_SWITCHER_LOCKED.SPOTLIGHT_NEEDS_HIGHLIGHT).toBe('Make your highlight first, then add a spotlight.');
    expect(MODE_SWITCHER_LOCKED.OUT_OF_SYNC).not.toMatch(BANNED);
    renderView();
    expect(screen.getByText('Make your highlight first, then add a spotlight.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Frame' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(BANNED);
  });

  it('T14630:C4 the Frame settings panel is Video, and both dim controls say Dim outside', () => {
    render(
      <FocusSettingsPanel
        globalAspectRatio="9:16" onAspectRatioChange={vi.fn()} includeAudio
        onIncludeAudioChange={vi.fn()} straightenVisible={false} onToggleStraighten={vi.fn()}
        dimOpacity={0.5} onToggleDim={vi.fn()}
      />,
    );
    expect(screen.getByText('Video')).toBeTruthy();
    expect(screen.queryByText('Highlight')).toBeNull();
    expect(EDITOR_PANELS.DIM_BACKGROUND).toBe('Dim outside');
    expect(EDITOR_PANELS.DARKEN_OUTSIDE).toBe('Dim outside');
  });

  it('T14630:C5 picking the athlete says tap, and the panel explains a missing spotlight plainly', () => {
    expect(EDITOR_PANELS.SELECT_PLAYER_CLICK).toBe('Tap your athlete to add a spotlight');
    const { rerender } = render(<OverlaySpotlightPanel awaitingPlayerSelection />);
    expect(screen.getByText('Tap your athlete to add a spotlight')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bplayers?\b|framed result/i);
    rerender(<OverlaySpotlightPanel isHighlightEnabled={false} pickProgress={[true, false]} activeStep={2} />);
    expect(screen.getByText('Add a spotlight to change its color, shape and how much the rest of the video is dimmed.')).toBeTruthy();
    expect(screen.getByText('Tap 1')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/moment/i);
  });

  it('T14630:C6 the pick walk counts taps, not moments', () => {
    const copy = [
      ...Object.values(GUIDE.overlay.pick).flatMap((s) => Object.values(s)),
      EDITOR_PANELS.PICK_GUIDE_STEP(1, 3, false),
      EDITOR_PANELS.PICK_GUIDE_STEP(1, 3, true),
      EDITOR_PANELS.PICK_GUIDE_AWAY_BUTTON(),
      EDITOR_PANELS.SPOTLIGHT_DURATION_HINT,
      STAGE_REASONS.SPOTLIGHT,
    ];
    expect(copy.filter((s) => BANNED.test(s))).toEqual([]);
    expect(EDITOR_PANELS.PICK_GUIDE_STEP(1, 3, false)).toBe('Tap 1 of 3');
  });

  it('T14630:C7 cover copy says cover and a still from the video, never frame or marker', () => {
    const { rerender } = render(<ThumbnailPanel posterPreviewVideoUrl="blob:v" posterPreviewTime={12} />);
    expect(screen.getByText('Drag to pick the cover people see before they press play.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bframe\b|marker/i);
    rerender(<ThumbnailPanel posterPreviewVideoUrl="blob:v" posterMarkerTimeLabel="0:12" />);
    expect(document.body.textContent).not.toMatch(/\bframe\b|marker/i);
    rerender(<ThumbnailPanel posterUploaded />);
    expect(screen.getByRole('button', { name: 'Use a still from the video' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bframe\b|marker/i);
    expect(EDITOR_PANELS.COVER_IMAGE).toBe('Cover');
    expect(`${EDITOR_PANELS.CHOOSE_COVER_FRAME} ${EDITOR_PANELS.COVER_IMAGE_HELPER}`).not.toMatch(/\bframe\b|marker|still/i);
  });

  it('T14630:C8 text position copy has no preset word', () => {
    render(<PositionPresetGrid spec={{ text: 'GOAL', align: 'center', position: { x: 0.123, y: 0.456 } }} onChange={vi.fn()} />);
    expect(document.body.textContent).not.toMatch(/preset/i);
  });

  it('T14630:C9 carried spotlight notices name spotlights and the Spotlight step', () => {
    const notes = ['dropped:1', 'dropped:2', 'multiclip_reset', 'legacy_uncertain'].map(describeHighlightCarryNote);
    expect(notes[0]).toBe('1 spotlight fell outside your new trim. Place it again in Spotlight.');
    expect(notes[1]).toBe('2 spotlights fell outside your new trim. Place them again in Spotlight.');
    expect(notes.filter((n) => /highlights?\b|overlay|--|clip|regenerat/i.test(n))).toEqual([]);
  });

  describe('save failures', () => {
    beforeEach(() => {
      useOverlayActionStore.getState().reset();
      useToastStore.setState({ toasts: [] });
    });

    it('T14630:C10 save-failure toasts use the error voice and say spotlight, not highlight', () => {
      useOverlayActionStore.getState()._surfaceFailureToast();
      useOverlayActionStore.getState()._surfaceRejectionToast('x', { error: 'e' });
      const text = useToastStore.getState().toasts.map((t) => `${t.message} ${t.title ?? ''}`).join(' ');
      expect(text).toContain("We couldn't save");
      expect(text).toContain('spotlight');
      expect(text).not.toMatch(/highlight change|highlight edits|stored|generating/i);
    });
  });
});
