import { describe, it, expect } from 'vitest';
import { exportProgressLabel } from './exportProgressPresentation';
import { EXPORT_PROGRESS } from '../config/displayNames';

// T9540 (N37): the export progress presenter turns backend phase/message into honest
// user copy, with counters as OPTIONAL secondary detail. It must NEVER leak the raw
// engineering strings ("Detecting players", "frame 150/180", "Computing hash") as the
// primary label.

describe('exportProgressLabel — phase -> honest N37 copy', () => {
  it('maps preparing-ish phases to "Getting your video ready"', () => {
    for (const phase of ['init', 'queued', 'validating', 'download', 'downloading']) {
      expect(exportProgressLabel(phase, '').primary).toBe(EXPORT_PROGRESS.PREPARING);
    }
  });

  it('maps upload to "Uploading"', () => {
    expect(exportProgressLabel('upload', 'Uploading result...').primary).toBe(EXPORT_PROGRESS.UPLOADING);
  });

  it('maps render-ish phases to "Rendering"', () => {
    for (const phase of ['processing', 'modal_processing', 'rendering']) {
      expect(exportProgressLabel(phase, '').primary).toBe(EXPORT_PROGRESS.RENDERING);
    }
  });

  // T9860: upscaling/ai_upscale split out of RENDERING into their own honest
  // "Sharpening the picture" phase, so the AI step is named where it actually runs.
  it('maps upscaling phases to "Sharpening the picture"', () => {
    for (const phase of ['upscaling', 'ai_upscale']) {
      expect(exportProgressLabel(phase, '').primary).toBe(EXPORT_PROGRESS.ENHANCING);
    }
  });

  it('maps detecting_players to the same copy as uploading', () => {
    expect(exportProgressLabel('detecting_players', 'Detecting players (local GPU)...').primary)
      .toBe(EXPORT_PROGRESS.UPLOADING);
  });
});

describe('exportProgressLabel — T12120 parent-readable words', () => {
  it('never exposes a counter: the bar already shows percent', () => {
    const r = exportProgressLabel('processing', 'AI upscaling frame 150/180');
    expect(r.primary).toBe('Generating your highlight');
    expect(r.detail).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/\d+\/\d+/);
  });

  it('detecting_players reads "Finishing up" (it runs at 92% of every export)', () => {
    expect(exportProgressLabel('detecting_players', 'Detecting players (local GPU)...').primary)
      .toBe('Finishing up');
  });

  it('uploading also reads "Finishing up"', () => {
    expect(exportProgressLabel('upload', 'Uploading result...').primary).toBe('Finishing up');
  });

  it('the initial "Starting generation..." message reads "Getting your video ready"', () => {
    expect(exportProgressLabel(undefined, 'Starting generation...').primary)
      .toBe('Getting your video ready');
  });

  it('upscaling reads "Sharpening the picture"', () => {
    expect(exportProgressLabel('upscaling', '').primary).toBe('Sharpening the picture');
  });

  it('the overlay job renders as "Adding your spotlight", never "overlay"', () => {
    const r = exportProgressLabel('processing', '', 'overlay');
    expect(r.primary).toBe('Adding your spotlight');
    for (const v of Object.values(EXPORT_PROGRESS)) expect(v).not.toMatch(/overlay/i);
  });
});

describe('exportProgressLabel — fallbacks', () => {
  it('infers from the message when the phase is unknown/absent', () => {
    expect(exportProgressLabel(undefined, 'Detecting players...').primary).toBe(EXPORT_PROGRESS.UPLOADING);
    expect(exportProgressLabel(undefined, 'Computing hash').primary).toBe(EXPORT_PROGRESS.PREPARING);
    expect(exportProgressLabel('', 'Processing frames...').primary).toBe(EXPORT_PROGRESS.RENDERING);
  });

  it('returns null when there is nothing to show (no phase, no message)', () => {
    expect(exportProgressLabel(undefined, '')).toBeNull();
    expect(exportProgressLabel('', '   ')).toBeNull();
  });

  it('shows the raw message only as a last resort for a truly unknown phase+message', () => {
    const r = exportProgressLabel('some_new_phase', 'Something specific happened');
    expect(r.primary).toBe('Something specific happened');
    expect(r.detail).toBeUndefined();
  });
});
