import { describe, it, expect } from 'vitest';
import { formatStamp, clipMetaForMoment, clipMetaForLooseFile, filterChips, veoGameNaming } from './clipImport.js';

const moment = (labels, stamp_s, upload = labels[0]) => ({
  stamp_s,
  duration_s: 25,
  labels,
  entries: [{ name: `01 x_-_${upload}.mp4`, upload: true }],
});

describe('Veo clip import metadata (T13230)', () => {
  it('formats stamps as mm:ss, h:mm:ss past an hour', () => {
    expect(formatStamp(884)).toBe('14:44');
    expect(formatStamp(5)).toBe('0:05');
    expect(formatStamp(3725)).toBe('1:02:05');
  });

  it('names a moment "{Label} {mm:ss}", tags Goal only, notes list all labels, sends rating null (V3: unrated)', () => {
    expect(clipMetaForMoment(moment(['Goal', 'Shot on goal'], 884))).toEqual({
      name: 'Goal 14:44', tags: ['Goal'], notes: 'Veo: Goal, Shot on goal', rating: null,
    });
    expect(clipMetaForMoment(moment(['Shot on goal'], 172))).toEqual({
      name: 'Shot on goal 2:52', tags: [], notes: 'Veo: Shot on goal', rating: null,
    });
  });

  it('sends an explicit null rating (the parent decides; an omitted rating gets the upload default of 5)', () => {
    expect(clipMetaForMoment(moment(['Goal'], 1))).toHaveProperty('rating', null);
  });

  it('gives a loose Veo mp4 the same naming; non-Veo files get null', () => {
    const f = new File(['x'], '06 001444_-_Goal.mp4');
    expect(clipMetaForLooseFile(f)).toEqual({ name: 'Goal 14:44', tags: ['Goal'], notes: 'Veo: Goal', rating: null });
    expect(clipMetaForLooseFile(new File(['x'], 'holiday.mp4'))).toBeNull();
  });

  it('builds label filter chips with counts in priority order', () => {
    const ms = [moment(['Goal'], 1), moment(['Shot on goal'], 2), moment(['Shot on goal', 'Attack'], 3)];
    expect(filterChips(ms)).toEqual([
      { label: 'Goal', count: 1 }, { label: 'Shot on goal', count: 2 }, { label: 'Attack', count: 1 },
    ]);
  });
});

describe('veoGameNaming (T13245)', () => {
  it('titles the game from the zip name, collapsing the double spaces real Veo names carry', () => {
    expect(veoGameNaming('Veo highlights WCFC  vs. Legends FC San Diego (1st Half).zip')).toEqual({
      name: 'WCFC vs. Legends FC San Diego (1st Half)', opponentName: 'Legends FC San Diego',
    });
    expect(veoGameNaming('Veo highlights WCFC B2012  vs.  SD Surf.zip')).toEqual({
      name: 'WCFC B2012 vs. SD Surf', opponentName: 'SD Surf',
    });
  });
  it('keeps a title without "vs." and has no opponent', () => {
    expect(veoGameNaming('Veo highlights Scrimmage Game 10_4_25.zip')).toEqual({
      name: 'Scrimmage Game 10_4_25', opponentName: null,
    });
  });
});
