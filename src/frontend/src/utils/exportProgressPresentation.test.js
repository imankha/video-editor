import { describe, it, expect } from 'vitest';
import { exportProgressLabel } from './exportProgressPresentation';
import { EXPORT_PROGRESS } from '../config/displayNames';

// T9540 (N37): the export progress presenter turns backend phase/message into honest
// user copy, with counters as OPTIONAL secondary detail. It must NEVER leak the raw
// engineering strings ("Detecting players", "frame 150/180", "Computing hash") as the
// primary label.

describe('exportProgressLabel — phase -> honest N37 copy', () => {
  it('maps preparing-ish phases to "Preparing video"', () => {
    for (const phase of ['init', 'queued', 'validating', 'download', 'downloading']) {
      expect(exportProgressLabel(phase, '').primary).toBe(EXPORT_PROGRESS.PREPARING);
    }
  });

  it('maps upload to "Uploading"', () => {
    expect(exportProgressLabel('upload', 'Uploading result...').primary).toBe(EXPORT_PROGRESS.UPLOADING);
  });

  it('maps render-ish phases to "Rendering"', () => {
    for (const phase of ['processing', 'modal_processing', 'rendering', 'upscaling', 'ai_upscale']) {
      expect(exportProgressLabel(phase, '').primary).toBe(EXPORT_PROGRESS.RENDERING);
    }
  });

  it('maps detecting_players to "Finding players for spotlight"', () => {
    expect(exportProgressLabel('detecting_players', 'Detecting players (local GPU)...').primary)
      .toBe(EXPORT_PROGRESS.FINDING_PLAYERS);
  });
});

describe('exportProgressLabel — counters are optional secondary detail', () => {
  it('extracts an "N/M" counter from the message as detail, not primary', () => {
    const r = exportProgressLabel('processing', 'AI upscaling frame 150/180');
    expect(r.primary).toBe(EXPORT_PROGRESS.RENDERING);
    expect(r.detail).toBe('150/180');
    // the raw engineering phrase never becomes the primary label
    expect(r.primary).not.toMatch(/upscal|frame/i);
  });

  it('handles a "Clip 2: frame 3/40" style counter', () => {
    const r = exportProgressLabel('processing', 'Clip 2: frame 3/40');
    expect(r.primary).toBe(EXPORT_PROGRESS.RENDERING);
    expect(r.detail).toBe('3/40');
  });

  it('detail is null when the message carries no counter', () => {
    expect(exportProgressLabel('upload', 'Uploading result...').detail).toBeNull();
  });
});

describe('exportProgressLabel — fallbacks', () => {
  it('infers from the message when the phase is unknown/absent', () => {
    expect(exportProgressLabel(undefined, 'Detecting players...').primary).toBe(EXPORT_PROGRESS.FINDING_PLAYERS);
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
    expect(r.detail).toBeNull();
  });
});
