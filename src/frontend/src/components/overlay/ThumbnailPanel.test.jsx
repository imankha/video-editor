import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ThumbnailPanel from './ThumbnailPanel';

/**
 * T9550 (Shared Vocabulary epic, N31): the poster/thumbnail settings panel is
 * parent-facing "Cover image" now — "the still people see before playing" — and the
 * marker CHOOSES its frame. The component FILE keeps its name (no rename, epic rule);
 * only the copy changed. Locks the rename so "thumbnail" can't reappear in the UI.
 */

describe('ThumbnailPanel — "Cover image" vocabulary (T9550)', () => {
  it('heads the panel "Cover image" and drops "Thumbnail" from parent-facing copy', () => {
    render(
      <ThumbnailPanel
        posterMarkerTimeLabel={null}
        posterUploaded={false}
        posterPreviewVideoUrl="blob:x"
        posterPreviewTime={2}
        onRemoveUpload={vi.fn()}
      />
    );
    expect(screen.getByText('Cover image')).toBeTruthy();
    expect(screen.getByText(/cover frame/i)).toBeTruthy();
    expect(screen.queryByText(/thumbnail/i)).toBeNull();
  });
});
