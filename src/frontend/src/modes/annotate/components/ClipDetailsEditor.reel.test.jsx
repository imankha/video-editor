import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipDetailsEditor } from './ClipDetailsEditor';
import { useProjectsStore } from '../../../stores/projectsStore';

// jsdom lacks matchMedia; ClipDetailsEditor renders through the real useIsMobile hook.
// matches:false => desktop, where the stage CTA renders.
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

// T9330: ClipDetailsEditor now consumes the shared getClipStage(region,
// linkedProject) helper instead of its own nested-ternary stage machine, and
// the CTA labels are Apply AI Focus / Apply Spotlight / View Final / View
// Published — superseding T9320's AI Focus / Spotlight / Completed /
// Published / Open clip (Draft). The manual "Create Clip" affordance
// (NO_PROJECT case) is unchanged.
describe('ClipDetailsEditor — stage-aware CTA (T9330, via getClipStage)', () => {
  it('shows an enabled "Create Clip" button when no project exists yet (NO_PROJECT)', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: null }} onUpdate={() => {}} onDelete={() => {}} />);
    const button = screen.getByRole('button', { name: 'Create Clip' });
    expect(button.disabled).toBe(false);
  });

  it('clicking "Create Clip" fires onUpdate({ createProject: true }) and shows a disabled transitional state while the request is in flight', () => {
    const onUpdate = vi.fn();
    render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: null }} onUpdate={onUpdate} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Clip' }));
    expect(onUpdate).toHaveBeenCalledWith({ createProject: true });
    const button = screen.getByRole('button', { name: 'Clip Created' });
    expect(button.disabled).toBe(true);
  });

  it('shows an enabled "Apply AI Focus" button once region.autoProjectId is set (FOCUS stage)', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Clip Created' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Apply AI Focus' });
    expect(button.disabled).toBe(false);
  });

  it('clicking "Apply AI Focus" calls onOpenInFocus with the clip\'s autoProjectId', () => {
    const onOpenInFocus = vi.fn();
    render(
      <ClipDetailsEditor
        region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
        onUpdate={() => {}}
        onDelete={() => {}}
        onOpenInFocus={onOpenInFocus}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply AI Focus' }));
    expect(onOpenInFocus).toHaveBeenCalledTimes(1);
    expect(onOpenInFocus).toHaveBeenCalledWith(42);
  });

  describe('once the linked project has a stage (T8060)', () => {
    afterEach(() => {
      useProjectsStore.setState({ projects: [] });
    });

    it('still shows "Apply AI Focus" when the linked project has not been exported yet', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: false, has_final_video: false, is_published: false }] });
      render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }} onUpdate={() => {}} onDelete={() => {}} />);
      expect(screen.getByRole('button', { name: 'Apply AI Focus' })).toBeTruthy();
    });

    it('shows "Apply Spotlight" once Focus has been exported (has_working_video)', () => {
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
      expect(screen.queryByRole('button', { name: 'Apply AI Focus' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Apply Spotlight' }));
      expect(onOpenInOverlay).toHaveBeenCalledWith(42);
    });

    it('shows a "View Final" button (not a plain status) once Overlay has exported a final video, not published', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: true, is_published: false }] });
      const onOpenInFocus = vi.fn();
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
          onUpdate={() => {}}
          onDelete={() => {}}
          onOpenInFocus={onOpenInFocus}
        />
      );
      const button = screen.getByRole('button', { name: 'View Final' });
      expect(button).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Apply AI Focus' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Apply Spotlight' })).toBeNull();
      fireEvent.click(button);
      expect(onOpenInFocus).toHaveBeenCalledWith(42);
    });

    it('shows a "View Published" button once the project is published', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: true, is_published: true }] });
      render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }} onUpdate={() => {}} onDelete={() => {}} />);
      expect(screen.getByRole('button', { name: 'View Published' })).toBeTruthy();
    });
  });

  // T8070: the produced stage is shown ONLY while the clip's current boundaries
  // still match the window the project was built from (reelSourceStartTime/EndTime).
  // Drifted/below-migration now render "Apply AI Focus" (opens the existing
  // project) instead of falling back to the manual "Create Clip" — T9330
  // deliberate behavior change (a project that EXISTS should open, not offer
  // to re-create).
  describe('project-source staleness (T8070) — T9330: drifted opens, does not re-offer create', () => {
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
      expect(screen.getByRole('button', { name: 'View Final' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Create Clip' })).toBeNull();
    });

    it('falls back to "Apply AI Focus" (not "Create Clip") when the START time drifted from the reel-source window', () => {
      useProjectsStore.setState({ projects: [completedProject] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, startTime: 3, endTime: 8, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByRole('button', { name: 'View Final' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create Clip' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Apply AI Focus' })).toBeTruthy();
    });

    it('falls back to "Apply AI Focus" when the END time drifted from the reel-source window', () => {
      useProjectsStore.setState({ projects: [completedProject] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, startTime: 2, endTime: 9, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByRole('button', { name: 'View Final' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Apply AI Focus' })).toBeTruthy();
    });

    it('stays on "Apply AI Focus" (not Create Clip) when a not-yet-exported project has drifted boundaries', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: false, has_final_video: false, is_published: false }] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, startTime: 3, endTime: 8, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByRole('button', { name: 'Apply AI Focus' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Create Clip' })).toBeNull();
    });

    it('restores the produced status when boundaries are reverted to the EXACT reel-source values', () => {
      useProjectsStore.setState({ projects: [completedProject] });
      // exact revert: startTime/endTime back to reelSource values -> View Final shows again
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, startTime: 2, endTime: 8, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByRole('button', { name: 'View Final' })).toBeTruthy();
    });

    it('shows "Apply AI Focus" (not "Create Clip") when the snapshot is null (below-migration project with a produced video)', () => {
      useProjectsStore.setState({ projects: [completedProject] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByRole('button', { name: 'View Final' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create Clip' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Apply AI Focus' })).toBeTruthy();
    });
  });

  // T8470 (Part D): a project exists the moment project_created lands, but a
  // fresh draft has no reel-source snapshot and no produced video. That state
  // maps to FOCUS/"Apply AI Focus" (subsumes the old "Open clip (Draft)" label).
  describe('fresh draft project — subsumed into "Apply AI Focus" (T8470 Part D)', () => {
    afterEach(() => {
      useProjectsStore.setState({ projects: [] });
    });

    it('shows "Apply AI Focus" (not "Create Clip") right after creation, before the projects list refreshes', () => {
      // linkedProject not yet in the store (fetchProjects still in flight)
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByRole('button', { name: 'Create Clip' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Apply AI Focus' })).toBeTruthy();
    });

    it('shows "Apply AI Focus" for a linked draft with no produced video yet', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: false, has_final_video: false, is_published: false }] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.getByRole('button', { name: 'Apply AI Focus' })).toBeTruthy();
    });

    it('clicking "Apply AI Focus" opens Focus for the project via onOpenInFocus', () => {
      const onOpenInFocus = vi.fn();
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
          onUpdate={() => {}}
          onDelete={() => {}}
          onOpenInFocus={onOpenInFocus}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Apply AI Focus' }));
      expect(onOpenInFocus).toHaveBeenCalledWith(42);
    });

    it('a below-migration project WITH a produced video but null snapshot shows "Apply AI Focus", not the manual Create Clip', () => {
      useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: true, is_published: false }] });
      render(
        <ClipDetailsEditor
          region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
          onUpdate={() => {}}
          onDelete={() => {}}
        />
      );
      expect(screen.queryByRole('button', { name: 'Create Clip' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Apply AI Focus' })).toBeTruthy();
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

    it('never renders the stage control (Create Clip or Apply AI Focus) — desktop only', () => {
      render(<ClipDetailsEditor region={{ ...baseRegion, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }} onUpdate={() => {}} onDelete={() => {}} />);
      expect(screen.queryByRole('button', { name: 'Apply AI Focus' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Create Clip' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Clip Created' })).toBeNull();
    });
  });
});
