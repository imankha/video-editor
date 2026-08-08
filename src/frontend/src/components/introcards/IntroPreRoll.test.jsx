// T5220 — IntroPreRoll: the DOM pre-roll wrapper around MotionPreview shown
// before playback on the 3 React public surfaces (SharedVideoOverlay,
// SharedCollectionView), mirroring BrandedEndCard's mount-gated pattern in
// reverse (design §5, §9).
//
// IntroPreRoll.jsx does not exist yet -- this import fails until Stage 4
// creates it. MotionPreview is mocked so this stays a pure unit test of the
// wrapper's gating/onDone-forwarding logic, not the render engine.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('./MotionPreview', () => ({
  MotionPreview: vi.fn(({ onDone }) => {
    return (
      <button type="button" data-testid="mock-motion-preview" onClick={onDone}>
        mock motion preview
      </button>
    );
  }),
}));

import { IntroPreRoll } from './IntroPreRoll';
import { MotionPreview } from './MotionPreview';

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

const SAMPLE_INTRO = {
  card: { id: 5, image_key: 'k.png', treatment: 'gold', shown_fields: ['position'], text_elements: {} },
  previewUrl: 'https://r2.example/card.jpg',
  field_values: { full_name: 'Jordan Vega', position: 'Point Guard' },
  profile: { focal_x: 0.5, focal_y: 0.3, zoom: 1.1 },
};

describe('IntroPreRoll', () => {
  it('renders nothing when intro is null', () => {
    const { container } = render(<IntroPreRoll intro={null} onDone={() => {}} />);
    expect(container.firstChild).toBeNull();
    expect(MotionPreview).not.toHaveBeenCalled();
  });

  it('renders nothing when intro is undefined', () => {
    const { container } = render(<IntroPreRoll onDone={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts MotionPreview when intro is present', () => {
    render(<IntroPreRoll intro={SAMPLE_INTRO} onDone={() => {}} />);
    expect(screen.getByTestId('mock-motion-preview')).toBeTruthy();
    expect(MotionPreview).toHaveBeenCalledTimes(1);
  });

  it("calls onDone after MotionPreview's onDone fires", () => {
    const onDone = vi.fn();
    render(<IntroPreRoll intro={SAMPLE_INTRO} onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
    screen.getByTestId('mock-motion-preview').click();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('reassembles the split payload into the card/profile shape MotionPreview reads facts/photo from', () => {
    // MotionPreview reads the photo off `card.previewUrl` (not a sibling prop)
    // and the facts off `profile.full_name`/`profile[shownField]` (not
    // `field_values`) -- see introCardPreviewElements.js. The backend payload
    // splits those into separate keys, so the wrapper must merge them back or
    // the pre-roll silently renders with no photo and no name/facts.
    render(<IntroPreRoll intro={SAMPLE_INTRO} onDone={() => {}} />);
    const call = MotionPreview.mock.calls[0][0];
    expect(call.card).toEqual({ ...SAMPLE_INTRO.card, previewUrl: SAMPLE_INTRO.previewUrl });
    expect(call.profile).toEqual({ ...SAMPLE_INTRO.profile, ...SAMPLE_INTRO.field_values });
  });
});
