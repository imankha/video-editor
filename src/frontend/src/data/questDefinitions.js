export const QUEST_DEFINITIONS = [
  {
    id: 'quest_1',
    title: 'Get Started',
    reward: 15,
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
    reward: 25,
    step_ids: [
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
    reward: 25,
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
    reward: 15,
    step_ids: [
      'watch_publish_tutorial',
      'move_to_my_reels',
      'view_gallery_video',
    ],
  },
];
