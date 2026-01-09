import { describe, it, expect, beforeEach } from 'vitest';
import { useNavigationStore } from './navigationStore';

describe('navigationStore', () => {
  beforeEach(() => {
    useNavigationStore.getState().reset();
  });

  it('starts with project-manager mode', () => {
    expect(useNavigationStore.getState().mode).toBe('project-manager');
  });

  it('navigates to new mode', () => {
    const { navigate } = useNavigationStore.getState();
    navigate('framing');
    expect(useNavigationStore.getState().mode).toBe('framing');
    expect(useNavigationStore.getState().previousMode).toBe('project-manager');
  });

  it('does not navigate to same mode', () => {
    const { navigate } = useNavigationStore.getState();
    navigate('framing');
    navigate('framing');
    expect(useNavigationStore.getState().history.length).toBe(1);
  });

  it('goes back to previous mode', () => {
    const { navigate, goBack } = useNavigationStore.getState();
    navigate('framing');
    navigate('overlay');
    goBack();
    expect(useNavigationStore.getState().mode).toBe('framing');
  });

  it('sets and clears project', () => {
    const { setProjectId, clearProject } = useNavigationStore.getState();
    setProjectId(123);
    expect(useNavigationStore.getState().projectId).toBe(123);
    clearProject();
    expect(useNavigationStore.getState().projectId).toBe(null);
    expect(useNavigationStore.getState().mode).toBe('project-manager');
  });

  it('tracks navigation history', () => {
    const { navigate } = useNavigationStore.getState();
    navigate('framing');
    navigate('overlay');
    navigate('annotate');
    expect(useNavigationStore.getState().history).toEqual(['project-manager', 'framing', 'overlay']);
  });
});
