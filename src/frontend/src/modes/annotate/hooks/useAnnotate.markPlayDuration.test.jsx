import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';
import useAnnotate from './useAnnotate';

/**
 * T14370: Mark play silently does nothing on a ZERO-play game.
 *
 * useAnnotate kept `duration` as a second copy of videoMetadata.duration, synced
 * by an effect keyed on videoMetadata?.duration and nulled by reset(). The
 * container's applyGameData() runs setAnnotateVideoMetadata(meta) + resetAnnotate()
 * in one commit. When the metadata duration value does not change (reopening the
 * same game, or another game of the same length), the sync effect never re-fires
 * and reset() leaves duration null. T4060 patched this only through
 * importAnnotations' override, which a game with no plays never calls, so
 * addClipRegion (Mark play) returned null with just a console.warn.
 */

function metaFor(duration) {
  return { duration, width: 1920, height: 1080, aspectRatio: 16 / 9, fileName: 'game', format: 'mp4' };
}

// Owns videoMetadata like AnnotateContainer and replays applyGameData() for a
// game with no annotations (so handleLoadGame never calls importAnnotations).
function Harness({ apiRef }) {
  const [videoMetadata, setVideoMetadata] = useState(null);
  const annotate = useAnnotate(videoMetadata, { selectedRegionId: null, onSelect: () => {} });
  apiRef.current = {
    duration: annotate.duration,
    clipCount: annotate.clipCount,
    addClipRegion: annotate.addClipRegion,
    openZeroPlayGame: (duration) => {
      setVideoMetadata(metaFor(duration)); // setAnnotateVideoMetadata(videoMetadata)
      annotate.reset();                    // resetAnnotate()
    },
  };
  return null;
}

function mountHarness() {
  const apiRef = { current: null };
  render(<Harness apiRef={apiRef} />);
  return apiRef;
}

describe('T14370 - Mark play on a zero-play game always has a duration', () => {
  it('first open: Mark play adds a clip', () => {
    const api = mountHarness();
    act(() => { api.current.openZeroPlayGame(89.3); });

    let region;
    act(() => { region = api.current.addClipRegion(10); });
    expect(api.current.duration).toBe(89.3);
    expect(region).not.toBeNull();
    expect(api.current.clipCount).toBe(1);
  });

  it('reopening a game with the same duration: Mark play still adds a clip', () => {
    const api = mountHarness();
    act(() => { api.current.openZeroPlayGame(89.3); });
    // Reopen (same game, or another game of identical length): the metadata
    // duration value is unchanged, so a synced copy would stay nulled by reset().
    act(() => { api.current.openZeroPlayGame(89.3); });

    expect(api.current.duration).toBe(89.3);
    let region;
    act(() => { region = api.current.addClipRegion(10); });
    expect(region).not.toBeNull();
    expect(api.current.clipCount).toBe(1);
  });
});
