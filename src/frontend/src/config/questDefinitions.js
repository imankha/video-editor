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
    reward: 25,
    steps: [
      {
        id: 'upload_game',
        title: 'Upload Your First Game',
        description: 'Upload a game video to get started',
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
        title: 'Create Your Annotated Video',
        description: 'Compile your annotations into a single instructive video',
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
    title: 'Export Highlights',
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
  {
    id: 'quest_3',
    title: 'Multiple Games',
    reward: 100,
    steps: [
      {
        id: 'upload_game_2',
        title: 'Upload a Second Game',
        description: 'Expand your library with another game video',
      },
      {
        id: 'annotate_brilliant_2',
        title: 'Annotate 2 Brilliant Plays',
        description: 'Find at least 2 five-star moments across your games',
      },
      {
        id: 'annotate_4_star',
        title: 'Annotate a 4 Star Play',
        description: 'Mark a solid play worth remembering',
      },
      {
        id: 'create_mixed_project',
        title: 'Create a 4 & 5 Star Project',
        description: 'Build a project combining your 4 and 5 star plays',
      },
      {
        id: 'export_custom_project',
        title: 'Export Your Highlight Reel',
        description: 'Export a finished video from your custom project',
      },
    ],
  },
];

/** Total number of steps across all quests */
export const TOTAL_STEPS = QUESTS.reduce((sum, q) => sum + q.steps.length, 0);
