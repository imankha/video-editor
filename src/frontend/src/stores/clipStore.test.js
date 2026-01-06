import { describe, it, expect, beforeEach } from 'vitest';
import { useClipStore } from './clipStore';

describe('clipStore', () => {
  // Reset store before each test
  beforeEach(() => {
    useClipStore.getState().reset();
  });

  describe('initial state', () => {
    it('starts with empty clips array', () => {
      expect(useClipStore.getState().clips).toEqual([]);
    });

    it('starts with null selectedClipId', () => {
      expect(useClipStore.getState().selectedClipId).toBe(null);
    });

    it('starts with default globalAspectRatio', () => {
      expect(useClipStore.getState().globalAspectRatio).toBe('9:16');
    });

    it('starts with default globalTransition', () => {
      expect(useClipStore.getState().globalTransition).toEqual({
        type: 'cut',
        duration: 0.5,
      });
    });
  });

  describe('state setters', () => {
    it('setClips updates clips array', () => {
      const clips = [{ id: 'clip1', fileName: 'test.mp4' }];
      useClipStore.getState().setClips(clips);
      expect(useClipStore.getState().clips).toEqual(clips);
    });

    it('setSelectedClipId updates selection', () => {
      useClipStore.getState().setSelectedClipId('clip1');
      expect(useClipStore.getState().selectedClipId).toBe('clip1');
    });

    it('setGlobalAspectRatioState updates aspect ratio', () => {
      useClipStore.getState().setGlobalAspectRatioState('16:9');
      expect(useClipStore.getState().globalAspectRatio).toBe('16:9');
    });

    it('setGlobalTransition updates transition', () => {
      const transition = { type: 'fade', duration: 1.0 };
      useClipStore.getState().setGlobalTransition(transition);
      expect(useClipStore.getState().globalTransition).toEqual(transition);
    });
  });

  describe('addClipToStore', () => {
    it('adds a clip to the array', () => {
      const clip = { id: 'clip1', fileName: 'test.mp4' };
      useClipStore.getState().addClipToStore(clip);
      expect(useClipStore.getState().clips).toEqual([clip]);
    });

    it('appends clips to existing array', () => {
      const clip1 = { id: 'clip1', fileName: 'test1.mp4' };
      const clip2 = { id: 'clip2', fileName: 'test2.mp4' };
      useClipStore.getState().addClipToStore(clip1);
      useClipStore.getState().addClipToStore(clip2);
      expect(useClipStore.getState().clips).toEqual([clip1, clip2]);
    });
  });

  describe('deleteClipFromStore', () => {
    it('removes a clip from the array', () => {
      const clips = [
        { id: 'clip1', fileName: 'test1.mp4' },
        { id: 'clip2', fileName: 'test2.mp4' },
      ];
      useClipStore.getState().setClips(clips);
      useClipStore.getState().deleteClipFromStore('clip1');
      expect(useClipStore.getState().clips).toEqual([clips[1]]);
    });

    it('selects first remaining clip when deleting selected clip', () => {
      const clips = [
        { id: 'clip1', fileName: 'test1.mp4' },
        { id: 'clip2', fileName: 'test2.mp4' },
      ];
      useClipStore.getState().setClips(clips);
      useClipStore.getState().setSelectedClipId('clip1');
      useClipStore.getState().deleteClipFromStore('clip1');
      expect(useClipStore.getState().selectedClipId).toBe('clip2');
    });

    it('sets selectedClipId to null when deleting last clip', () => {
      const clips = [{ id: 'clip1', fileName: 'test1.mp4' }];
      useClipStore.getState().setClips(clips);
      useClipStore.getState().setSelectedClipId('clip1');
      useClipStore.getState().deleteClipFromStore('clip1');
      expect(useClipStore.getState().selectedClipId).toBe(null);
    });

    it('keeps selection when deleting non-selected clip', () => {
      const clips = [
        { id: 'clip1', fileName: 'test1.mp4' },
        { id: 'clip2', fileName: 'test2.mp4' },
      ];
      useClipStore.getState().setClips(clips);
      useClipStore.getState().setSelectedClipId('clip1');
      useClipStore.getState().deleteClipFromStore('clip2');
      expect(useClipStore.getState().selectedClipId).toBe('clip1');
    });
  });

  describe('updateClipInStore', () => {
    it('updates specific clip data', () => {
      const clips = [
        { id: 'clip1', fileName: 'old.mp4', duration: 10 },
        { id: 'clip2', fileName: 'test2.mp4', duration: 20 },
      ];
      useClipStore.getState().setClips(clips);
      useClipStore.getState().updateClipInStore('clip1', { fileName: 'new.mp4' });

      const updatedClip = useClipStore.getState().clips.find(c => c.id === 'clip1');
      expect(updatedClip.fileName).toBe('new.mp4');
      expect(updatedClip.duration).toBe(10); // Other fields preserved
    });

    it('does not modify other clips', () => {
      const clips = [
        { id: 'clip1', fileName: 'test1.mp4' },
        { id: 'clip2', fileName: 'test2.mp4' },
      ];
      useClipStore.getState().setClips(clips);
      useClipStore.getState().updateClipInStore('clip1', { fileName: 'new.mp4' });

      const clip2 = useClipStore.getState().clips.find(c => c.id === 'clip2');
      expect(clip2.fileName).toBe('test2.mp4');
    });
  });

  describe('reorderClipsInStore', () => {
    it('moves clip from one position to another', () => {
      const clips = [
        { id: 'clip1', fileName: 'test1.mp4' },
        { id: 'clip2', fileName: 'test2.mp4' },
        { id: 'clip3', fileName: 'test3.mp4' },
      ];
      useClipStore.getState().setClips(clips);
      useClipStore.getState().reorderClipsInStore(0, 2);

      const reordered = useClipStore.getState().clips;
      expect(reordered[0].id).toBe('clip2');
      expect(reordered[1].id).toBe('clip3');
      expect(reordered[2].id).toBe('clip1');
    });
  });

  describe('clearAllClips', () => {
    it('clears clips and selection', () => {
      const clips = [{ id: 'clip1', fileName: 'test.mp4' }];
      useClipStore.getState().setClips(clips);
      useClipStore.getState().setSelectedClipId('clip1');
      useClipStore.getState().clearAllClips();

      expect(useClipStore.getState().clips).toEqual([]);
      expect(useClipStore.getState().selectedClipId).toBe(null);
    });
  });

  describe('setProjectClips', () => {
    it('sets clips and selects first clip', () => {
      const clips = [
        { id: 'clip1', fileName: 'test1.mp4' },
        { id: 'clip2', fileName: 'test2.mp4' },
      ];
      useClipStore.getState().setProjectClips({ clips, aspectRatio: '16:9' });

      expect(useClipStore.getState().clips).toEqual(clips);
      expect(useClipStore.getState().selectedClipId).toBe('clip1');
      expect(useClipStore.getState().globalAspectRatio).toBe('16:9');
    });

    it('handles empty clips array', () => {
      useClipStore.getState().setProjectClips({ clips: [], aspectRatio: '16:9' });

      expect(useClipStore.getState().clips).toEqual([]);
      expect(useClipStore.getState().selectedClipId).toBe(null);
    });

    it('keeps existing aspect ratio when not provided', () => {
      useClipStore.getState().setGlobalAspectRatioState('4:3');
      useClipStore.getState().setProjectClips({ clips: [] });

      expect(useClipStore.getState().globalAspectRatio).toBe('4:3');
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useClipStore.getState().setClips([{ id: 'clip1' }]);
      useClipStore.getState().setSelectedClipId('clip1');
      useClipStore.getState().setGlobalAspectRatioState('16:9');
      useClipStore.getState().setGlobalTransition({ type: 'fade', duration: 2.0 });

      useClipStore.getState().reset();

      expect(useClipStore.getState().clips).toEqual([]);
      expect(useClipStore.getState().selectedClipId).toBe(null);
      expect(useClipStore.getState().globalAspectRatio).toBe('9:16');
      expect(useClipStore.getState().globalTransition).toEqual({ type: 'cut', duration: 0.5 });
    });
  });

  describe('computed values', () => {
    it('hasClips returns false when no clips', () => {
      expect(useClipStore.getState().hasClips()).toBe(false);
    });

    it('hasClips returns true when clips exist', () => {
      useClipStore.getState().addClipToStore({ id: 'clip1' });
      expect(useClipStore.getState().hasClips()).toBe(true);
    });

    it('getSelectedClip returns null when no selection', () => {
      expect(useClipStore.getState().getSelectedClip()).toBe(null);
    });

    it('getSelectedClip returns the selected clip', () => {
      const clip = { id: 'clip1', fileName: 'test.mp4' };
      useClipStore.getState().addClipToStore(clip);
      useClipStore.getState().setSelectedClipId('clip1');
      expect(useClipStore.getState().getSelectedClip()).toEqual(clip);
    });

    it('getSelectedClipIndex returns -1 when no selection', () => {
      expect(useClipStore.getState().getSelectedClipIndex()).toBe(-1);
    });

    it('getSelectedClipIndex returns correct index', () => {
      useClipStore.getState().setClips([
        { id: 'clip1' },
        { id: 'clip2' },
        { id: 'clip3' },
      ]);
      useClipStore.getState().setSelectedClipId('clip2');
      expect(useClipStore.getState().getSelectedClipIndex()).toBe(1);
    });

    it('getClipById returns the clip', () => {
      const clip = { id: 'clip1', fileName: 'test.mp4' };
      useClipStore.getState().addClipToStore(clip);
      expect(useClipStore.getState().getClipById('clip1')).toEqual(clip);
    });

    it('getClipById returns null for non-existent clip', () => {
      expect(useClipStore.getState().getClipById('nonexistent')).toBe(null);
    });
  });
});
