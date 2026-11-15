// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { useFocusStore } from '../stores/focusStore';

// T4440: unused Frame and Spotlight editor code is deleted, and nothing in
// src/ (or e2e/, scripts/) still names it.

const SRC = join(__dirname, '..');
const FRONTEND = join(SRC, '..');

const DELETED = [
  'modes/overlay/OverlayTimeline.jsx',
  'modes/overlay/layers/HighlightLayer.jsx',
  'components/Timeline.jsx',
  'hooks/useCurrentVideoState.js',
  'hooks/useTimeline.js',
];

// Symbols with no runtime caller. Each must be gone from every source file.
const DEAD_SYMBOLS = [
  'OverlayTimeline',
  'HighlightLayer',
  'OverlayVideoOverlays',
  'useCurrentVideoState',
  'useTimeline\\b',
  'loadOverlayVideoFromUrl',
  'loadOverlayVideoFromFile',
  'resetOverlayState',
  'isFromFramingExport',
  'initializeFromClipMetadata',
  'initializeHighlightRegionsFromClips',
  'clipStates',
  'setClipState',
  'getClipState',
  'markExported',
  'hasChangedSinceExport',
  'exportedStateHash',
  'useFocusVideoFile',
  'annotateHasSelectedClip',
].join('|');

// The FocusContainer/OverlayContainer twins of values the screens own.
const CONTAINER_TWINS = 'export function FocusTimeline|getFilteredKeyframesForExport|hasFramingEdits|currentCropState|effectiveOverlayMetadata';

// The Frame-era OverlayContainer parameters the Spotlight screen filled with dummies.
const FRAME_PARAMS = [
  'framingVideoUrl', 'framingMetadata', 'keyframes', 'segments', 'segmentSpeeds',
  'segmentBoundaries', 'trimRange', 'setEditorMode', 'overlayVideoFile', 'overlayVideoMetadata',
];

const grep = (cwd, pattern, paths) => execSync(
  `git grep --untracked -nE '${pattern}' -- ${paths} || true`,
  { cwd, encoding: 'utf8' },
).split('\n').filter(Boolean);

describe('T4440 unused editor code is deleted', () => {
  it('deletes the unused files', () => {
    expect(DELETED.filter((f) => existsSync(join(SRC, f)))).toEqual([]);
  });

  it('leaves no caller of a deleted symbol in src/, e2e/ or scripts/', () => {
    const hits = grep(
      FRONTEND,
      DEAD_SYMBOLS,
      "src e2e ../../scripts ':(top,exclude,glob)**/*.md' ':!src/utils/deadEditorCode.test.js'",
    );
    expect(hits).toEqual([]);
  }, 60_000);

  it('drops the container twins of screen-owned values', () => {
    expect(grep(SRC, CONTAINER_TWINS, 'containers')).toEqual([]);
  }, 60_000);

  it('keeps no unwritten fields in the Frame store', () => {
    const state = useFocusStore.getState();
    for (const key of ['clipStates', 'setClipState', 'getClipState', 'videoFile', 'setVideoFile',
      'markExported', 'hasChangedSinceExport', 'hasExported', 'exportedStateHash']) {
      expect(state, key).not.toHaveProperty(key);
    }
  });

  it('OverlayContainer takes no Frame parameters and derives no video source', () => {
    const src = readFileSync(join(SRC, 'containers/OverlayContainer.jsx'), 'utf8');
    const start = src.indexOf('export function OverlayContainer({');
    const params = src.slice(start, src.indexOf('}) {', start));
    const names = params.match(/^\s+(\w+),/gm).map((m) => m.trim().replace(',', ''));
    expect(names.filter((n) => FRAME_PARAMS.includes(n))).toEqual([]);
    expect(src).not.toMatch(/const effectiveOverlay\w+ = useMemo/);
  });
});
