/**
 * T13247: Add footage takes a zip of clips, says so, and refuses a Veo zip's import sheet
 * on a game the old "Import Veo highlights" card was disabled on (expired / plays-only).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { pickerProps } = vi.hoisted(() => ({ pickerProps: { current: null } }));
vi.mock('../../components/GameFootagePicker', () => ({
  GameFootagePicker: (props) => { pickerProps.current = props; return <div data-testid="picker-stub" />; },
}));
vi.mock('../../services/uploadManager', () => ({
  attachVideoToExistingGame: vi.fn(),
  UPLOAD_PHASE: { HASHING: 'hashing', ERROR: 'error' },
}));

import { AddFootageButton } from './AddFootageButton';

describe('T13247 AddFootageButton zip of clips', () => {
  it('the card says it takes a zip of clips', () => {
    render(<AddFootageButton variant="card" gameId={2} onVeoZip={vi.fn()} />);
    expect(screen.getByText('Add another video or a zip of clips.')).toBeTruthy();
  });

  it('hands a Veo zip on when the game allows it', () => {
    const onVeoZip = vi.fn();
    render(<AddFootageButton variant="card" gameId={2} onVeoZip={onVeoZip} />);
    fireEvent.click(screen.getByTestId('add-footage-button'));
    expect(pickerProps.current.veoZipRefusal ?? null).toBeNull();
    const zip = new File(['z'], 'v.zip');
    pickerProps.current.onVeoZip(zip);
    expect(onVeoZip).toHaveBeenCalledWith(zip);
  });

  it('blocks the import sheet on an expired / plays-only game, with the picker error line', () => {
    render(<AddFootageButton variant="card" gameId={2} onVeoZip={vi.fn()} veoZipDisabled />);
    fireEvent.click(screen.getByTestId('add-footage-button'));
    expect(pickerProps.current.veoZipRefusal).toBe("These highlights can't be imported into this game.");
    // The card itself stays usable: footage can still be added.
    expect(screen.getByTestId('add-footage-submit')).toBeTruthy();
  });
});
