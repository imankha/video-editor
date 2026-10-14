import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import InstructionCoach from './InstructionCoach';

afterEach(cleanup);

describe('T12700: guide close button tap target', () => {
  it('is at least 44x44 px', () => {
    render(<InstructionCoach>Hi</InstructionCoach>);
    const cls = screen.getByRole('button', { name: 'Turn off guidance' }).className;
    expect(cls).toContain('h-11');
    expect(cls).toContain('w-11');
  });
});
