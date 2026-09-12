import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T9330 §2.1/§2.2/§2.7 — after a create-save resolves, the strip editor stays
// open (desktop), landing EDITING on the NEWLY CREATED region atomically
// (never a transient close). The freshly created clip must read CLEAN (not
// dirty) the instant it opens — hasUnsavedEdits() must not trip the T8730
// confirm-then-navigate dialog. The CTA is disabled ("Frame this clip",
// focusPending) until the late setAutoProjectId lands, then goes live via a
// pure re-render (no reactive write).

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => {
  mockViewport(false); // desktop — the stay-open target surface (strip layout)
  useProjectsStore.setState({ projects: [] });
});

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onCreateClip: () => {},
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  surface: 'inline_desktop',
  layout: 'strip',
};

describe('AnnotateFullscreenOverlay — stays open on the new clip after create-save (T9330)', () => {
  it('lands in edit mode on the NEW region the instant existingClip flips from null to the created clip, with no dirty flash', () => {
    const { rerender } = render(
      <AnnotateFullscreenOverlay {...baseProps} existingClip={null} />
    );
    // Save fires onCreateClip; the parent (state machine) resolves the create
    // atomically (CREATING -> EDITING) and re-renders with existingClip set to
    // the just-saved region's OWN stored values (rehydrate is the sole
    // population path — §2.2). autoProjectId has not landed yet (network still
    // in flight).
    const newRegion = {
      id: 'new_clip_1',
      startTime: 21, // currentTime(30) - DEFAULT_CLIP_BEFORE(9)
      endTime: 33,   // currentTime(30) + DEFAULT_CLIP_AFTER(3)
      rating: 4,
      tags: [],
      notes: '',
      name: '',
      tagged_teammates: [],
      my_athlete: true,
      autoProjectId: null,
    };
    // focusPending is derived in AnnotateModeView (existingClip.id ===
    // pendingProjectClipId && !autoProjectId) and passed as a prop — the overlay
    // receives it. Here we pass it directly, matching that contract.
    rerender(<AnnotateFullscreenOverlay {...baseProps} existingClip={newRegion} focusPending={true} />);

    // Overlay renders EDIT mode UI for the new clip (existingClip truthy).
    expect(screen.getByText('Edit play')).toBeTruthy();
    expect(screen.queryByText('Marking a play')).toBeNull();

    // The strip's Focus-family CTA must be visible even though autoProjectId
    // is still null — it renders disabled "Frame this clip" while focusPending
    // (createProject was requested at save time). Clicking it must NOT open
    // the T8730 "Save this play first?" dialog: a freshly created clip reads
    // clean instantly (rehydrate-only population path).
    const cta = screen.getByRole('button', { name: 'Frame this clip' });
    expect(cta.disabled).toBe(true);
    expect(screen.queryByText('Save this play first?')).toBeNull();
  });

  it('the disabled "Frame this clip" CTA becomes enabled once the late setAutoProjectId lands (pure re-render, no write)', () => {
    const newRegionPending = {
      id: 'new_clip_1', startTime: 21, endTime: 33, rating: 4, tags: [], notes: '',
      name: '', tagged_teammates: [], my_athlete: true, autoProjectId: null,
    };
    const { rerender } = render(
      <AnnotateFullscreenOverlay {...baseProps} existingClip={newRegionPending} focusPending={true} />
    );
    expect(screen.getByRole('button', { name: 'Frame this clip' }).disabled).toBe(true);

    // saveClip resolves -> setAutoProjectId(newRegion.id, project_id) -> the
    // region gains autoProjectId and pendingProjectClipId clears (focusPending
    // false). This is a pure prop/store update, no effect write triggered by the
    // overlay itself.
    const newRegionResolved = { ...newRegionPending, autoProjectId: 42 };
    rerender(<AnnotateFullscreenOverlay {...baseProps} existingClip={newRegionResolved} focusPending={false} />);

    const cta = screen.getByRole('button', { name: 'Frame this clip' });
    expect(cta.disabled).toBe(false);
  });

  it('does not read dirty (no confirm dialog) even after the late autoProjectId re-render', () => {
    const newRegionPending = {
      id: 'new_clip_1', startTime: 21, endTime: 33, rating: 4, tags: [], notes: '',
      name: '', tagged_teammates: [], my_athlete: true, autoProjectId: null,
    };
    const { rerender } = render(
      <AnnotateFullscreenOverlay {...baseProps} existingClip={newRegionPending} focusPending={true} />
    );
    const newRegionResolved = { ...newRegionPending, autoProjectId: 42 };
    rerender(<AnnotateFullscreenOverlay {...baseProps} existingClip={newRegionResolved} focusPending={false} />);

    // Live stage now derives FOCUS ("Frame this clip", enabled) from the helper.
    // Clicking must navigate directly (no unsaved edits) rather than prompting.
    const onOpenInFocus = vi.fn();
    rerender(
      <AnnotateFullscreenOverlay {...baseProps} existingClip={newRegionResolved} focusPending={false} onOpenInFocus={onOpenInFocus} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Frame this clip' }));
    expect(screen.queryByText('Save this play first?')).toBeNull();
    expect(onOpenInFocus).toHaveBeenCalledWith(42);
  });
});
