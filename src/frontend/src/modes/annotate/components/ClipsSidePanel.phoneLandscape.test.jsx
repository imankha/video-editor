import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T15460 AC1: the desktop-variant (isMobile=false) plays panel is also used for
// landscape phones outside fullscreen (T4933), at a fixed w-[352px]. On an iPhone
// landscape (844x390) that left too little width for the stacked desktop stage/CTA
// layout to fit the remaining height. Narrow it in that range only.
vi.mock('./ClipListItem', () => ({ default: () => null }));
vi.mock('./ClipDetailsEditor', () => ({ default: () => <div data-testid="details-editor" /> }));
vi.mock('../hooks/useAnnotate', () => ({
  validateTsvContent: () => ({ success: true, annotations: [] }),
  generateTsvContent: () => '',
}));

import { ClipsSidePanel } from './ClipsSidePanel';

const baseProps = {
  onSelectRegion: () => {},
  onUpdateRegion: () => {},
  onDeleteRegion: () => {},
  onImportAnnotations: () => {},
  maxNotesLength: 500,
  clipCount: 1,
  videoDuration: 6000,
  boundaryOffsets: [],
  clipRegions: [],
};

describe('ClipsSidePanel phone-landscape width (T15460)', () => {
  it('narrows the desktop-variant panel width for narrow landscape phones', () => {
    render(<ClipsSidePanel {...baseProps} />);
    const panel = screen.getByTestId('annotate-plays-list');
    expect(panel.className).toContain('w-[352px]');
    expect(panel.className).toContain(
      '[@media(max-width:1023px)_and_(orientation:landscape)_and_(max-height:500px)]:!w-[260px]'
    );
  });
});
