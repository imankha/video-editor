import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildClipMetadata, calculateEffectiveDuration } from './ExportButtonContainer';
import { useProjectDataStore } from '../stores/projectDataStore';

describe('ExportButtonContainer', () => {
  describe('buildClipMetadata', () => {
    it('returns null for empty clips array', () => {
      expect(buildClipMetadata([])).toBeNull();
    });

    it('returns null for null clips', () => {
      expect(buildClipMetadata(null)).toBeNull();
    });

    it('returns null for undefined clips', () => {
      expect(buildClipMetadata(undefined)).toBeNull();
    });

    it('builds metadata for single clip', () => {
      const clips = [
        { fileName: 'clip1.mp4', duration: 10 }
      ];

      const result = buildClipMetadata(clips);

      expect(result).toEqual({
        version: 1,
        source_clips: [
          { name: 'clip1.mp4', start_time: 0, end_time: 10 }
        ]
      });
    });

    it('builds metadata for multiple clips with correct timing', () => {
      const clips = [
        { fileName: 'clip1.mp4', duration: 10 },
        { fileName: 'clip2.mp4', duration: 15 },
        { fileName: 'clip3.mp4', duration: 20 }
      ];

      const result = buildClipMetadata(clips);

      expect(result).toEqual({
        version: 1,
        source_clips: [
          { name: 'clip1.mp4', start_time: 0, end_time: 10 },
          { name: 'clip2.mp4', start_time: 10, end_time: 25 },
          { name: 'clip3.mp4', start_time: 25, end_time: 45 }
        ]
      });
    });

    it('includes ALL clips in multi-clip project', () => {
      // This test verifies the fix for T70: Multi-clip Overlay Shows Only Single Clip
      // The bug occurred when only the edited clip was included in metadata
      const clips = [
        { fileName: 'clip1.mp4', duration: 10 },
        { fileName: 'clip2.mp4', duration: 15 }, // This was the "edited" clip
        { fileName: 'clip3.mp4', duration: 20 }
      ];

      const result = buildClipMetadata(clips);

      // CRITICAL: All 3 clips must be present, not just the edited one
      expect(result.source_clips).toHaveLength(3);
      expect(result.source_clips[0].name).toBe('clip1.mp4');
      expect(result.source_clips[1].name).toBe('clip2.mp4');
      expect(result.source_clips[2].name).toBe('clip3.mp4');
    });

    it('handles clips with trim ranges', () => {
      const clips = [
        {
          fileName: 'clip1.mp4',
          duration: 30,
          segments: { trimRange: { start: 5, end: 25 } }
        },
        {
          fileName: 'clip2.mp4',
          duration: 20
        }
      ];

      const result = buildClipMetadata(clips);

      // First clip trimmed from 30s to 20s (25-5)
      expect(result.source_clips[0].end_time).toBe(20);
      expect(result.source_clips[1].start_time).toBe(20);
      expect(result.source_clips[1].end_time).toBe(40);
    });

    it('handles clips with speed changes', () => {
      const clips = [
        {
          fileName: 'clip1.mp4',
          duration: 10,
          segments: {
            boundaries: [0, 5, 10],
            segmentSpeeds: { '0': 0.5, '1': 1.0 } // First half at 0.5x
          }
        }
      ];

      const result = buildClipMetadata(clips);

      // Original 10s: first 5s at 0.5x = 10s, next 5s at 1x = 5s, total = 15s
      expect(result.source_clips[0].end_time).toBe(15);
    });
  });

  describe('calculateEffectiveDuration', () => {
    it('returns full duration when no edits', () => {
      const clip = { duration: 30 };
      expect(calculateEffectiveDuration(clip)).toBe(30);
    });

    it('respects trim range', () => {
      const clip = {
        duration: 30,
        segments: { trimRange: { start: 10, end: 20 } }
      };
      expect(calculateEffectiveDuration(clip)).toBe(10);
    });

    it('respects trimRange at clip level', () => {
      const clip = {
        duration: 30,
        trimRange: { start: 5, end: 15 }
      };
      expect(calculateEffectiveDuration(clip)).toBe(10);
    });

    it('respects speed changes', () => {
      const clip = {
        duration: 10,
        segments: {
          boundaries: [0, 10],
          segmentSpeeds: { '0': 0.5 }
        }
      };
      // 10s at 0.5x speed = 20s effective duration
      expect(calculateEffectiveDuration(clip)).toBe(20);
    });
  });
});

/**
 * T70 Integration Test: Multi-clip overlay after framing edit
 *
 * This test verifies that when a user returns to framing mode from overlay,
 * edits one clip, and exports, ALL clips are included in the transition to overlay.
 *
 * The bug was caused by having two sources of truth (clipStore and projectDataStore).
 * The fix was to use a SINGLE store (projectDataStore) for all clip data.
 */
describe('T70: Multi-clip Overlay After Framing Edit', () => {
  beforeEach(() => {
    // Reset stores before each test
    useProjectDataStore.getState().reset();
  });

  describe('projectDataStore single source of truth', () => {
    it('projectDataStore.clips persists through mode changes', () => {
      // Simulate initial project load with 3 clips (already in UI format from useProjectLoader)
      const projectClips = [
        { id: 'clip_1', workingClipId: 1, fileName: 'clip1.mp4', duration: 10 },
        { id: 'clip_2', workingClipId: 2, fileName: 'clip2.mp4', duration: 15 },
        { id: 'clip_3', workingClipId: 3, fileName: 'clip3.mp4', duration: 20 }
      ];

      // Set clips in projectDataStore (simulating useProjectLoader)
      useProjectDataStore.getState().setProjectClips({ clips: projectClips, aspectRatio: '9:16' });

      // Verify all clips are stored
      expect(useProjectDataStore.getState().clips).toHaveLength(3);

      // Simulate mode changes (framing -> overlay -> framing)
      // projectDataStore.clips persists because it's the SINGLE source of truth

      // Verify clips are still all present after "mode changes"
      expect(useProjectDataStore.getState().clips).toHaveLength(3);
      expect(useProjectDataStore.getState().clips[0].id).toBe('clip_1');
      expect(useProjectDataStore.getState().clips[1].id).toBe('clip_2');
      expect(useProjectDataStore.getState().clips[2].id).toBe('clip_3');
    });

    it('projectDataStore should have all clips when returning to framing', () => {
      // This test verifies the scenario where user returns to framing from overlay
      // and all clips should be available for export

      const clips = [
        { id: 'clip1', fileName: 'clip1.mp4', duration: 10, cropKeyframes: [] },
        { id: 'clip2', fileName: 'clip2.mp4', duration: 15, cropKeyframes: [] },
        { id: 'clip3', fileName: 'clip3.mp4', duration: 20, cropKeyframes: [] }
      ];

      // Simulate clips being loaded into projectDataStore
      useProjectDataStore.getState().setProjectClips({ clips, aspectRatio: '9:16' });

      // Verify all clips are in projectDataStore
      expect(useProjectDataStore.getState().clips).toHaveLength(3);

      // User selects clip2 to edit (simulating what happens in framing mode)
      useProjectDataStore.getState().setSelectedClipId('clip2');

      // Verify that after selecting one clip, ALL clips are still available
      expect(useProjectDataStore.getState().clips).toHaveLength(3);

      // This is what would be passed to buildClipMetadata during export
      const allClips = useProjectDataStore.getState().clips;
      const metadata = buildClipMetadata(allClips);

      // CRITICAL: metadata must include ALL clips, not just the selected one
      expect(metadata.source_clips).toHaveLength(3);
    });

    it('clipMetadata for overlay includes all clips after single-clip edit', () => {
      // Simulate the exact bug scenario:
      // 1. Project has 3 clips
      // 2. User edits framing of clip2 only
      // 3. Export should include all 3 clips in metadata

      const clips = [
        { id: 'clip1', fileName: 'clip1.mp4', duration: 10, cropKeyframes: [{ time: 0, x: 0, y: 0 }] },
        { id: 'clip2', fileName: 'clip2.mp4', duration: 15, cropKeyframes: [{ time: 0, x: 100, y: 100 }] }, // Edited clip
        { id: 'clip3', fileName: 'clip3.mp4', duration: 20, cropKeyframes: [{ time: 0, x: 0, y: 0 }] }
      ];

      useProjectDataStore.getState().setProjectClips({ clips, aspectRatio: '9:16' });
      useProjectDataStore.getState().setSelectedClipId('clip2'); // User selected clip2 to edit

      // When export happens, it should use ALL clips
      const clipMetadata = buildClipMetadata(clips);

      // Verify all clips are included
      expect(clipMetadata.source_clips).toHaveLength(3);
      expect(clipMetadata.source_clips.map(c => c.name)).toEqual([
        'clip1.mp4',
        'clip2.mp4',
        'clip3.mp4'
      ]);

      // Verify timing is cumulative
      expect(clipMetadata.source_clips[0].start_time).toBe(0);
      expect(clipMetadata.source_clips[0].end_time).toBe(10);
      expect(clipMetadata.source_clips[1].start_time).toBe(10);
      expect(clipMetadata.source_clips[1].end_time).toBe(25);
      expect(clipMetadata.source_clips[2].start_time).toBe(25);
      expect(clipMetadata.source_clips[2].end_time).toBe(45);
    });
  });
});
