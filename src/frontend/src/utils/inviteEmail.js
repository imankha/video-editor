import { API_BASE } from '../config';
import { toast } from '../components/shared/Toast';
import { track } from './analytics';

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

export function buildInviteUrl(inviteCode) {
  return `https://www.reelballers.com?ref=${inviteCode}`;
}

export function buildInviteMessage(inviteCode) {
  const url = buildInviteUrl(inviteCode);
  return `Hey,\nJust wanted to share a link to Reel Ballers -- really cool app that lets you annotate your player's clips and use AI to create great looking highlights.\n\n${url}`;
}

export async function shareInvite() {
  const resp = await fetch(`${API_BASE}/api/me/invite-code`, { credentials: 'include' });
  if (!resp.ok) return;
  const { invite_code } = await resp.json();
  const message = buildInviteMessage(invite_code);

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Reel Ballers', text: message });
      track('share_initiated', { method: 'native', source: 'invite' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(message);
  } catch {
    const input = document.createElement('input');
    input.value = message;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
  }
  toast.success('Invite link copied!', { message: 'Share it with a friend via text, email, or social media.' });
  track('share_initiated', { method: 'clipboard', source: 'invite' });
}
