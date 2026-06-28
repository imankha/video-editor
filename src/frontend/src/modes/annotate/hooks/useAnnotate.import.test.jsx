import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';
import useAnnotate from './useAnnotate';

/**
 * T4060 repro: annotations arrive from /load but never render as clip regions
 * (empty Annotate timeline). The Annotate timeline (ClipRegionLayer) shows its
 * empty state purely when `regionsWithLayout.length === 0`, and the hook's
 * `regionsWithLayout` memo returns [] whenever `duration` is falsy:
 *
 *   const regionsWithLayout = useMemo(() => {
 *     if (!duration) return [];   // <-- empty timeline if duration is null
 *     ...
 *   }, [clipRegions, duration]);
 *
 * These tests drive the REAL container call sequence from
 * AnnotateContainer.handleLoadGame / applyGameData:
 *
 *   applyGameData():   setAnnotateVideoMetadata(meta)  // hook prop changes
 *                      resetAnnotate()                 // hook reset(): duration <- null
 *   handleLoadGame():  importAnnotations(annotations, gameDuration)
 *
 * Crucially, in the container these three happen in ONE React commit (the
 * synchronous tail of handleLoadGame after `await loadPromise`), and
 * `importAnnotations`/`reset` are the closures from the PREVIOUS render — so
 * `importAnnotations`'s captured `duration` is whatever the prior game left in
 * state, NOT the value `reset()` is about to write. The harness below reproduces
 * that exact batching: the parent's setMeta() (prop change) is dispatched in the
 * same act() as reset() + importAnnotations(), using the pre-update closures.
 */

// A /load-shaped game (single video), mirrors GET /api/games/7/load.
function makeLoadGame({ duration = 6108, count = 13 } = {}) {
  const annotations = Array.from({ length: count }, (_, i) => ({
    id: 1000 + i,
    raw_clip_id: 1000 + i,
    start_time: i * 60,
    end_time: i * 60 + 8,
    name: `Clip ${i}`,
    rating: 4,
    tags: [],
    notes: '',
    video_sequence: null,
    auto_project_id: null,
    tagged_teammates: null,
    my_athlete: true,
    shared_by: null,
  }));
  return {
    id: 7,
    name: 'Sporting',
    video_duration: duration,
    video_width: 1920,
    video_height: 1080,
    annotations,
  };
}

// videoMetadata exactly as applyGameData() builds it for a single-video game.
function metaFor(game) {
  return {
    duration: game.video_duration,
    width: game.video_width,
    height: game.video_height,
    aspectRatio: game.video_width / game.video_height,
    fileName: game.name,
    format: 'mp4',
  };
}

/**
 * Harness mirroring AnnotateContainer: it owns videoMetadata (like
 * annotateVideoMetadata state in the container) and feeds it to useAnnotate as a
 * prop. loadGame() replays applyGameData + handleLoadGame's import call inside a
 * single commit, using the closures captured from the current render (exactly as
 * the container's in-flight handleLoadGame does).
 */
function Harness({ apiRef }) {
  const [videoMetadata, setVideoMetadata] = useState(null);
  const annotate = useAnnotate(videoMetadata, { selectedRegionId: null, onSelect: () => {} });

  // Expose the CURRENT render's closures + setters, like the container holding
  // these in scope when handleLoadGame's continuation runs.
  apiRef.current = {
    regionsWithLayout: annotate.regionsWithLayout,
    duration: annotate.duration,
    clipCount: annotate.clipCount,
    // Replays applyGameData() (setMeta + reset) then handleLoadGame's import,
    // all in one commit with this render's closures.
    loadGame: (game) => {
      setVideoMetadata(metaFor(game));     // setAnnotateVideoMetadata(videoMetadata)
      annotate.reset();                    // resetAnnotate()  -> duration <- null
      const gameDuration = metaFor(game).duration || game.video_duration;
      annotate.importAnnotations(game.annotations, gameDuration);
    },
    // Replays AnnotateContainer's loadedmetadata effect (line ~1122): the T4000
    // early `/video` src makes the <video> element fire loadedmetadata with a
    // WRONG short duration (~1979s) BEFORE /load resolves. The effect pushes it
    // into videoMetadata only when it is missing OR longer than stored.
    videoReportsDuration: (videoDur) => {
      const storedDur = videoMetadata?.duration;
      if (!storedDur || videoDur > storedDur + 1) {
        setVideoMetadata({ duration: videoDur, width: 1920, height: 1080, fileName: 'game.mp4', format: 'mp4' });
      }
    },
  };
  return null;
}

function mountHarness() {
  const apiRef = { current: null };
  render(<Harness apiRef={apiRef} />);
  return apiRef;
}

describe('T4060 - annotations render into the Annotate timeline', () => {
  it('FRESH first load: 13 annotations populate the timeline', () => {
    const api = mountHarness();
    const game = makeLoadGame({ duration: 6108, count: 13 });

    act(() => { api.current.loadGame(game); });

    // The timeline renders regionsWithLayout; empty state iff length === 0.
    expect(api.current.duration).toBe(6108);
    expect(api.current.regionsWithLayout.length).toBe(13);
  });

  it('SECOND load (prior game left duration in state): timeline still populates', () => {
    const api = mountHarness();

    // Game A: 6108s, 13 clips. Leaves hook `duration` state = 6108.
    act(() => { api.current.loadGame(makeLoadGame({ duration: 6108, count: 13 })); });
    expect(api.current.regionsWithLayout.length).toBe(13);

    // Game B: SAME duration (6108), 13 clips. handleLoadGame's importAnnotations
    // closure captured `duration`=6108 (truthy) from the render above, and reset()
    // sets duration<-null in the same commit, and the videoMetadata prop does NOT
    // change (6108===6108) so the auto-init effect never re-fires.
    // T4060 FIX: importAnnotations now writes the override duration
    // unconditionally, so duration is set even though the auto-init effect does
    // not re-fire, and the clips render.
    act(() => { api.current.loadGame(makeLoadGame({ duration: 6108, count: 13 })); });

    expect(api.current.duration).toBe(6108);
    expect(api.current.regionsWithLayout.length).toBe(13);
  });

  it('SECOND load with DIFFERENT duration: timeline populates (recovery path)', () => {
    const api = mountHarness();
    act(() => { api.current.loadGame(makeLoadGame({ duration: 6108, count: 13 })); });
    act(() => { api.current.loadGame(makeLoadGame({ duration: 5389, count: 32 })); });
    expect(api.current.regionsWithLayout.length).toBe(32);
  });

  // --- Role of the WRONG video-element duration (T4000 early /video src) ---

  it('FRESH load AFTER the <video> reported a wrong short duration first: recovers', () => {
    // The T4000 early src fires loadedmetadata(1979) BEFORE /load resolves, so the
    // hook `duration` state is already a truthy WRONG value (1979) when the import
    // runs. import's override-setDuration is skipped (closure duration=1979 truthy)
    // and reset() nulls duration, BUT applyGameData sets videoMetadata.duration to
    // the real 6108 (CHANGED from 1979), so the auto-init effect re-fires and
    // recovers. => the wrong duration alone does NOT empty the timeline.
    const api = mountHarness();
    act(() => { api.current.videoReportsDuration(1979.5); }); // separate commit, like the real event
    act(() => { api.current.loadGame(makeLoadGame({ duration: 6108, count: 13 })); });
    expect(api.current.regionsWithLayout.length).toBe(13);
  });

  it('SECOND load where the <video> previously bumped duration to the SAME value: populates', () => {
    // Game A loads (6108). Then on the next game-open the early <video> reports the
    // SAME 6108 again, so applyGameData's setVideoMetadata({duration:6108}) does NOT
    // change videoMetadata.duration -> the auto-init effect never re-fires and reset()
    // nulled duration. T4060 FIX: import's override write is now unconditional, so
    // duration is restored and the timeline populates.
    const api = mountHarness();
    act(() => { api.current.loadGame(makeLoadGame({ duration: 6108, count: 13 })); });
    act(() => { api.current.loadGame(makeLoadGame({ duration: 6108, count: 13 })); });
    expect(api.current.duration).toBe(6108);
    expect(api.current.regionsWithLayout.length).toBe(13);
  });
});
