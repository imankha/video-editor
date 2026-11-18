/**
 * T17380: a failed upload tile on Home names credits when the upload failed for lack
 * of credits, and still offers Retry.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../stores', () => ({
  useProfileStore: (sel) => sel({ profiles: [{ id: 'p1', sport: 'soccer' }], currentProfileId: 'p1' }),
}));

import { UploadingGameTile } from '../UploadingGameTile';
import { UPLOAD_STATUS } from '../../stores/uploadStore';
import { UPLOAD_PHASE } from '../../services/uploadManager';

const failed = (over = {}) => ({
  id: 'upl_1',
  status: UPLOAD_STATUS.ERROR,
  phase: UPLOAD_PHASE.ERROR,
  fileName: 'game.mp4',
  gameName: 'vs Rivals',
  progress: 15,
  message: 'x',
  startedAt: new Date().toISOString(),
  previewFrame: null,
  ...over,
});

describe('T17380: failed-for-credits upload tile', () => {
  it('T17380:C1 explains credits and offers Retry', () => {
    const onRetry = vi.fn();
    render(<UploadingGameTile upload={failed({ insufficientCredits: true })} onRetry={onRetry} onDiscard={vi.fn()} />);
    expect(screen.getByText(/need more credits.*Retry upload/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Retry upload of vs Rivals/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the generic failed copy for any other failure', () => {
    render(<UploadingGameTile upload={failed()} onRetry={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.queryByText(/need more credits/i)).toBeNull();
    expect(screen.getByText(/Upload didn.t finish/)).toBeTruthy();
  });
});
