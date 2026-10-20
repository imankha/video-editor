import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlaysOnlyPanel } from './PlaysOnlyPanel';

describe('T12930 Annotate plays-only panel', () => {
  it('explains the state and offers Restore', () => {
    const onRestore = vi.fn();
    render(<PlaysOnlyPanel onRestore={onRestore} />);
    expect(screen.getByText(/keeps only its marked plays/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /restore full video/i }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });
});
