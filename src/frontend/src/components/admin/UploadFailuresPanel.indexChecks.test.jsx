import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { UploadFailuresPanel } from './UploadFailuresPanel';

// T2580:C2 -- the admin upload panel shows how many recent uploads have their
// index at the end (cannot start playing until fully downloaded).
const RESPONSE = {
  window: { since_build: 5100, commit_sha: 'def5678', since_date: '2026-11-10',
            until_date: '2026-11-15', rows_at_this_build: 0 },
  rows: [],
  total: 0,
  rates: {
    game: { attempts: 3, succeeded: 3, failed: 0, rate_pct: 100.0 },
    clip: { attempts: 0, succeeded: 0, failed: 0, rate_pct: null },
  },
  index_checks: { checked: 12, not_at_front: 5 },
};

describe('UploadFailuresPanel (T2580) -- index-at-front count', () => {
  it('shows how many checked uploads cannot start at once', () => {
    render(<UploadFailuresPanel data={RESPONSE} loading={false} error={null} onRefresh={vi.fn()} />);
    const card = screen.getByTestId('upload-index-checks');
    expect(card.textContent).toContain('Cannot start at once');
    expect(screen.getByTestId('upload-index-not-at-front').textContent).toBe('5');
    expect(card.textContent).toContain('of 12 uploads checked');
  });

  it('says so when the environment has no index-check table yet', () => {
    render(<UploadFailuresPanel data={{ ...RESPONSE, index_checks: null }} loading={false}
                                error={null} onRefresh={vi.fn()} />);
    expect(screen.getByTestId('upload-index-checks').textContent).toContain('not migrated');
  });
});
