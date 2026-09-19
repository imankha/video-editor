import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';
import useAnnotate, { readHasCustomName, validateTsvContent } from './useAnnotate';

// T10410: the "named" progress badge depends on `hasCustomName` being read from
// the payload Annotate ACTUALLY loads (GET /api/games/{id} -> annotations ->
// importAnnotations), where `name` is always populated (generated when nothing
// is stored). These tests exercise that seam, not the derivation — a fixture
// with `{ name: 'Good Goal', hasCustomName: false }` proves nothing unless the
// mapping can produce it.

function Harness({ apiRef }) {
  const [videoMetadata, setVideoMetadata] = useState(null);
  const annotate = useAnnotate(videoMetadata, { selectedRegionId: null, onSelect: () => {} });
  apiRef.current = {
    clipRegions: annotate.clipRegions,
    updateClipRegion: annotate.updateClipRegion,
    load: (annotations) => {
      setVideoMetadata({ duration: 6000, width: 1920, height: 1080, fileName: 'g.mp4', format: 'mp4' });
      annotate.reset();
      annotate.importAnnotations(annotations, 6000);
    },
  };
  return null;
}

function mount() {
  const apiRef = { current: null };
  render(<Harness apiRef={apiRef} />);
  return apiRef;
}

const gameAnnotation = (over = {}) => ({
  id: 1000, raw_clip_id: 1000, start_time: 10, end_time: 18, name: 'Good Goal', rating: 4,
  tags: ['Goal'], notes: '', video_sequence: null, auto_project_id: null, tagged_teammates: null,
  my_athlete: true, ...over,
});

afterEach(() => vi.restoreAllMocks());

describe('importAnnotations — hasCustomName comes from the payload flag, never from name', () => {
  it('a generated name (has_custom_name false) maps to hasCustomName false even though name is populated', () => {
    const api = mount();
    act(() => api.current.load([gameAnnotation({ has_custom_name: false })]));
    const [region] = api.current.clipRegions;
    expect(region.name).toBe('Good Goal');
    expect(region.hasCustomName).toBe(false);
  });

  it('a stored name (has_custom_name true) maps to hasCustomName true', () => {
    const api = mount();
    act(() => api.current.load([gameAnnotation({ name: "Ava's header", has_custom_name: true })]));
    expect(api.current.clipRegions[0].hasCustomName).toBe(true);
  });

  it('a payload missing the flag warns loudly and treats the name as generated (no !!name fallback)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = mount();
    act(() => api.current.load([gameAnnotation()]));
    expect(api.current.clipRegions[0].hasCustomName).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('has_custom_name'), 1000);
  });

  it('a local name update keeps the pair coherent: "" means generated, text means custom', () => {
    const api = mount();
    act(() => api.current.load([gameAnnotation({ has_custom_name: false })]));
    const id = api.current.clipRegions[0].id;
    act(() => api.current.updateClipRegion(id, { name: 'Banger' }));
    expect(api.current.clipRegions[0].hasCustomName).toBe(true);
    act(() => api.current.updateClipRegion(id, { name: '' }));
    expect(api.current.clipRegions[0].hasCustomName).toBe(false);
  });
});

describe('readHasCustomName / TSV import', () => {
  it('accepts the camelCase region shape too', () => {
    expect(readHasCustomName({ hasCustomName: true })).toBe(true);
  });

  it('a TSV row with a clip_name is custom; without one it is not', () => {
    const tsv = ['start_time\trating\ttags\tclip_name\tclip_duration\tnotes', '1:00\t4\tGoal\tMy play\t8.0\t', '2:00\t4\tGoal\t\t8.0\t'].join('\n');
    const result = validateTsvContent(tsv);
    expect(result.success).toBe(true);
    expect(result.annotations[0].hasCustomName).toBe(true);
    expect(result.annotations[1].hasCustomName).toBe(false);
  });
});
