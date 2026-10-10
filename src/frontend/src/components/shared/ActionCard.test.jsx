import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Pencil } from 'lucide-react';
import ActionCard from './ActionCard';

// T12380: title and description are sibling spans; without a separator the accessible
// name runs them together ("Edit playAdjust ...").
describe('ActionCard accessible name', () => {
  it('separates title from description', () => {
    render(<ActionCard icon={Pencil} title="Edit play" description="Adjust the timing, rating, and tags for this play." />);
    expect(screen.getByRole('button', { name: 'Edit play. Adjust the timing, rating, and tags for this play.' })).toBeTruthy();
  });

  it('has no stray separator when there is no description', () => {
    render(<ActionCard icon={Pencil} title="Edit play" />);
    expect(screen.getByRole('button', { name: 'Edit play' })).toBeTruthy();
  });
});
