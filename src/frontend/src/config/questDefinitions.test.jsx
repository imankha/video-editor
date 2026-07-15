import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { STEP_DESCRIPTIONS, STEP_TITLES } from './questDefinitions.jsx';
import { QUEST_DEFINITIONS } from '../data/questDefinitions.js';

// T3780: open_framing text wayfinding ("Click the Home button... open Drafts")
// replaced with a clickable "Open your reel" deep link.

describe('questDefinitions copy (T3780)', () => {
  describe('open_framing deep link', () => {
    it('renders a clickable "Open your reel" control', () => {
      const { getByRole } = render(<>{STEP_DESCRIPTIONS.open_framing}</>);
      const button = getByRole('button', { name: /open your reel/i });
      expect(button).toBeTruthy();
    });

    it('drops the old "Home button" text wayfinding', () => {
      const { container } = render(<>{STEP_DESCRIPTIONS.open_framing}</>);
      expect(container.textContent).not.toMatch(/Home button/i);
    });
  });
});

// T5160: the export-wait copy nudged first-run users to "frame your next reel"
// (leave the flow) while the upscale runs. Reword it to keep them on-task —
// their next step is adding the spotlight to THIS same reel.
describe('questDefinitions copy (T5160 export-wait)', () => {
  it('no longer nudges the user to frame another reel', () => {
    const { container } = render(<>{STEP_DESCRIPTIONS.wait_for_export}</>);
    expect(container.textContent).not.toMatch(/frame your next reel/i);
    expect(container.textContent).not.toMatch(/frame another reel/i);
  });

  it('keeps the user on-task toward the spotlight step', () => {
    const { container } = render(<>{STEP_DESCRIPTIONS.wait_for_export}</>);
    expect(container.textContent).toMatch(/spotlight/i);
  });

  it('leaves the wait_for_export title unchanged', () => {
    expect(STEP_TITLES.wait_for_export).toBe('Crisp It Up to 1080p');
  });
});

// T5150: the single annotate step was split into rate_clip (trim/rate/tag/note)
// and annotate_brilliant (confirm toggles + Save). The five rating stars are
// wrapped so the "*****" run never breaks across a line in the narrow panel.
describe('questDefinitions rate_clip split (T5150)', () => {
  it('resolves a title + description for the new rate_clip step', () => {
    expect(STEP_TITLES.rate_clip).toBe('Rate & Tag the Play');
    expect(STEP_DESCRIPTIONS.rate_clip).toBeTruthy();
    const { container } = render(<>{STEP_DESCRIPTIONS.rate_clip}</>);
    expect(container.textContent).toMatch(/rate the play/i);
  });

  it('retitles annotate_brilliant to the Save step', () => {
    expect(STEP_TITLES.annotate_brilliant).toBe('Save Your Reel');
    const { container } = render(<>{STEP_DESCRIPTIONS.annotate_brilliant}</>);
    expect(container.textContent).toMatch(/save/i);
  });

  it('keeps the trim/rate copy on rate_clip and the Save copy on annotate_brilliant', () => {
    const rate = render(<>{STEP_DESCRIPTIONS.rate_clip}</>).container.textContent;
    const save = render(<>{STEP_DESCRIPTIONS.annotate_brilliant}</>).container.textContent;
    // Rating copy lives on rate_clip, not on the Save step
    expect(rate).toMatch(/start time and end time/i);
    expect(save).not.toMatch(/rate the play/i);
    // Save/toggle copy lives on annotate_brilliant, not on rate_clip
    expect(save).toMatch(/create reel/i);
    expect(rate).not.toMatch(/create reel/i);
  });

  it('wraps all five rating stars in a single non-wrapping container', () => {
    const { container } = render(<>{STEP_DESCRIPTIONS.rate_clip}</>);
    // Exactly five stars render in the description
    const allStars = container.querySelectorAll('svg.lucide-star');
    expect(allStars.length).toBe(5);
    // A single whitespace-nowrap span holds them so "*****" can't break a line
    const nowrap = container.querySelector('span.whitespace-nowrap');
    expect(nowrap).toBeTruthy();
    // Every star is inside that one nowrap span (none leaked outside it)
    const nowrapStars = nowrap.querySelectorAll('svg.lucide-star');
    expect(nowrapStars.length).toBe(5);
  });

  it('mirrors the rate_clip step into the data structure copy (SSOT sync)', () => {
    const q1 = QUEST_DEFINITIONS.find((q) => q.id === 'quest_1');
    expect(q1.step_ids).toEqual([
      'watch_annotate_tutorial',
      'upload_game',
      'add_clip',
      'rate_clip',
      'annotate_brilliant',
      'playback_annotations',
    ]);
    // Every step id in the structure mirror resolves a title in the UI layer.
    for (const stepId of q1.step_ids) {
      expect(STEP_TITLES[stepId], `missing title for ${stepId}`).toBeTruthy();
    }
  });
});

// T5170: the two spotlight-render steps move from Publish (quest_4) to the end
// of Configure Your Spotlight (quest_3). The data mirror must stay in sync with
// the backend SSOT, and every moved step must still resolve a title.
describe('questDefinitions overlay-quest move (T5170)', () => {
  it('appends the render steps to the end of quest_3 in the data mirror', () => {
    const q3 = QUEST_DEFINITIONS.find((q) => q.id === 'quest_3');
    expect(q3.step_ids).toEqual([
      'watch_overlay_tutorial',
      'open_overlay',
      'select_players',
      'choose_color',
      'choose_shape',
      'export_overlay',
      'wait_for_overlay',
    ]);
    expect(q3.step_ids.slice(-2)).toEqual(['export_overlay', 'wait_for_overlay']);
  });

  it('leaves quest_4 with only tutorial + publish steps', () => {
    const q4 = QUEST_DEFINITIONS.find((q) => q.id === 'quest_4');
    expect(q4.step_ids).toEqual([
      'watch_publish_tutorial',
      'move_to_my_reels',
      'view_gallery_video',
    ]);
    expect(q4.step_ids).not.toContain('export_overlay');
    expect(q4.step_ids).not.toContain('wait_for_overlay');
  });

  it('resolves titles + descriptions for the moved render steps', () => {
    for (const stepId of ['export_overlay', 'wait_for_overlay']) {
      expect(STEP_TITLES[stepId], `missing title for ${stepId}`).toBeTruthy();
      expect(STEP_DESCRIPTIONS[stepId], `missing description for ${stepId}`).toBeTruthy();
    }
  });

  it('has no duplicate step ids across all quests after the move', () => {
    const all = QUEST_DEFINITIONS.flatMap((q) => q.step_ids);
    expect(new Set(all).size).toBe(all.length);
  });
});
