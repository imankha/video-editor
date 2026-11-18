import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useFirstRunCredits, isNewAccountForCreditHint } from './useFirstRunCredits';
import { useCreditStore } from '../stores/creditStore';
import { useProfileStore } from '../stores/profileStore';
import { resolveGuide, homeFacts } from '../components/instructions/resolveGuide';

// T17090 + T17200: the free-credits wording in the Home first-run coach line applies only
// to a one-profile account; a second profile shares the account's credits (not a gift).

describe('isNewAccountForCreditHint (T17090)', () => {
  it('true only for a loaded, one-profile account', () => {
    expect(isNewAccountForCreditHint({ profilesLoaded: true, profileCount: 1 })).toBe(true);
    expect(isNewAccountForCreditHint({ profilesLoaded: true, profileCount: 2 })).toBe(false);
    expect(isNewAccountForCreditHint({ profilesLoaded: false, profileCount: 0 })).toBe(false);
  });
});

describe('useFirstRunCredits drives the coach line', () => {
  beforeEach(() => { useCreditStore.setState({ balance: 88, loaded: true }); });

  const coachTitle = (credits) => resolveGuide(homeFacts({ tab: 'games', credits })).message.title;

  it('one profile: names the free credits', () => {
    useProfileStore.setState({ profiles: [{ id: 'p1' }], isInitialized: true });
    const { result } = renderHook(() => useFirstRunCredits());
    expect(result.current).toBe(88);
    expect(coachTitle(result.current)).toMatch(/^Upload your game to start\. You have 88 free credits/);
  });

  it('two profiles: no credits claim, plain "Upload your game to start."', () => {
    useProfileStore.setState({ profiles: [{ id: 'p1' }, { id: 'p2' }], isInitialized: true });
    const { result } = renderHook(() => useFirstRunCredits());
    expect(result.current).toBeNull();
    expect(coachTitle(result.current)).toBe('Upload your game to start.');
  });

  it('profiles not loaded yet or credits not loaded: null', () => {
    useProfileStore.setState({ profiles: [], isInitialized: false });
    expect(renderHook(() => useFirstRunCredits()).result.current).toBeNull();
    useProfileStore.setState({ profiles: [{ id: 'p1' }], isInitialized: true });
    useCreditStore.setState({ loaded: false });
    expect(renderHook(() => useFirstRunCredits()).result.current).toBeNull();
  });
});
