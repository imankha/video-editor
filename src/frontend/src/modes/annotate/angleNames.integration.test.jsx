import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildGameTimeline } from './hooks/useVirtualTimeline';
import AngleSwitcherBadge from './AngleSwitcherBadge';
import { ClipListItem } from './components/ClipListItem';
import { AnnotateFullscreenOverlay } from './components/AnnotateFullscreenOverlay';

// T8892 live-QA (container-feasible): drive the SHARED name source
// (buildGameTimeline -> angle.name) into EVERY user-facing surface acceptance
// criterion 2 lists -- switcher badge, sidebar pill, and the Add Play chip --
// exactly as AnnotateContainer derives their inputs (sourcesAtPlayhead @L307-310,
// getAngleName @L1696-1701). Proves a real overlap game shows "sideline"
// everywhere and NEVER the R2 content hash; a legacy game (no filename) shows
// "Extra clip 1". Browser drive of the seeded overlap game is owed on staging
// (the angle UI is inert in prod until T8900/T8910 can create real overlap).

const HASH_RE = /[0-9a-f]{8}/i;

// Real R2 shape: url is content-addressed by blake3; the honest name lives in
// original_filename. seq 2 (sideline) overlaps seq 1 (main) 600-900s.
const overlapGame = [
  { sequence: 1, duration: 1500, offset_seconds: 0, url: 'games/67ef5eefeed423a69.mp4', original_filename: 'main-camera.mp4' },
  { sequence: 2, duration: 300, offset_seconds: 600, url: 'games/1c0ffee9900dbeef.mp4', original_filename: 'sideline.mp4' },
];

// A legacy overlap game created before v052 -> no original_filename anywhere.
const legacyGame = [
  { sequence: 1, duration: 1500, offset_seconds: 0, url: 'games/aaaaaaaa1111.mp4', original_filename: null },
  { sequence: 2, duration: 300, offset_seconds: 600, url: 'games/bbbbbbbb2222.mp4', original_filename: null },
];

function mockViewport() {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}
beforeEach(mockViewport);

// Mirror AnnotateContainer.sourcesAtPlayhead: backbone-first, angle names from
// the timeline (else "Main camera").
function sourcesAt(timeline, playhead) {
  return timeline.sourcesAt(playhead).map((seq) => {
    const angle = timeline.angles.find((a) => a.sequence === seq);
    return { sequence: seq, isBackbone: !angle, name: angle ? angle.name : 'Main camera' };
  });
}

const baseOverlayProps = {
  isVisible: true, currentTime: 700, videoDuration: 1500,
  onCreateClip: () => {}, onUpdateClip: () => {}, onResume: () => {},
  onClose: () => {}, onSeek: () => {}, videoController: {}, surface: 'inline_desktop',
};

describe('T8892 angle-name integration — every surface reads the real filename', () => {
  it('real overlap game: badge, sidebar pill and chip all show "sideline", never a hash', () => {
    const t = buildGameTimeline(overlapGame);
    const activeName = t.angles.find((a) => a.sequence === 2).name;
    expect(activeName).toBe('sideline');

    // Switcher badge (2 sources cover the playhead at virtual 700).
    const { unmount: u1 } = render(
      <AngleSwitcherBadge sources={sourcesAt(t, 700)} activeSourceSequence={2} onSelect={() => {}} />
    );
    const badge = screen.getByTestId('angle-switcher-badge');
    expect(badge.textContent).toContain('sideline');
    expect(badge.textContent).not.toMatch(HASH_RE);
    u1();

    // Sidebar pill on an angle clip (angleName = getAngleName(videoSequence)).
    const region = { id: 'c1', startTime: 700, endTime: 705, rating: 4, tags: [], notes: '', name: 'Play 1', videoSequence: 2 };
    const angleName = t.angles.find((a) => a.sequence === region.videoSequence)?.name ?? null;
    const { unmount: u2 } = render(
      <ClipListItem region={region} index={0} isSelected={false} onClick={() => {}} angleName={angleName} />
    );
    const pill = screen.getByTestId('clip-angle-pill');
    expect(pill.textContent).toContain('sideline');
    expect(pill.getAttribute('title')).toBe('Cut from sideline'); // tooltip
    expect(pill.textContent).not.toMatch(HASH_RE);
    u2();

    // Add Play chip (activeSourceName = the active angle's name).
    render(<AnnotateFullscreenOverlay {...baseOverlayProps} layout="strip" activeSourceName={activeName} />);
    const chip = screen.getByTestId('cut-from-angle');
    expect(chip.textContent).toContain('from sideline');
    expect(chip.textContent).toContain('This play will be cut from sideline.');
    expect(chip.textContent).not.toMatch(HASH_RE);
  });

  it('legacy overlap game (no original_filename): surfaces show "Extra clip 1", never a hash', () => {
    const t = buildGameTimeline(legacyGame);
    const activeName = t.angles.find((a) => a.sequence === 2).name;
    expect(activeName).toBe('Extra clip 1');

    const { unmount: u1 } = render(
      <AngleSwitcherBadge sources={sourcesAt(t, 700)} activeSourceSequence={2} onSelect={() => {}} />
    );
    const badge = screen.getByTestId('angle-switcher-badge');
    expect(badge.textContent).toContain('Extra clip 1');
    expect(badge.textContent).not.toMatch(HASH_RE);
    u1();

    render(<AnnotateFullscreenOverlay {...baseOverlayProps} layout="strip" activeSourceName={activeName} />);
    const chip = screen.getByTestId('cut-from-angle');
    expect(chip.textContent).toContain('from Extra clip 1');
    expect(chip.textContent).not.toMatch(HASH_RE);
  });
});
