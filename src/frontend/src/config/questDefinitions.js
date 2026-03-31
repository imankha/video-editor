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
        title: 'Add Your First Game',
        description: 'Add a game to start clipping highlights',
      },
      {
        id: 'annotate_brilliant',
        title: 'Annotate a 5 Star Play',
        description: 'When you spot a great play, click Add Clip and rate it 5 stars.',
      },
      {
        id: 'playback_annotations',
        title: 'Playback Annotations',
        description: 'Review the annotations you made with your athlete',
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
        title: 'Open a Project',
        description: 'Go Home, then go to Projects, then select a project',
      },
      {
        id: 'export_framing',
        title: 'Frame Video',
        description: 'Crop, trim, and slow down segments to frame your clip. Then click "Frame Video".',
      },
      {
        id: 'wait_for_export',
        title: 'Wait For Export',
        description: 'Wait for the framing export to finish. We AI upscale your video to crisp 1080p.',
      },
      {
        id: 'export_overlay',
        title: 'Add Highlight Overlays',
        description: 'Click on each of the green keyframes, then put the spotlight around your player by either clicking the box or moving the spotlight. Once all keyframes have a spotlight, click Add Overlay',
      },
      {
        id: 'view_gallery_video',
        title: 'Watch Your Highlight',
        description: 'Open the Gallery and play back your completed highlight reel',
      },
    ],
  },
  {
    id: 'quest_3',
    title: 'Highlight Reel',
    reward: 100,
    steps: [
      {
        id: 'upload_game_2',
        title: 'Add a Second Game',
        description: 'Go Home, select Games, and click Add Game to add another game',
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
        title: 'Create Highlights Project',
        description: 'Go Home, then Projects, then New Project. Select clips for your highlight reel and click Create.',
      },
      {
        id: 'frame_custom_project',
        title: 'Open and Frame Project',
        description: 'Open your new custom project and frame each clip individually',
      },
      {
        id: 'start_custom_framing',
        title: 'Start Frame Export',
        description: 'Click the Frame Video button to begin the framing export',
      },
      {
        id: 'complete_custom_framing',
        title: 'Complete Frame Export',
        description: 'Wait for the framing export to finish',
      },
      {
        id: 'overlay_custom_project',
        title: 'Add Overlay',
        description: 'In Overlay mode, add spotlight overlays to your highlights. Scroll to see each clip\'s highlight region. Move regions with the levers, then click the green boxes and click your player to set spotlights.',
      },
      {
        id: 'watch_custom_video',
        title: 'Watch Your Video',
        description: 'Open the Gallery and play back your finished custom project video',
      },
    ],
  },
];

/** Total number of steps across all quests */
export const TOTAL_STEPS = QUESTS.reduce((sum, q) => sum + q.steps.length, 0);
