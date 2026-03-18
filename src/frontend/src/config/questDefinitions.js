/**
 * Quest Definitions — data-driven config for the quest system (T540).
 *
 * Single source of truth for quest structure. Adding/removing/reordering steps
 * means editing this config only. Backend has matching step_ids for progress derivation.
 */

export const QUESTS = [
  {
    id: 'quest_1',
    title: 'Get Started',
    reward: 30,
    steps: [
      {
        id: 'upload_game',
        title: 'Upload Your First Game',
        description: 'Drop a game video to start annotating your best plays',
      },
      {
        id: 'annotate_brilliant',
        title: 'Annotate a 5 Star Play',
        description: 'Find your best moment and give it 5 stars',
      },
      {
        id: 'annotate_unfortunate',
        title: 'Annotate a 1 or 2 Star Play',
        description: 'Every player has off moments — mark one to learn from it',
      },
      {
        id: 'create_annotated_video',
        title: 'Create Your Highlight Reel',
        description: 'Compile your annotated clips into a single video',
      },
      {
        id: 'log_in',
        title: 'Log In to Save Progress',
        description: 'Sign in to keep your work across devices and earn credits',
      },
    ],
  },
  {
    id: 'quest_2',
    title: 'Master the Pipeline',
    reward: 50,
    steps: [
      {
        id: 'open_framing',
        title: 'Open the Framing Editor',
        description: 'Select a project and enter Framing mode to crop and upscale your clips',
      },
      {
        id: 'export_framing',
        title: 'Export Your First Frame Job',
        description: 'Click Export to render your cropped, upscaled video',
      },
      {
        id: 'export_overlay',
        title: 'Add Highlight Overlays',
        description: 'Use the Overlay editor to spotlight key moments, then export',
      },
      {
        id: 'view_gallery_video',
        title: 'Watch Your Finished Video',
        description: 'Open the Gallery and play back your completed highlight reel',
      },
    ],
  },
];

/** Total number of steps across all quests */
export const TOTAL_STEPS = QUESTS.reduce((sum, q) => sum + q.steps.length, 0);
