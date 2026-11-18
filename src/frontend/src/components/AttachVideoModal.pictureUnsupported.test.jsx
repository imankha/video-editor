/**
 * T17370: the game tile's "Add video" (AttachVideoModal) must catch a file this
 * browser can play only the sound of (iPhone HEVC, 0x0 picture) like the first
 * upload does (T17280): show the same plain message and never attach it.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UPLOAD } from '../config/displayNames';

const { attachSpy, probeSpy } = vi.hoisted(() => ({ attachSpy: vi.fn(), probeSpy: vi.fn() }));
vi.mock('../services/uploadManager', () => ({
  attachVideoToExistingGame: attachSpy,
  UPLOAD_PHASE: { HASHING: 'hashing', ERROR: 'error' },
}));
vi.mock('../utils/videoMetadata', () => ({ extractVideoMetadata: probeSpy }));
vi.mock('./shared', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { AttachVideoModal } from './AttachVideoModal';

function renderAndPick(name) {
  const onAttached = vi.fn();
  const { container } = render(
    <AttachVideoModal isOpen game={{ id: 42, name: 'Vs Carlsbad SC' }} onClose={vi.fn()} onAttached={onAttached} />
  );
  const file = new File([new Uint8Array(1024)], name, { type: 'video/quicktime' });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Add video' }));
  return { file, onAttached };
}

describe('T17370 AttachVideoModal: sound but no picture', () => {
  beforeEach(() => {
    attachSpy.mockReset();
    attachSpy.mockResolvedValue({ videos_added: 1 });
    probeSpy.mockReset();
  });

  it('shows the first-upload message and does not attach a sound-only video', async () => {
    const err = new Error('picture not decodable');
    err.code = 'VIDEO_PICTURE_UNSUPPORTED';
    probeSpy.mockRejectedValue(err);
    const { onAttached } = renderAndPick('IMG_0128.MOV');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(UPLOAD.VIDEO_PICTURE_UNSUPPORTED);
    expect(attachSpy).not.toHaveBeenCalled();
    expect(onAttached).not.toHaveBeenCalled();
  });

  it('still attaches a normal video', async () => {
    probeSpy.mockResolvedValue({ width: 1920, height: 1080, duration: 3600 });
    const { file, onAttached } = renderAndPick('second-half.mov');
    await waitFor(() => expect(attachSpy).toHaveBeenCalledTimes(1));
    expect(attachSpy.mock.calls[0][1]).toBe(file);
    await waitFor(() => expect(onAttached).toHaveBeenCalledWith(42));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
