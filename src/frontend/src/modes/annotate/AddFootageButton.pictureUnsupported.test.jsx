/**
 * T17370: Add footage (attach to an existing game) must catch a file this browser
 * can play only the sound of (iPhone HEVC without an HEVC decoder: 0x0 picture),
 * the same way the first upload does (T17280): say so plainly and never attach it.
 * Real GameFootagePicker + useFootageIntake; only the probe and the transport are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UPLOAD } from '../../config/displayNames';

const { attachSpy, probeSpy } = vi.hoisted(() => ({ attachSpy: vi.fn(), probeSpy: vi.fn() }));
vi.mock('../../services/uploadManager', () => ({
  attachVideoToExistingGame: attachSpy,
  sendUploadFailureBeacon: vi.fn(),
  UPLOAD_KIND: {},
  UPLOAD_PHASE: { HASHING: 'hashing', ERROR: 'error' },
}));
vi.mock('../../utils/videoMetadata', () => ({ extractVideoMetadata: probeSpy }));

import { AddFootageButton } from './AddFootageButton';

function pictureError() {
  const err = new Error('picture not decodable');
  err.code = 'VIDEO_PICTURE_UNSUPPORTED';
  return err;
}

function openAndPick(name) {
  render(<AddFootageButton variant="card" gameId={7} />);
  fireEvent.click(screen.getByTestId('add-footage-button'));
  const file = new File([new Uint8Array(1024)], name, { type: 'video/quicktime' });
  fireEvent.change(screen.getByTestId('footage-file-input'), { target: { files: [file] } });
  return file;
}

describe('T17370 Add footage: sound but no picture', () => {
  beforeEach(() => {
    attachSpy.mockReset();
    attachSpy.mockResolvedValue({ videos: [] });
    probeSpy.mockReset();
  });

  it('shows the first-upload message and does not attach a sound-only video', async () => {
    probeSpy.mockRejectedValue(pictureError());
    openAndPick('IMG_0128.MOV');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(UPLOAD.VIDEO_PICTURE_UNSUPPORTED);
    const submit = screen.getByTestId('add-footage-submit');
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(attachSpy).not.toHaveBeenCalled();
  });

  it('still attaches a normal video', async () => {
    probeSpy.mockResolvedValue({ width: 1920, height: 1080, duration: 3600, creationTime: null });
    const file = openAndPick('second-half.mp4');
    const submit = screen.getByTestId('add-footage-submit');
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(submit);
    await waitFor(() => expect(attachSpy).toHaveBeenCalledTimes(1));
    expect(attachSpy.mock.calls[0][0]).toBe(7);
    expect(attachSpy.mock.calls[0][1][0].file).toBe(file);
  });
});
