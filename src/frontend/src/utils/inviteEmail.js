/**
 * Builds a mailto: URL for the invite-a-friend flow.
 */

export function buildInviteMailtoUrl({ athleteName, userEmail, inviteCode }) {
  const name = athleteName?.trim() || 'my kid';
  const subject = `Check out how I make highlight reels for ${name}`;

  const lines = [
    'Hey!',
    '',
    `I've been using Reel Ballers to make highlight reels for ${name} and it's been amazing. You upload your game footage and within minutes you have professional-quality highlights ready for Instagram or TikTok.`,
    '',
    'The video quality is incredible -- way better than what you get from Veo or Trace. And it takes minutes, not hours.',
    '',
    `Check it out: https://www.reelballers.com?ref=${inviteCode}`,
  ];

  if (userEmail) {
    const senderName = userEmail.split('@')[0];
    lines.push('', senderName);
  }

  const body = lines.join('\n');

  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
