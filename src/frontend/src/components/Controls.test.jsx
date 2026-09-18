import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Controls } from './Controls';

/**
 * T5370: the optional `isLooping` / `secondaryPlay` props must not change the
 * rendered output when they are absent — Annotate/Framing pass neither, so their
 * Controls must stay byte-identical to before the change.
 */
const baseProps = {
  isPlaying: false,
  currentTime: 3,
  duration: 30,
  onTogglePlay: vi.fn(),
  onStepForward: vi.fn(),
  onStepBackward: vi.fn(),
  onRestart: vi.fn(),
  isFullscreen: false,
  onToggleFullscreen: vi.fn(),
};

describe('Controls — spotlight-loop optional props (T5370)', () => {
  it('renders byte-identical HTML whether the new props are omitted or passed undefined', () => {
    const omitted = render(<Controls {...baseProps} />).container.innerHTML;
    const undef = render(
      <Controls {...baseProps} isLooping={undefined} secondaryPlay={undefined} />
    ).container.innerHTML;
    expect(undef).toBe(omitted);
  });

  it('without the new props: no secondary "Play full" button and plain "Play" title', () => {
    const { container } = render(<Controls {...baseProps} />);
    expect(container.querySelector('button[title="Play full clip"]')).toBeNull();
    expect(container.querySelector('button[title="Play"]')).not.toBeNull();
    expect(container.querySelector('button[title="Play spotlight (loops)"]')).toBeNull();
  });

  it('isLooping adds the loop accent + retitles the primary; no secondary unless provided', () => {
    const { container } = render(<Controls {...baseProps} isLooping />);
    const primary = container.querySelector('button[title="Play spotlight (loops)"]');
    expect(primary).not.toBeNull();
    expect(primary.className).toContain('ring-2'); // loop accent ring
    expect(container.querySelector('button[title="Play full clip"]')).toBeNull();
  });

  it('secondaryPlay renders a de-emphasized ghost button wired to its onClick', () => {
    const onClick = vi.fn();
    const { container } = render(
      <Controls {...baseProps} secondaryPlay={{ onClick, title: 'Play full clip', active: false }} />
    );
    const secondary = container.querySelector('button[title="Play full clip"]');
    expect(secondary).not.toBeNull();
    secondary.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// T10395: Focus's zoom moved from its settings rail onto this shared bar,
// opt-in via `showZoomControls` so Overlay (the other Controls caller) is
// unaffected when it doesn't pass the prop.
describe('Controls zoom (T10395)', () => {
  it('shows no zoom controls by default', () => {
    const { container } = render(<Controls {...baseProps} zoom={1} minZoom={1} maxZoom={4} />);
    expect(container.querySelector('button[title="Zoom In (Scroll Up)"]')).toBeNull();
  });

  it('shows the compact zoom controls, reset always present but disabled at 100%, when showZoomControls is true', () => {
    const { container } = render(
      <Controls {...baseProps} showZoomControls zoom={1} minZoom={1} maxZoom={4} />,
    );
    expect(container.querySelector('button[title="Zoom In (Scroll Up)"]')).not.toBeNull();
    expect(container.querySelector('button[title="Zoom Out (Scroll Down)"]')).not.toBeNull();
    const reset = container.querySelector('button[title="Reset to 100%"]');
    expect(reset).not.toBeNull();
    expect(reset.disabled).toBe(true);
  });

  it('enables the reset button once zoomed in', () => {
    const { container } = render(
      <Controls {...baseProps} showZoomControls zoom={2} minZoom={1} maxZoom={4} />,
    );
    expect(container.querySelector('button[title="Reset to 100%"]').disabled).toBe(false);
  });
});
