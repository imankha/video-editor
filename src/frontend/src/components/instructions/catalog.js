import { EMPTY_TAB_GUIDE } from '../../config/emptyStates';
export { FRAMING_GUIDE, EDITOR_PANELS } from '../../config/displayNames';
export const HOME_COACH = EMPTY_TAB_GUIDE;
export const ANNOTATE_COACH = {
  watch: { title: 'Watch the game and click Mark play when you find a potential highlight or play you want to review with your athlete.', body: '' },
  brilliant: { title: 'Brilliant play. Make a portrait highlight.', body: 'Focus the video on your player, ready to share.' },
  portrait: { title: 'Continue your portrait highlight.', body: 'Finish framing your player, then add Spotlight if you want.' },
  spotlight: { title: 'Your portrait highlight is ready.', body: 'Add Spotlight to make your player stand out.' },
};
export function annotateCoachModel(region, instances, hasPlays, isPlaying = false) {
  const portrait = instances?.find(i => i.orientation === 'portrait' && i.projectId != null);
  if (region?.rating === 5) return { ...ANNOTATE_COACH[portrait ? (portrait.action === 'overlay' ? 'spotlight' : 'portrait') : 'brilliant'], phase: portrait ? 'portrait' : 'brilliant', portrait };
  return { ...ANNOTATE_COACH.watch, phase: 'watch', isPlaying, hasPlays };
}
