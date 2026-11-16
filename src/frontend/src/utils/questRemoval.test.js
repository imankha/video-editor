// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

// T11180: the quest system is gone from the app. Nothing in src/ may import a
// quest module, call a /api/quests endpoint, or mount the tutorial video window
// (deleted with quests, owner ruling 2026-11-14).

const SRC = join(__dirname, '..');

const DELETED = [
  'stores/questStore.js',
  'data/questDefinitions.js',
  'config/questDefinitions.jsx',
  'components/QuestIcon.jsx',
  'components/TutorialVideoModal.jsx',
  'config/tutorialVideos.js',
  'stores/useTutorialStore.js',
];

// Code (not prose) that only the quest system uses.
const QUEST_CODE = [
  'questStore',
  'questDefinitions',
  '/api/quests',
  'TutorialVideoModal',
  'useTutorialStore',
  'tutorialVideos',
  'fetchProgress\\(',
  'refreshQuestProgress',
  'data-quest-panel',
  '\\.quest-[a-z]',
].join('|');

describe('T11180 quest code removed from the app', () => {
  it('deletes the quest-only modules', () => {
    const present = DELETED.filter((f) => existsSync(join(SRC, f)));
    expect(present).toEqual([]);
  });

  it('leaves no quest wiring in any source file', () => {
    // Untracked files count too (--untracked), so a new file can't hide wiring.
    const out = execSync(
      `git grep --untracked -nE '${QUEST_CODE}' -- . ':!utils/questRemoval.test.js' || true`,
      { cwd: SRC, encoding: 'utf8' },
    );
    expect(out.split('\n').filter(Boolean)).toEqual([]);
  }, 60_000);
});
