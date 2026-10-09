import { EMPTY_TAB_GUIDE } from '../../config/emptyStates';
import { GUIDE } from '../../config/displayNames';
import { resolveGuide } from './resolveGuide';
export { homeFacts } from './resolveGuide';
export { FRAMING_GUIDE, EDITOR_PANELS } from '../../config/displayNames';
export const HOME_COACH = EMPTY_TAB_GUIDE;
export const ANNOTATE_COACH = GUIDE.annotate;
/** Annotate facts from the screen's region + highlight instances (built in render). */
export function annotateFacts(region, instances) {
  const portrait = instances?.find(i => i.orientation === 'portrait' && i.projectId != null) ?? null;
  return { screen: 'annotate', progress: { selectedPlay: region ? { rating: region.rating } : null, portrait }, local: {} };
}
export function annotateCoachModel(region, instances, hasPlays, isPlaying = false) {
  const facts = annotateFacts(region, instances);
  const guide = resolveGuide(facts);
  return { ...guide.message, phase: guide.phase, portrait: facts.progress.portrait, isPlaying, hasPlays };
}
