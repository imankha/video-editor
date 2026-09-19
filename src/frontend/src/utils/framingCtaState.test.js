import { describe, it, expect } from 'vitest';
import { deriveFramingCtaState } from './framingCtaState';

describe('deriveFramingCtaState (T10650)', () => {
  it('no render yet -> generate, no ghost', () => {
    const s = deriveFramingCtaState({
      workingVideoId: null,
      clips: [{ exported_at: null }],
      framingChangedSinceExport: false,
    });
    expect(s.mode).toBe('generate');
    expect(s.showBackToPreview).toBe(false);
    expect(s.renderedAt).toBe(null);
  });

  it('render exists, nothing changed -> preview, no ghost, renderedAt = latest stamp', () => {
    const s = deriveFramingCtaState({
      workingVideoId: 7,
      clips: [
        { exported_at: '2026-09-19T10:00:00Z' },
        { exported_at: '2026-09-19T11:30:00Z' },
      ],
      framingChangedSinceExport: false,
    });
    expect(s.mode).toBe('preview');
    expect(s.showBackToPreview).toBe(false);
    expect(s.renderedAt).toBe('2026-09-19T11:30:00Z');
  });

  it('render exists, in-memory flag set -> generate + ghost', () => {
    const s = deriveFramingCtaState({
      workingVideoId: 7,
      clips: [{ exported_at: '2026-09-19T10:00:00Z' }],
      framingChangedSinceExport: true,
    });
    expect(s.mode).toBe('generate');
    expect(s.showBackToPreview).toBe(true);
  });

  it('render exists, a clip has NULL exported_at (durable staleness) -> generate + ghost even when the flag is false', () => {
    const s = deriveFramingCtaState({
      workingVideoId: 7,
      clips: [
        { exported_at: '2026-09-19T10:00:00Z' },
        { exported_at: null }, // freshly added or re-edited clip
      ],
      framingChangedSinceExport: false,
    });
    expect(s.mode).toBe('generate');
    expect(s.showBackToPreview).toBe(true);
  });

  it('missing clips -> generate, no ghost, no timestamp (no guessing preview)', () => {
    const s = deriveFramingCtaState({
      workingVideoId: 7,
      clips: undefined,
      framingChangedSinceExport: false,
    });
    expect(s.mode).toBe('generate');
    expect(s.showBackToPreview).toBe(false);
    expect(s.renderedAt).toBe(null);
  });
});
