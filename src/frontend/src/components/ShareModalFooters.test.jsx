// T12080: every share modal footer puts the main action first and in the one
// primary colour (Q2 = A cyan, Q18 = A main first). The exit (Cancel / Done) is
// always after it in DOM order, which is the left on desktop and the top on mobile.
import { render, screen, cleanup, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShareModal } from './ShareModal';
import { CollectionShareModal } from './CollectionShareModal';
import { ShareWithTeammatesModal } from './ShareWithTeammatesModal';
import { SharePlaybackDialog } from './SharePlaybackDialog';
import { ShareGameModal } from './ShareGameModal';

vi.mock('./shared/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('./shared/UserPicker', () => ({ UserPicker: () => null }));

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ contacts: [] }) }));
});
afterEach(cleanup);

function expectMainFirstInPrimaryColour(footer, exitName) {
  const primary = within(footer).getByRole('button', { name: /^Share\b/ });
  const exit = within(footer).getByRole('button', { name: exitName });
  // primary precedes the exit in DOM order (leftmost on desktop, top on mobile)
  expect(primary.compareDocumentPosition(exit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // one colour: the primary fill, not the second cyan (bg-cyan-600)
  const tokens = primary.className.split(' ');
  expect(tokens).toContain('bg-cyan-500');
  expect(tokens).not.toContain('bg-cyan-600');
}

// Each modal's footer is the parent of its Cancel/Done exit button.
function footerOf(name) {
  return screen.getByRole('button', { name }).parentElement;
}

describe('share modal footers (T12080)', () => {
  it('ShareModal: Share first, Cancel after', () => {
    render(<ShareModal videoId={1} videoName="Reel" hasIntroPhoto={false} onClose={() => {}} />);
    expectMainFirstInPrimaryColour(footerOf(/^Cancel$/), /^Cancel$/);
  });

  it('CollectionShareModal: Share first, Cancel after', () => {
    render(
      <CollectionShareModal
        definition={{ scope: 'all', filter: {}, aspect_ratio: '16:9' }}
        title="Collection"
        onClose={() => {}}
      />,
    );
    expectMainFirstInPrimaryColour(footerOf(/^Cancel$/), /^Cancel$/);
  });

  it('ShareWithTeammatesModal: Share first, Cancel after', () => {
    render(
      <ShareWithTeammatesModal
        tagCounts={{ Jake: 3 }}
        tagClipIds={{ Jake: [1, 2, 3] }}
        gameId={42}
        sharedTagData={{}}
        onClose={() => {}}
        onSharedTagsChange={() => {}}
      />,
    );
    expectMainFirstInPrimaryColour(footerOf(/^Cancel$/), /^Cancel$/);
  });

  it('SharePlaybackDialog: Share first, Cancel after', () => {
    render(<SharePlaybackDialog gameId={42} gameName="Game" onClose={() => {}} />);
    expectMainFirstInPrimaryColour(footerOf(/^Cancel$/), /^Cancel$/);
  });

  it('ShareGameModal: Share first, Cancel after', () => {
    render(<ShareGameModal gameId={42} gameName="Game" onClose={() => {}} />);
    expectMainFirstInPrimaryColour(footerOf(/^Cancel$/), /^Cancel$/);
  });
});
