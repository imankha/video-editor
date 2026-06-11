import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SegmentedProgressStrip } from './ProjectManager';

// T3540: in-progress segments must be visually distinct from done (shape, not just hue).
// In-progress renders a gray track with a blue bottom half-fill; done stays solid green.

function makeProject(overrides = {}) {
  return {
    clip_count: 1,
    clips_exported: 0,
    clips_in_progress: 0,
    clips: [],
    has_working_video: false,
    has_overlay_edits: false,
    has_final_video: false,
    ...overrides,
  };
}

function getSegmentByTitle(container, titleSubstring) {
  const segments = [...container.querySelectorAll('[title]')];
  return segments.find((el) => el.getAttribute('title').includes(titleSubstring));
}

function getHalfFill(segment) {
  return segment.querySelector('.h-1\\/2');
}

describe('SegmentedProgressStrip (T3540)', () => {
  it('renders in_progress clip segment as half-fill, not solid blue', () => {
    const { container } = render(
      <SegmentedProgressStrip project={makeProject({ clips_in_progress: 1 })} />
    );
    const segment = getSegmentByTitle(container, 'Clip 1');
    expect(segment).toBeTruthy();
    expect(segment.className).not.toContain('bg-blue-500');
    expect(segment.className).toContain('bg-gray-600');
    const halfFill = getHalfFill(segment);
    expect(halfFill).toBeTruthy();
    expect(halfFill.className).toContain('bg-blue-500');
    expect(halfFill.className).toContain('bottom-0');
  });

  it('renders in_progress overlay segment with the same half-fill treatment', () => {
    const { container } = render(
      <SegmentedProgressStrip
        project={makeProject({ has_overlay_edits: true, has_working_video: true })}
      />
    );
    const overlay = getSegmentByTitle(container, 'Overlay');
    expect(overlay.className).not.toContain('bg-blue-500');
    expect(getHalfFill(overlay)).toBeTruthy();
  });

  it('renders done (framing complete) segment as solid green with no half-fill', () => {
    const { container } = render(
      <SegmentedProgressStrip project={makeProject({ has_working_video: true })} />
    );
    const framing = getSegmentByTitle(container, 'Framing');
    expect(framing.className).toContain('bg-green-500');
    expect(getHalfFill(framing)).toBeNull();
  });

  it('renders pending clip segment as solid gray with no half-fill', () => {
    const { container } = render(
      <SegmentedProgressStrip project={makeProject({ clip_count: 2, clips_in_progress: 1 })} />
    );
    const pending = getSegmentByTitle(container, 'Clip 2');
    expect(pending.className).toContain('bg-gray-600');
    expect(getHalfFill(pending)).toBeNull();
  });

  it('leaves exporting, failed, disconnected, and ready treatments unchanged', () => {
    const exporting = render(
      <SegmentedProgressStrip project={makeProject()} isExporting="framing" />
    );
    const exportingSeg = getSegmentByTitle(exporting.container, 'Framing');
    expect(exportingSeg.className).toContain('bg-amber-500');
    expect(getHalfFill(exportingSeg)).toBeNull();

    const failed = render(
      <SegmentedProgressStrip project={makeProject()} failedExportType="framing" />
    );
    const failedSeg = getSegmentByTitle(failed.container, 'Framing');
    expect(failedSeg.className).toContain('bg-orange-500');
    expect(getHalfFill(failedSeg)).toBeNull();

    const disconnected = render(
      <SegmentedProgressStrip project={makeProject()} isExporting="framing" isOffline={true} />
    );
    const disconnectedSeg = getSegmentByTitle(disconnected.container, 'Framing');
    expect(disconnectedSeg.className).toContain('bg-gray-400');
    expect(getHalfFill(disconnectedSeg)).toBeNull();

    const ready = render(
      <SegmentedProgressStrip project={makeProject({ has_working_video: true })} />
    );
    const readySeg = getSegmentByTitle(ready.container, 'Overlay');
    expect(readySeg.className).toContain('bg-blue-300');
    expect(getHalfFill(readySeg)).toBeNull();
  });

  it('uses "Started" tooltip wording for in_progress segments instead of "Editing"', () => {
    const { container } = render(
      <SegmentedProgressStrip
        project={makeProject({ clips_in_progress: 1, has_overlay_edits: true })}
      />
    );
    const clipSeg = getSegmentByTitle(container, 'Clip 1');
    expect(clipSeg.getAttribute('title')).toContain('Started - export framing to complete');
    expect(clipSeg.getAttribute('title')).not.toContain('Editing');

    const overlaySeg = getSegmentByTitle(container, 'Overlay');
    expect(overlaySeg.getAttribute('title')).toContain('Started - export to complete');
    expect(overlaySeg.getAttribute('title')).not.toContain('Editing');
  });
});
