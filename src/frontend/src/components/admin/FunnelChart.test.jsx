import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { FunnelChart } from './FunnelChart';

describe('FunnelChart (T7510 attempted vs completed)', () => {
  it('renders no data message when funnel is empty', () => {
    render(<FunnelChart data={{ funnel: [] }} />);
    expect(screen.getByText('No funnel data available.')).toBeTruthy();
  });

  it('renders Upload Attempted and Uploaded as distinct stages with the gap visible', () => {
    const data = {
      funnel: [
        {
          origin: 'all',
          signed_up: 100,
          upload_attempted: 40,
          uploaded: 25,
          clipped: 10,
        },
      ],
    };
    render(<FunnelChart data={data} />);

    expect(screen.getByText('Upload Attempted')).toBeTruthy();
    expect(screen.getByText('Uploaded')).toBeTruthy();
    // Attempt count and the lower durable-success count both render distinctly.
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('25')).toBeTruthy();
  });

  it('labels the annotation step "Watched Annotate Video", not "Annotation Done" (T7930)', () => {
    // The step fires on finish-annotation (viewed_duration > 0), NOT on a clip
    // being saved, so the old "Annotation Done" label misread as content creation.
    // Funnel key is derived from the backend label -> 'watched_annotate_video'.
    const data = {
      funnel: [
        { origin: 'all', signed_up: 100, clipped: 30, watched_annotate_video: 20 },
      ],
    };
    render(<FunnelChart data={data} />);
    expect(screen.getByText('Watched Annotate Video')).toBeTruthy();
    expect(screen.queryByText('Annotation Done')).toBeNull();
    expect(screen.getByText('20')).toBeTruthy();
  });

  it('shows a lower share for Uploaded than for the attempt step it follows', () => {
    const data = {
      funnel: [
        { origin: 'all', signed_up: 100, session: 50, upload_attempted: 40, uploaded: 10, clipped: 10 },
      ],
    };
    render(<FunnelChart data={data} />);
    // T11010: percentages are share of SIGNED UP, not of the previous step.
    // Upload Attempted 40/100 = 40%, Uploaded 10/100 = 10% -- the honest
    // attempt/success gap is still visible, now on a fixed denominator.
    expect(screen.getByText('40%')).toBeTruthy();
    // Clipped is 10/100 too, so this share is legitimately shared by two rows.
    expect(screen.getAllByText('10%').length).toBeGreaterThan(0);
  });
});

describe('FunnelChart (T11010 distinct-user counts, label-derived keys)', () => {
  it('reads Focus steps by their label-derived keys, not the event names', () => {
    // The backend emits focus_opened / focus_exported (derived from the
    // "Focus Opened" / "Focus Exported" labels). The chart used to look up
    // framing_opened / framing_exported, which matched nothing, so both rows
    // rendered a hardcoded 0 even for accounts sitting AT Focus Opened.
    const data = {
      funnel: [
        { origin: 'all', signed_up: 100, focus_opened: 31, focus_exported: 12 },
      ],
    };
    render(<FunnelChart data={data} />);

    expect(screen.getByText('31')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('renders the Clip Uploaded step (direct-upload flow was missing entirely)', () => {
    const data = {
      funnel: [
        { origin: 'all', signed_up: 100, clipped: 20, clip_uploaded: 14 },
      ],
    };
    render(<FunnelChart data={data} />);

    expect(screen.getByText('Clip Uploaded')).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();
  });

  it('never renders a percentage above 100%, even on non-nested steps', () => {
    // The real prod shape: more users watched the Annotate video than saved a
    // clip, and more exported an overlay than exported from Focus. Step-over-step
    // conversion turned those into 138% / 700%, which reads as event counting.
    const data = {
      funnel: [
        {
          origin: 'all', signed_up: 150, session: 130, file_selected: 65,
          upload_attempted: 74, uploaded: 48, clipped: 26,
          watched_annotate_video: 36, focus_exported: 0, overlay_exported: 7,
        },
      ],
    };
    render(<FunnelChart data={data} />);

    for (const el of screen.getAllByText(/^\d+%$/)) {
      expect(parseInt(el.textContent, 10)).toBeLessThanOrEqual(100);
    }
  });

  it('states that bars are distinct users, not action occurrences', () => {
    const data = { funnel: [{ origin: 'all', signed_up: 10 }] };
    render(<FunnelChart data={data} />);

    expect(screen.getByText(/distinct users/)).toBeTruthy();
    expect(screen.getByText(/not how many times the action happened/)).toBeTruthy();
  });
});
