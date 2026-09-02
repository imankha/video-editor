import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SportQuestionOverlay } from './SportQuestionOverlay';
import { SUPPORTED_SPORTS } from '../constants/tagRegistry';

// T8140: the single full-screen "What sport is this?" question shown at a mobile
// first save while the profile is still no_sport.

describe('SportQuestionOverlay (T8140)', () => {
  it('renders the question and one big target per supported sport', () => {
    render(<SportQuestionOverlay onPick={() => {}} onSkip={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'What sport is this?' })).toBeTruthy();
    for (const s of SUPPORTED_SPORTS) {
      expect(screen.getByRole('button', { name: new RegExp(s.name) })).toBeTruthy();
    }
  });

  it('calls onPick with the chosen sport id', () => {
    const onPick = vi.fn();
    render(<SportQuestionOverlay onPick={onPick} onSkip={() => {}} />);
    const first = SUPPORTED_SPORTS[0];
    fireEvent.click(screen.getByRole('button', { name: new RegExp(first.name) }));
    expect(onPick).toHaveBeenCalledWith(first.id);
  });

  it('calls onSkip from "Skip for now" (no dead-end)', () => {
    const onSkip = vi.fn();
    render(<SportQuestionOverlay onPick={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
