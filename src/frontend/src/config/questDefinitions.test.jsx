import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STEP_DESCRIPTIONS, STEP_TITLES } from './questDefinitions.jsx';
import { SECTION_NAMES } from './displayNames';
import { QUEST_DEFINITIONS } from '../data/questDefinitions.js';

// T3780: open_framing text wayfinding ("Click the Home button... open Drafts")
// replaced with a clickable "Open your reel" deep link.
// T5150 (follow-up): the deep link was itself confusing -- it let the user skip
// past the real "Reel Drafts" tab instead of learning where it is. Replaced
// with a static visual replica of that tab (icon + label, non-clickable) so
// the copy points at the actual on-screen button.
// T8360: the tab itself was renamed "Reel Drafts" -> "Clips" (SECTION_NAMES.CLIPS).

describe('questDefinitions copy (T3780)', () => {
  describe('open_framing wayfinding', () => {
    it('visually references the Clips tab by icon + label, not a deep link', () => {
      const { container, queryByRole } = render(<>{STEP_DESCRIPTIONS.open_framing}</>);
      expect(container.textContent).toMatch(/Clips/i);
      expect(queryByRole('button')).toBeNull();
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
    // T9575: epic vocabulary — the step saves a PLAY (which produces a clip), so
    // the title is "Save your play", not the old single-clip-"reel" wording.
    expect(STEP_TITLES.annotate_brilliant).toBe('Save your play');
    const { container } = render(<>{STEP_DESCRIPTIONS.annotate_brilliant}</>);
    expect(container.textContent).toMatch(/save/i);
  });

  it('keeps the trim/rate copy on rate_clip and the Save copy on annotate_brilliant', () => {
    const rate = render(<>{STEP_DESCRIPTIONS.rate_clip}</>).container.textContent;
    const save = render(<>{STEP_DESCRIPTIONS.annotate_brilliant}</>).container.textContent;
    // Rating copy lives on rate_clip, not on the Save step
    expect(rate).toMatch(/start time and end time/i);
    expect(save).not.toMatch(/rate the play/i);
    // Save/toggle copy lives on annotate_brilliant, not on rate_clip. T9575: the
    // toggle is the epic's "Create an editable clip", never the old "Create Reel".
    expect(save).toMatch(/create an editable clip/i);
    expect(save).not.toMatch(/create reel/i);
    expect(rate).not.toMatch(/create an editable clip/i);
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

  it('leaves quest_4 with tutorial + publish steps (preview added by T6840)', () => {
    const q4 = QUEST_DEFINITIONS.find((q) => q.id === 'quest_4');
    expect(q4.step_ids).toEqual([
      'watch_publish_tutorial',
      'preview_draft',
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

// T8120: per-quest credit rewards are RETIRED — the full chain total is granted
// upfront (at signup / next login), so the panel no longer drips credits per quest.
// The data mirror must stay in sync with the backend (quest_config.py), which zeroes
// every quest reward.
describe('questDefinitions rewards retired (T8120)', () => {
  it('every quest reward is 0 (credits granted upfront, not dripped)', () => {
    for (const q of QUEST_DEFINITIONS) {
      expect(q.reward, `quest ${q.id} still drips a reward`).toBe(0);
    }
  });
});

// T6840: a dedicated "Watch Your Preview" step lands between the render-wait step
// and Move to My Reels, and the preview sentence moves out of move_to_my_reels'
// copy into the new step's description.
describe('questDefinitions preview step (T6840)', () => {
  it('orders preview_draft immediately before move_to_my_reels', () => {
    const q4 = QUEST_DEFINITIONS.find((q) => q.id === 'quest_4');
    const previewIdx = q4.step_ids.indexOf('preview_draft');
    const moveIdx = q4.step_ids.indexOf('move_to_my_reels');
    expect(previewIdx).toBeGreaterThan(-1);
    expect(moveIdx).toBe(previewIdx + 1);
  });

  it('resolves a title + description for preview_draft', () => {
    expect(STEP_TITLES.preview_draft).toBe('Watch Your Preview');
    const { container } = render(<>{STEP_DESCRIPTIONS.preview_draft}</>);
    expect(container.textContent).toMatch(/preview/i);
  });

  it('moves the preview sentence out of move_to_my_reels copy', () => {
    const { container } = render(<>{STEP_DESCRIPTIONS.move_to_my_reels}</>);
    // move step keeps the publish gesture, no longer the "Press play... to preview" nudge
    expect(container.textContent).toMatch(/Move to/i);
    expect(container.textContent).not.toMatch(/press play/i);
  });
});

// T9575: the onboarding quest walkthrough was the last live cluster of pre-Shared-
// Vocabulary-epic copy. Every step now uses the epic object model (play / clip /
// reel / player) and never calls a single-clip object a "reel" or a player an
// "athlete".
describe('questDefinitions vocabulary sweep (T9575)', () => {
  const renderedText = (node) => render(<>{node}</>).container.textContent;
  const everyStepText = () =>
    [...Object.values(STEP_TITLES), ...Object.values(STEP_DESCRIPTIONS).map(renderedText)]
      .join('   ');

  it('never calls a single-clip object a "reel" in the walkthrough copy', () => {
    // "Highlight Reels" is the published-destination noun (SECTION_NAMES.LIBRARY),
    // the only place "reel" legitimately survives — strip it before scanning.
    const scrubbed = everyStepText().replaceAll(SECTION_NAMES.LIBRARY, '');
    expect(scrubbed).not.toMatch(/\breels?\b/i);
  });

  it('never calls a player an "athlete"', () => {
    expect(everyStepText()).not.toMatch(/athlete/i);
  });

  it('names the epic controls by their live labels', () => {
    const save = renderedText(STEP_DESCRIPTIONS.annotate_brilliant);
    expect(save).toMatch(/My player/);                 // ANNOTATE.LAYER_MINE (was "My Athlete")
    expect(save).toMatch(/Create an editable clip/);   // ANNOTATE.CREATE_EDITABLE_CLIP (was "Create Reel")
    expect(renderedText(STEP_DESCRIPTIONS.add_clip)).toMatch(/Mark play/); // ANNOTATE.MARK_PLAY (was "Add Play")
    expect(renderedText(STEP_DESCRIPTIONS.choose_shape)).toMatch(/Around player/); // EDITOR_PANELS (was "Body")
    expect(STEP_TITLES.export_overlay).toBe('Export clip with effects'); // EXPORT_JOBS.overlay.action
  });
});

// T9575 residual #2: the backend quest_config STEP_TITLES["move_to_my_reels"]
// hardcodes "Move to Highlight Reels" while the frontend DERIVES the same words
// from SECTION_NAMES.LIBRARY. They agree only by coincidence across the JS/Python
// boundary (no shared constant), so a future LIBRARY rename would silently drift
// the backend claim-reward error copy. This test reads the Python source and pins
// the two in sync.
describe('FE/BE move_to_my_reels title sync (T9575)', () => {
  it('backend quest_config title matches the frontend SECTION_NAMES.LIBRARY-derived title', () => {
    const expected = `Move to ${SECTION_NAMES.LIBRARY}`;
    // Frontend side derives it from the single source.
    expect(STEP_TITLES.move_to_my_reels).toBe(expected);
    // Backend side hardcodes it — read the source and compare. Vitest runs with
    // cwd = src/frontend, so the backend module sits one level up under src/backend.
    const qcPath = resolve(process.cwd(), '../backend/app/quest_config.py');
    const src = readFileSync(qcPath, 'utf8');
    const m = src.match(/"move_to_my_reels":\s*"([^"]*)"/);
    expect(m, 'move_to_my_reels not found in quest_config.py STEP_TITLES').toBeTruthy();
    expect(m[1]).toBe(expected);
  });
});
