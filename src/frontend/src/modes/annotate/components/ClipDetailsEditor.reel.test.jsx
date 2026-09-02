import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipDetailsEditor } from './ClipDetailsEditor';
import { useProjectsStore } from '../../../stores/projectsStore';

// jsdom lacks matchMedia; ClipDetailsEditor renders through the real useIsMobile hook.
// matches:false => desktop, where the Reel button renders.
beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

const baseRegion = {
  id: 'c1',
  startTime: 0,
  endTime: 10,
  rating: 4,
  tags: [],
  notes: '',
  name: 'Test clip',
};

// T8040: once a reel exists for a clip (region.autoProjectId), the dead-end
// disabled "Reel Created" button is replaced with an actionable "Focus"
// button that opens that reel directly.
describe('ClipDetailsEditor — Reel button (T8040)', () => {
  it('shows an enabled "Create Reel" button when no reel exists yet', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: null }} onUpdate={() => {}} onDelete={() => {}} />);
    const button = screen.getByRole('button', { name: 'Create Reel' });
    expect(button.disabled).toBe(false);
  });

  it('clicking "Create Reel" fires onUpdate({ createProject: true }) and shows a disabled transitional state while the request is in flight', () => {
    const onUpdate = vi.fn();
    render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: null }} onUpdate={onUpdate} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Reel' }));
    expect(onUpdate).toHaveBeenCalledWith({ createProject: true });
    const button = screen.getByRole('button', { name: 'Reel Created' });
    expect(button.disabled).toBe(true);
  });

  it('shows an enabled "Focus" button once region.autoProjectId is set, not a disabled "Reel Created"', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Reel Created' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Focus' });
    expect(button.disabled).toBe(false);
  });

  it('clicking "Focus" calls onOpenInFocus with the clip\'s autoProjectId', () => {
    const onOpenInFocus = vi.fn();
    render(
      <ClipDetailsEditor
        region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
        onUpdate={() => {}}
        onDelete={() => {}}
        onOpenInFocus={onOpenInFocus}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(onOpenInFocus).toHaveBeenCalledTimes(1);
    expect(onOpenInFocus).toHaveBeenCalledWith(42);
  });

  describe('once the linked project has a stage (T8060)', () => {
    afterEach(() => {
      useProjectsStore.setState({ projects: [] });
    });

    it('still shows "Focus" when the linked project has not been exported yet', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: false, has_final_video: false, is_published: false }] });
      render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }} onUpdate={() => {}} onDelete={() => {}} />);
      expect(screen.getByRole('button', { name: 'Focus' })).toBeTruthy();
    });

    it('shows "Overlay" once Focus has been exported (has_working_video)', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: false, is_published: false }] });
      const onOpenInOverlay = vi.fn();
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
          onUpdate={() => {}}
          onDelete={() => {}}
          onOpenInOverlay={onOpenInOverlay}
        />
      );
      expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Overlay' }));
      expect(onOpenInOverlay).toHaveBeenCalledWith(42);
    });

    it('shows a "Completed" status (no button) once Overlay has exported a final video', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: true, is_published: false }] });
      render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }} onUpdate={() => {}} onDelete={() => {}} />);
      expect(screen.getByText('Completed')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Overlay' })).toBeNull();
    });

    it('shows a "Published" status (no button) once the reel is published', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: true, is_published: true }] });
      render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }} onUpdate={() => {}} onDelete={() => {}} />);
      expect(screen.getByText('Published')).toBeTruthy();
    });
  });

  // T8070: the produced stage is shown ONLY while the clip's current boundaries
  // still match the window the reel was built from (reelSourceStartTime/EndTime).
  describe('reel-source staleness (T8070)', () => {
    afterEach(() => {
      useProjectsStore.setState({ projects: [] });
    });

    const completedProject = { id: 42, has_working_video: true, has_final_video: true, is_published: false };

    it('shows the produced status when the clip boundaries EXACTLY match the reel-source window', () => {
      useProjectsStore.setState({ projects: [completedProject] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, startTime: 2, endTime: 8, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByText('Completed')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Create Reel' })).toBeNull();
    });

    it('falls back to "Create Reel" when the START time drifted from the reel-source window', () => {
      useProjectsStore.setState({ projects: [completedProject] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, startTime: 3, endTime: 8, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByText('Completed')).toBeNull();
      expect(screen.getByRole('button', { name: 'Create Reel' })).toBeTruthy();
    });

    it('falls back to "Create Reel" when the END time drifted from the reel-source window', () => {
      useProjectsStore.setState({ projects: [completedProject] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, startTime: 2, endTime: 9, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByText('Completed')).toBeNull();
      expect(screen.getByRole('button', { name: 'Create Reel' })).toBeTruthy();
    });

    it('hides the Focus stage too when a not-yet-exported reel has drifted boundaries', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: false, has_final_video: false, is_published: false }] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, startTime: 3, endTime: 8, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Create Reel' })).toBeTruthy();
    });

    it('restores the produced status when boundaries are reverted to the EXACT reel-source values', () => {
      useProjectsStore.setState({ projects: [completedProject] });
      // exact revert: startTime/endTime back to reelSource values -> Completed shows again
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, startTime: 2, endTime: 8, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByText('Completed')).toBeTruthy();
    });

    it('shows "Create Reel" when the snapshot is null (no produced reel / below-migration)', () => {
      useProjectsStore.setState({ projects: [completedProject] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByText('Completed')).toBeNull();
      expect(screen.getByRole('button', { name: 'Create Reel' })).toBeTruthy();
    });
  });

  describe('on mobile', () => {
    beforeEach(() => {
      window.matchMedia = (query) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      });
    });

    it('never renders the Reel control (Create Reel or Focus) — desktop only', () => {
      render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }} onUpdate={() => {}} onDelete={() => {}} />);
      expect(screen.queryByRole('button', { name: 'Focus' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create Reel' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Reel Created' })).toBeNull();
    });
  });
});
