import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// T15620: the empty dropzone's headline said "Drop any game video here." even
// on a touch phone, where there is no drag gesture to perform (2026-11-09
// staging QA pass, nf-mobile/iphone-09-nogamefile.png). The drag-oriented
// heading must hide on coarse pointers; a tap-oriented heading takes its place.

vi.mock('../hooks/useFootageIntake', () => ({
  useFootageIntake: () => ({
    status: 'empty', items: [], order: [], confidence: 'unknown', gaps: [],
    placement: 'sequence', lanes: [], question: null, skipped: [], proxies: {},
    addFiles: vi.fn(), removeItem: vi.fn(), setManualOrder: vi.fn(), setPlacementMode: vi.fn(),
  }),
}));

import { GameFootagePicker } from './GameFootagePicker';

describe('T15620 GameFootagePicker device-correct heading', () => {
  it('hides the drop/drag heading on coarse pointers and shows a tap heading instead', () => {
    render(<GameFootagePicker onFootageChange={vi.fn()} />);
    const dropHeading = screen.getByText('Drop any game video here.');
    expect(dropHeading.className).toContain('coarse-pointer:hidden');

    const tapHeading = screen.getByText('Tap to add a game video.');
    expect(tapHeading.className).toContain('fine-pointer:hidden');
  });

  it('attach mode: the same split applies to the scoped heading', () => {
    render(<GameFootagePicker onFootageChange={vi.fn()} attachMode />);
    expect(screen.getByText('Drop a video to add to this game.').className).toContain('coarse-pointer:hidden');
    expect(screen.getByText('Tap to add a video to this game.').className).toContain('fine-pointer:hidden');
  });
});
