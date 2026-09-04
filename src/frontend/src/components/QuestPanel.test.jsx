import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuestPanel } from './QuestPanel';

// T7840: the `upload_game` current step must render as a real button that invokes
// the ProjectManager-registered opener, and the chevron affordance must appear ONLY
// on actionable rows (never on a plain/tutorial current step).

const { questState, tutorialFlag } = vi.hoisted(() => ({
  // T8690: mutable flag so tests can exercise both the OFF (prod default, tutorial
  // steps hidden) and ON (restored) rendering paths from a single mock.
  tutorialFlag: { enabled: false },
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
    // T8120: persisted collapse preference + gesture.
    panelCollapsed: false,
    collapsePanel: vi.fn(),
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
  // T8690: read through to the mutable holder so a test's flag flip takes effect.
  get TUTORIAL_VIDEOS_ENABLED() { return tutorialFlag.enabled; },
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
  questState.panelCollapsed = false;
  questState.collapsePanel = vi.fn();
  tutorialFlag.enabled = false;  // T8690: prod default — tutorial steps hidden.
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
    tutorialFlag.enabled = true;  // T8690: guard flag-on rendering (tutorial step visible).
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

// T8120: collapse-to-Help-button + persistence + occlusion contract.
describe('QuestPanel — collapse to Help button + persistence (T8120)', () => {
  beforeEach(resetState);

  it('expanded: collapsing calls collapsePanel(true) — the persisted gesture', () => {
    const collapse = vi.fn();
    questState.collapsePanel = collapse;
    questState.panelCollapsed = false;

    render(<QuestPanel inline />);
    // The header (with the quest title) collapses the panel back to the chip.
    const header = screen.getByLabelText('Collapse to Help button');
    fireEvent.click(header);
    expect(collapse).toHaveBeenCalledWith(true);
  });

  it('collapsed: renders a small "Help" chip, not the step list; expanding calls collapsePanel(false)', () => {
    const collapse = vi.fn();
    questState.collapsePanel = collapse;
    questState.panelCollapsed = true;

    render(<QuestPanel inline />);
    // The step list is gone; a Help chip is shown.
    expect(screen.queryByText('Add Your First Game')).toBeNull();
    const chip = screen.getByLabelText('Open onboarding help');
    expect(chip.textContent).toMatch(/Help/);
    fireEvent.click(chip);
    expect(collapse).toHaveBeenCalledWith(false);
  });

  it('tutorial CTA stays reachable from the expanded panel when the flag is on (T8690 restore path)', () => {
    tutorialFlag.enabled = true;  // T8690: flipping the flag back on restores prior behavior.
    // Make the tutorial step current so its (downgraded) CTA renders.
    questState.quests = [
      { id: 'quest_1', steps: { upload_game: true, watch_annotate_tutorial: false }, reward_claimed: false },
    ];
    render(<QuestPanel inline />);
    // The tutorial button still renders (reachable), from the expanded panel.
    expect(screen.getAllByText('Watch tutorial').length).toBeGreaterThan(0);
  });

  // T8690: with the flag off (default), the four watch_*_tutorial steps and their
  // CTAs are filtered out of the checklist entirely, and the x/N counters count
  // only the visible steps so nothing looks "stuck".
  it('hides the tutorial step and its CTA when TUTORIAL_VIDEOS_ENABLED is off (default)', () => {
    // upload_game not yet done -> tutorial step would be next if it were visible.
    questState.quests = [
      { id: 'quest_1', steps: { upload_game: false, watch_annotate_tutorial: false }, reward_claimed: false },
    ];
    render(<QuestPanel inline />);
    // The visible step remains; the tutorial step + its CTA are gone.
    expect(screen.getByText('Add Your First Game')).toBeTruthy();
    expect(screen.queryByText('Watch the Annotate Tutorial')).toBeNull();
    expect(screen.queryByText('Watch tutorial')).toBeNull();
    // Counter reflects only the single visible step (1 total), not 2.
    expect(screen.getByText('0/1')).toBeTruthy();
  });

  it('marks the quest complete once the only visible step is done, ignoring the hidden tutorial step', () => {
    // upload_game done, hidden tutorial step still incomplete in backend state.
    questState.quests = [
      { id: 'quest_1', steps: { upload_game: true, watch_annotate_tutorial: false }, reward_claimed: false },
    ];
    render(<QuestPanel inline />);
    // Quest reads as fully complete (1/1) even though the hidden step is unfinished.
    expect(screen.getByText('1/1')).toBeTruthy();
  });

  it('auto-hides fully when a modal overlay is open (occlusion contract)', () => {
    questState.panelCollapsed = false;
    // Inject a modal-signature overlay into the DOM before render.
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50';
    // jsdom returns 0-size rects by default; stub getClientRects so the overlay
    // counts as visible for the detector.
    modal.getClientRects = () => [{ width: 100, height: 100 }];
    document.body.appendChild(modal);

    const { queryByText } = render(<QuestPanel inline />);
    // Panel is fully hidden — the quest title is not in the document.
    expect(queryByText('Get Started')).toBeNull();

    document.body.removeChild(modal);
  });
});
