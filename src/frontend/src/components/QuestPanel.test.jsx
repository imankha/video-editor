import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuestPanel } from './QuestPanel';

// T7840: the `upload_game` current step must render as a real button that invokes
// the ProjectManager-registered opener, and the chevron affordance must appear ONLY
// on actionable rows (never on a plain/tutorial current step).

const { questState } = vi.hoisted(() => ({
  // Mutable so each test picks the store shape it needs.
  questState: {
    definitions: [
      { id: 'quest_1', title: 'Get Started', reward: 50, step_ids: ['upload_game', 'watch_annotate_tutorial'] },
    ],
    quests: [
      { id: 'quest_1', steps: { upload_game: false, watch_annotate_tutorial: false }, reward_claimed: false },
    ],
    loaded: true,
    activeQuestId: 'quest_1',
    fetchProgress: vi.fn(),
    detectionAssignProgress: null,
    claimReward: vi.fn(),
    addGameOpener: null,
  },
}));

vi.mock('../stores/questStore', () => ({
  useQuestStore: (selector) => selector(questState),
}));

vi.mock('../stores/editorStore', () => ({
  useEditorStore: (selector) => selector({ editorMode: 'home' }),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector) => selector({ isAuthenticated: true }),
}));

vi.mock('../config/questDefinitions.jsx', () => ({
  STEP_TITLES: {
    upload_game: 'Add Your First Game',
    watch_annotate_tutorial: 'Watch the Annotate Tutorial',
  },
  STEP_DESCRIPTIONS: {
    upload_game: 'Add a game to start clipping highlights',
    watch_annotate_tutorial: 'See how annotation works',
  },
  // Only the tutorial step maps to a quest — upload_game has no embedded CTA.
  TUTORIAL_STEP_QUEST: { watch_annotate_tutorial: 'quest_1' },
  WatchTutorialButton: () => <button type="button">Watch tutorial</button>,
}));

vi.mock('./shared/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../services/ExportWebSocketManager', () => ({
  default: { addEventListener: () => () => {} },
}));

function resetState() {
  questState.quests = [
    { id: 'quest_1', steps: { upload_game: false, watch_annotate_tutorial: false }, reward_claimed: false },
  ];
  questState.addGameOpener = null;
  questState.detectionAssignProgress = null;
}

describe('QuestPanel — actionable upload_game step (T7840)', () => {
  beforeEach(resetState);

  it('renders the upload_game current step as a button that invokes the registered opener, with a chevron', () => {
    const opener = vi.fn();
    questState.addGameOpener = opener;

    const { container } = render(<QuestPanel inline />);

    const row = screen.getByText('Add Your First Game').closest('button');
    expect(row).not.toBeNull();

    fireEvent.click(row);
    expect(opener).toHaveBeenCalledTimes(1);

    // Chevron only appears on the actionable row.
    expect(container.querySelector('.quest-chevron')).not.toBeNull();
  });

  it('renders no chevron and no button when no opener is registered (non-actionable current step)', () => {
    questState.addGameOpener = null;

    const { container } = render(<QuestPanel inline />);

    // Step title still shows, but not inside a clickable button row.
    const title = screen.getByText('Add Your First Game');
    expect(title.closest('button')).toBeNull();
    expect(container.querySelector('.quest-chevron')).toBeNull();
  });

  it('does not make the tutorial current step actionable even when an opener is registered', () => {
    // upload_game done -> tutorial step becomes current; opener is for upload_game only.
    questState.quests = [
      { id: 'quest_1', steps: { upload_game: true, watch_annotate_tutorial: false }, reward_claimed: false },
    ];
    questState.addGameOpener = vi.fn();

    const { container } = render(<QuestPanel inline />);

    const title = screen.getByText('Watch the Annotate Tutorial');
    expect(title.closest('button')).toBeNull();
    expect(container.querySelector('.quest-chevron')).toBeNull();
  });
});
