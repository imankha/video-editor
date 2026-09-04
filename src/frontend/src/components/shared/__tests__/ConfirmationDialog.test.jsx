import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfirmationDialog } from '../ConfirmationDialog';

// Mock the telemetry util so no network/side effect fires from impressionKey.
vi.mock('../../../utils/uiTelemetry', () => ({
  recordUiImpression: vi.fn(),
}));

describe('ConfirmationDialog — T8520 additive props', () => {
  it('renders the illustration node above the message when provided', () => {
    render(
      <ConfirmationDialog
        isOpen
        title="Your reel is exported"
        message="Add a spotlight overlay?"
        illustration={<div data-testid="my-illustration">art</div>}
        buttons={[{ label: 'OK', onClick: () => {} }]}
      />
    );
    expect(screen.getByTestId('my-illustration')).toBeTruthy();
  });

  it('applies panelTestId to the inner panel div', () => {
    render(
      <ConfirmationDialog
        isOpen
        title="t"
        message="m"
        panelTestId="export-complete-choice"
        buttons={[{ label: 'OK', onClick: () => {} }]}
      />
    );
    expect(screen.getByTestId('export-complete-choice')).toBeTruthy();
  });

  it('footer uses mobile-stacking classes (flex-col-reverse below sm)', () => {
    render(
      <ConfirmationDialog
        isOpen
        title="t"
        message="m"
        panelTestId="panel"
        buttons={[
          { label: 'Cancel', onClick: () => {} },
          { label: 'Confirm', variant: 'cyan', onClick: () => {} },
        ]}
      />
    );
    // The footer is the last child of the panel.
    const panel = screen.getByTestId('panel');
    const footer = panel.querySelector('.flex-col-reverse');
    expect(footer).toBeTruthy();
    expect(footer.className).toContain('sm:flex-row');
    expect(footer.className).toContain('sm:justify-end');
  });

  it('does not render when isOpen is false', () => {
    render(
      <ConfirmationDialog
        isOpen={false}
        title="t"
        message="m"
        panelTestId="panel"
        buttons={[{ label: 'OK', onClick: () => {} }]}
      />
    );
    expect(screen.queryByTestId('panel')).toBeNull();
  });
});
