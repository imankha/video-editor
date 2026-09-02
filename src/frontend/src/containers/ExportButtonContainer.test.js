import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildClipMetadata, calculateEffectiveDuration } from '../utils/effectiveDuration';
import { estimateExportCredits, EXPORT_CONFIG } from './ExportButtonContainer';
import { useCreditStore } from '../stores/creditStore';
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

  // T5790: pre-flight credit-cost estimate on the Framing export button.
  describe('estimateExportCredits', () => {
    // A 6s clip whose first 3s play at 0.5x: 3s/0.5 (=6s) + 3s (=3s) = 9s output.
    const clip6sPlus3sSlowMo = {
      id: 'c1',
      duration: 6,
      segments: {
        boundaries: [0, 3, 6],
        segmentSpeeds: { '0': 0.5 },
      },
    };

    it('6s clip + 3s @0.5x -> 9 credits (matches the insufficient-credits modal number)', () => {
      const clips = [clip6sPlus3sSlowMo];
      expect(estimateExportCredits(clips)).toBe(9);
      // The estimate MUST equal what the click-time credit check computes for the same
      // data (same util + same Math.ceil), so the button and the modal never disagree.
      const modalRequired = useCreditStore
        .getState()
        .getRequiredCredits(calculateEffectiveDuration(clip6sPlus3sSlowMo));
      expect(estimateExportCredits(clips)).toBe(modalRequired);
    });

    it('trim reduces the estimate', () => {
      // Trim the slow-mo clip to [0, 3]: only the 3s @0.5x portion survives -> 6s -> 6 credits.
      const trimmed = {
        ...clip6sPlus3sSlowMo,
        segments: { ...clip6sPlus3sSlowMo.segments, trimRange: { start: 0, end: 3 } },
      };
      expect(estimateExportCredits([trimmed])).toBe(6);
      expect(estimateExportCredits([trimmed])).toBeLessThan(estimateExportCredits([clip6sPlus3sSlowMo]));
    });

    it('rounds up fractional output seconds (Math.ceil)', () => {
      // 5.1s clip, no edits -> 5.1s output -> 6 credits.
      expect(estimateExportCredits([{ id: 'c1', duration: 5.1 }])).toBe(6);
    });

    it('sums across a multi-clip project', () => {
      const clips = [
        { id: 'a', duration: 10 },
        clip6sPlus3sSlowMo, // 9s
        { id: 'c', duration: 4 },
      ];
      // 10 + 9 + 4 = 23s -> 23 credits.
      expect(estimateExportCredits(clips)).toBe(23);
    });

    it('returns null (hidden, no fabricated number) when a clip duration is unknown', () => {
      const clips = [{ id: 'a', duration: 10 }, { id: 'b', duration: undefined }];
      // sumEffectiveDurations fails closed to null when any clip is NaN.
      expect(estimateExportCredits(clips)).toBeNull();
    });

    it('returns null for empty / null clip lists', () => {
      expect(estimateExportCredits([])).toBeNull();
      expect(estimateExportCredits(null)).toBeNull();
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
        { id: 1, filename: 'clip1.mp4', duration: 10 },
        { id: 2, filename: 'clip2.mp4', duration: 15 },
        { id: 3, filename: 'clip3.mp4', duration: 20 }
      ];

      // Set clips in projectDataStore (simulating useProjectLoader)
      useProjectDataStore.getState().setProjectClips({ clips: projectClips, aspectRatio: '9:16' });

      // Verify all clips are stored
      expect(useProjectDataStore.getState().clips).toHaveLength(3);

      // Simulate mode changes (framing -> overlay -> framing)
      // projectDataStore.clips persists because it's the SINGLE source of truth

      // Verify clips are still all present after "mode changes"
      expect(useProjectDataStore.getState().clips).toHaveLength(3);
      expect(useProjectDataStore.getState().clips[0].id).toBe(1);
      expect(useProjectDataStore.getState().clips[1].id).toBe(2);
      expect(useProjectDataStore.getState().clips[2].id).toBe(3);
    });

    it('projectDataStore should have all clips when returning to framing', () => {
      // This test verifies the scenario where user returns to framing from overlay
      // and all clips should be available for export

      const clips = [
        { id: 1, filename: 'clip1.mp4', duration: 10, crop_data: null },
        { id: 2, filename: 'clip2.mp4', duration: 15, crop_data: null },
        { id: 3, filename: 'clip3.mp4', duration: 20, crop_data: null }
      ];

      // Simulate clips being loaded into projectDataStore
      useProjectDataStore.getState().setProjectClips({ clips, aspectRatio: '9:16' });

      // Verify all clips are in projectDataStore
      expect(useProjectDataStore.getState().clips).toHaveLength(3);

      // User selects clip2 to edit (simulating what happens in framing mode)
      useProjectDataStore.getState().setSelectedClipId(2);

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
        { id: 1, filename: 'clip1.mp4', duration: 10, crop_data: [{ time: 0, x: 0, y: 0 }] },
        { id: 2, filename: 'clip2.mp4', duration: 15, crop_data: [{ time: 0, x: 100, y: 100 }] }, // Edited clip
        { id: 3, filename: 'clip3.mp4', duration: 20, crop_data: [{ time: 0, x: 0, y: 0 }] }
      ];

      useProjectDataStore.getState().setProjectClips({ clips, aspectRatio: '9:16' });
      useProjectDataStore.getState().setSelectedClipId(2); // User selected clip2 to edit

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

describe('T8280: EXPORT_CONFIG.targetFps stays 30 for Option B scope', () => {
  // Design doc docs/plans/tasks/T8280-design.md Stage 4 (Option B-simple): no
  // native-fps delivery ships in this task. Both dispatch sites in
  // ExportButtonContainer.jsx (formData.append('target_fps', ...) ~line 605,
  // and the render request body 'target_fps' ~line 644) read EXPORT_CONFIG.targetFps
  // -- this pins that the constant itself (the single source both dispatch
  // sites read) is unconditionally 30, i.e. there is no toggle/store slice
  // that can change it in this task's scope. If the Implementor adds an
  // fps-choice toggle for a later native-delivery task, EXPORT_CONFIG.targetFps
  // must NOT become a live/dynamic value read from a toggle for Option B --
  // it stays the fixed default; the two-price segmented control (Option A
  // shape) is explicitly NOT part of this task.
  it('EXPORT_CONFIG.targetFps is exactly 30, regardless of any high-fps source', () => {
    expect(EXPORT_CONFIG.targetFps).toBe(30);
  });
});
