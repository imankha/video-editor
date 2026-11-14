/**
 * T11270: a project has exactly one clip, so the Framing plumbing names it
 * "the project's clip" instead of a selection. Rename-only: same values, new names.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useProjectDataStore } from '../stores/projectDataStore';
import * as stores from '../stores';
import { useClipManager } from './useClipManager';

const CLIP = { id: 41, raw_clip_id: 7, start_time: 1, end_time: 5 };

describe('T11270 project clip accessor', () => {
  beforeEach(() => {
    useProjectDataStore.getState().reset();
  });

  it('store names the clip projectClipId and drops the selection names', () => {
    useProjectDataStore.getState().setProjectClips({ clips: [CLIP] });
    const s = useProjectDataStore.getState();
    expect(s.projectClipId).toBe(41);
    expect(s.getProjectClip()).toEqual(CLIP);
    expect(typeof s.setProjectClipId).toBe('function');
    expect('selectedClipId' in s).toBe(false);
    expect(s.setSelectedClipId).toBeUndefined();
    expect(s.getSelectedClip).toBeUndefined();
    expect(typeof stores.useProjectClipId).toBe('function');
    expect(stores.useSelectedClipId).toBeUndefined();
  });

  it('useClipManager returns projectClipId/projectClip, not selectedClip*', () => {
    useProjectDataStore.getState().setProjectClips({ clips: [CLIP] });
    const { result } = renderHook(() => useClipManager());
    expect(result.current.projectClipId).toBe(41);
    expect(result.current.projectClip).toMatchObject(CLIP);
    expect('selectedClipId' in result.current).toBe(false);
    expect('selectedClip' in result.current).toBe(false);
  });

  // editorContext.js keeps its `selectedClipId` payload key: backend email.py reads it.
  it('Framing sources no longer use the selection vocabulary', () => {
    const files = [
      'src/containers/FocusContainer.jsx',
      'src/screens/FocusScreen.jsx',
      'src/modes/FocusModeView.jsx',
      'src/modes/focus/cockpit/FocusCockpit.jsx',
      'src/App.jsx',
      'src/utils/analytics.js',
      'src/stores/projectDataStore.js',
      'src/hooks/useClipManager.js',
    ];
    const hits = files.filter(f =>
      /\bselectedClip(Id|WithMeta|EffectiveDuration)?\b|SelectedClipId/.test(
        readFileSync(resolve(__dirname, '../..', f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
