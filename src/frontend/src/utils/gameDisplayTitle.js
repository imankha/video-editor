import { GameType } from '../constants/gameConstants';
import { parseLocalCalendarDate } from './matchDate';

/**
 * Frontend mirror of backend `generate_game_display_name` (routers/games.py): the title
 * GET /api/games shows for a game. With an opponent it is "Vs X Mon D", "at X Mon D" or
 * "{Tournament}: Vs X Mon D"; without one the stored name (`fallbackName`) stays.
 */
export function gameDisplayTitle({ opponentName, gameDate, gameType, tournamentName }, fallbackName) {
  const opponent = (opponentName || '').trim();
  if (!opponent) return fallbackName;
  const tournament = (tournamentName || '').trim();
  let prefix = 'Vs';
  if (gameType === GameType.TOURNAMENT && tournament) prefix = `${tournament}: Vs`;
  else if (gameType === GameType.AWAY) prefix = 'at';
  const date = parseLocalCalendarDate(gameDate);
  const dateLabel = date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  return [prefix, opponent, dateLabel].filter(Boolean).join(' ');
}
