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
        description: 'Upload a game video by clicking the Add Game button',
      },
      {
        id: 'annotate_brilliant',
        title: 'Annotate a 5 Star Play',
        description: 'Watch the footage and when your player makes a great play, click the Add Clip button and give that play 5 stars',
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
        description: 'Go Home, then go to Projects, then select a project and enter Framing mode to crop and upscale your clips',
      },
      {
        id: 'extract_clip',
        title: 'Extract Clip',
        description: 'Wait while the app extracts your selected clip',
      },
      {
        id: 'export_framing',
        title: 'Frame Video',
        description: 'Trim segments, slow down, crop video at different keyframes, and slowdown segments to frame your clip',
      },
      {
        id: 'export_overlay',
        title: 'Add Highlight Overlays',
        description: 'Click on each of the green keyframes, then put the spotlight around your player by either clicking the box or moving the spotlight. Once all keyframes have a spotlight, click Add Overlay',
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
        description: 'Go Home, select Games, and then click Add Game to add another game',
      },
      {
        id: 'annotate_brilliant_2',
        title: 'Annotate 2 5-Star Plays',
        description: 'Find and annotate at least 2 five-star moments across the game',
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
