import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Pencil } from 'lucide-react';
import ActionCard from './ActionCard';
import CtaBar from './CtaBar';
import FramingActionRow from '../../modes/focus/FramingActionRow';

// T12450: below sm a band/panel card collapses to a short icon-left row (no caption) so the
// pinned band stops eating 35-55% of a phone screen; label wraps instead of truncating.
describe('ActionCard phoneRow (T12450)', () => {
  it('is a short row on phones with the caption hidden and a wrapping title', () => {
    render(<ActionCard phoneRow icon={Pencil} title="Finish without spotlight" description="Only you can see it until you share a link." />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('max-sm:flex-row');
    expect(btn.className).toContain('max-sm:!min-h-12');
    expect(btn.className).not.toContain('max-sm:!min-h-[108px]');
    expect(screen.getByText('Finish without spotlight').className).toContain('max-sm:whitespace-normal');
    expect(screen.getByText('Only you can see it until you share a link.').className).toContain('max-sm:hidden');
  });

  it('default cards are unchanged', () => {
    render(<ActionCard icon={Pencil} title="Edit play" description="x" />);
    expect(screen.getByRole('button').className).not.toContain('max-sm:');
  });

  it('CtaBar band/panel cards use the phone row; primary stays first', () => {
    render(<CtaBar layout="panel" primary={{ title: 'Add spotlight', onClick() {} }} secondary={[{ title: 'Finish without spotlight', description: 'cap', onClick() {} }]} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].textContent).toContain('Add spotlight');
    buttons.forEach((b) => expect(b.className).toContain('max-sm:flex-row'));
  });

  it('Focus Trim/Preview tiles use the phone row', () => {
    render(<FramingActionRow onToggleTrim={() => {}} onTogglePreview={() => {}} />);
    expect(screen.getByTestId('trim-slowmo-button').className).toContain('max-sm:flex-row');
    expect(screen.getByTestId('framing-preview-toggle').className).toContain('max-sm:flex-row');
  });
});
