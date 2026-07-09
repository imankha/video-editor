const ASSETS_BASE = import.meta.env.VITE_ASSETS_BASE || 'https://assets.reelballers.com';

const TUTORIAL_BASENAMES = {
  quest_1: 'annotate',
  quest_2: 'framing',
  quest_3: 'overlay',
  quest_4: 'publish',
};

export function getTutorialAssets(questId) {
  const base = TUTORIAL_BASENAMES[questId];
  if (!base) return null;
  return {
    videoUrl:    `${ASSETS_BASE}/tutorials/${base}.mp4`,
    vttUrl:      `${ASSETS_BASE}/tutorials/${base}.vtt`,
    chaptersUrl: `${ASSETS_BASE}/tutorials/${base}.chapters.vtt`,
  };
}
