export const QUEST_DEFINITIONS = [
  {
    id: 'quest_1',
    title: 'Get Started',
    // T8120: per-quest rewards retired — the full chain total is granted upfront.
    reward: 0,
    step_ids: [
      'watch_annotate_tutorial',
      'upload_game',
      'add_clip',
      'rate_clip',
      'annotate_brilliant',
      'playback_annotations',
    ],
  },
  {
    id: 'quest_2',
    title: 'Frame Your Highlight',
    reward: 0,  // T8120: retired — granted upfront
    step_ids: [
      // T5195: Return Home is quest_2's first step (kept in sync with quest_config.py)
      'return_home',
      'watch_framing_tutorial',
      'open_framing',
      'position_crop',
      'add_slowmo',
      'export_framing',
      'wait_for_export',
    ],
  },
  {
    id: 'quest_3',
    title: 'Configure Your Spotlight',
    reward: 0,  // T8120: retired — granted upfront
    step_ids: [
      'watch_overlay_tutorial',
      'open_overlay',
      'select_players',
      'choose_color',
      'choose_shape',
      // T5170: render steps moved here from quest_4 (kept in sync with quest_config.py)
      'export_overlay',
      'wait_for_overlay',
    ],
  },
  {
    id: 'quest_4',
    title: 'Publish Your Reel',
    reward: 0,  // T8120: retired — granted upfront
    step_ids: [
      'watch_publish_tutorial',
      // T6840: preview the finished draft before publishing (kept in sync with quest_config.py)
      'preview_draft',
      'move_to_my_reels',
      'view_gallery_video',
    ],
  },
];
