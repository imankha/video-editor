// T6860 (round 4) — guard the user's product invariant: the tile HOVER PREVIEW must
// NEVER include the intro card. It streams the RAW reel (`/downloads/{id}/stream`), which
// carries no intro (the intro is composited only at the `/file` download egress and shown
// only in the full IntroStoryPlayer playback, T6700/T6710). A future change that pointed
// the preview at `/file` (or otherwise composited the intro) would regress this.
//
// Live-verified on staging (real user, reel 38 with an attached card): hovering the tile
// fired only `GET /downloads/38/stream` (no `/intro-playback`, no `/file`), and the inline
// preview showed reel footage, not the intro card. This test pins that.

import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Capture the streamUrl the tile hands the preview component.
let capturedStreamUrl;
vi.mock('./TilePreviewVideo', () => ({
  TilePreviewVideo: ({ streamUrl }) => {
    capturedStreamUrl = streamUrl;
    return <div data-testid="tile-preview" data-stream-url={streamUrl || ''} />;
  },
}));

import { ReelTile } from './ReelTile';

const baseProps = (download) => ({
  download,
  posterUrl: `/api/downloads/${download.id}/poster.jpg`,
  displayName: download.project_name,
  metaLine: '9:16 - 1 clip',
  unwatchedStyle: { dot: 'bg-cyan-400', border: 'border-cyan-400' },
  onPlay: vi.fn(), onWebShare: vi.fn(), onCopyLink: vi.fn(), onDownload: vi.fn(),
  onBeforeAfter: vi.fn(), showBeforeAfter: false, onOpenProject: vi.fn(),
  canOpenSource: () => false, onMove: vi.fn(), canMoveProfiles: false,
  onDelete: vi.fn(), onRename: vi.fn(),
});

describe('T6860 tile hover preview never includes the intro', () => {
  it('streams the RAW reel (/stream), never the intro-composited /file', () => {
    capturedStreamUrl = undefined;
    render(<ReelTile {...baseProps({ id: 38, filename: 'r.mp4', project_name: 'Brilliant Dribble and Assist', aspect_ratio: '9:16' })} />);
    // API_BASE-agnostic: the preview points at the raw /stream endpoint...
    expect(capturedStreamUrl).toMatch(/\/api\/downloads\/38\/stream$/);
    // ...never the intro-composited /file download egress.
    expect(capturedStreamUrl).not.toMatch(/\/file(\?|$)/);
  });

  it('is unaffected by an attached intro card (badge shows, but the preview stream is still raw)', () => {
    capturedStreamUrl = undefined;
    render(<ReelTile {...baseProps({
      id: 38, filename: 'r.mp4', project_name: 'Brilliant Dribble and Assist',
      aspect_ratio: '9:16', intro_card_id: 1, intro_card_name: 'New card 1',
    })} />);
    // The attached card surfaces as a badge...
    expect(document.querySelector('[data-testid="intro-badge"]')).not.toBeNull();
    // ...but the hover preview still streams the raw reel, not a composited/intro variant.
    expect(capturedStreamUrl).toMatch(/\/api\/downloads\/38\/stream$/);
    expect(capturedStreamUrl).not.toMatch(/\/file(\?|$)/);
  });
});
