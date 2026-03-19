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
    hint: 'If you already did this, just log in',
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
    title: 'Highlight Reel',
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
        title: 'Create Highlights Project',
        description: 'Go Home, then Projects, then New Project and click 4+ to select all great and brilliant clips for your new project. Click Create.',
      },
      {
        id: 'extract_custom_clips',
        title: 'Extract Clips for Custom Project',
        description: 'Wait while the app extracts all clips in your custom project',
      },
      {
        id: 'frame_custom_project',
        title: 'Frame Project',
        description: 'Open your new custom project and frame each clip individually',
      },
      {
        id: 'start_custom_framing',
        title: 'Start Framing',
        description: 'Click the Frame Video button to begin the framing export',
      },
      {
        id: 'complete_custom_framing',
        title: 'Complete Framing',
        description: 'Wait for the framing export to finish',
      },
      {
        id: 'overlay_custom_project',
        title: 'Add Overlay',
        description: 'In Overlay mode, add spotlight overlays to your highlights, then export',
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
