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

  it('shows a lower conversion% for Uploaded than a step with no attempt/success gap', () => {
    const data = {
      funnel: [
        { origin: 'all', signed_up: 100, session: 50, upload_attempted: 40, uploaded: 10, clipped: 10 },
      ],
    };
    render(<FunnelChart data={data} />);
    // Uploaded (10/40 = 25%) converts worse than Clipped (10/10 = 100%) --
    // the honest gap the task exists to surface.
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
  });
});
