import { describe, it, expect } from 'vitest';
import { buildInviteMailtoUrl } from './inviteEmail';

describe('buildInviteMailtoUrl', () => {
  it('builds mailto URL with athlete name', () => {
    const url = buildInviteMailtoUrl({
      athleteName: 'Jake',
      userEmail: 'mike@example.com',
      inviteCode: 'a1b2c3d4',
    });

    expect(url).toMatch(/^mailto:\?subject=/);
    expect(url).toContain(encodeURIComponent('Check out how I make highlight reels for Jake'));
    expect(url).toContain(encodeURIComponent('https://www.reelballers.com?ref=a1b2c3d4'));
    expect(url).toContain(encodeURIComponent('mike'));
  });

  it('uses "my kid" fallback when name is null', () => {
    const url = buildInviteMailtoUrl({
      athleteName: null,
      userEmail: 'test@test.com',
      inviteCode: 'abc123',
    });

    expect(url).toContain(encodeURIComponent('highlight reels for my kid'));
  });

  it('uses "my kid" fallback when name is empty string', () => {
    const url = buildInviteMailtoUrl({
      athleteName: '   ',
      userEmail: 'test@test.com',
      inviteCode: 'abc123',
    });

    expect(url).toContain(encodeURIComponent('highlight reels for my kid'));
  });

  it('properly URI-encodes special characters in names', () => {
    const url = buildInviteMailtoUrl({
      athleteName: "O'Brien & Sons",
      userEmail: 'user@test.com',
      inviteCode: 'xyz789',
    });

    expect(url).toContain(encodeURIComponent("highlight reels for O'Brien & Sons"));
    expect(url).not.toContain("O'Brien & Sons");
  });

  it('omits signature when email is null', () => {
    const url = buildInviteMailtoUrl({
      athleteName: 'Jake',
      userEmail: null,
      inviteCode: 'a1b2c3d4',
    });

    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).not.toContain('@');
    expect(body.trim().endsWith('a1b2c3d4')).toBe(true);
  });

  it('strips domain from email for signature', () => {
    const url = buildInviteMailtoUrl({
      athleteName: 'Jake',
      userEmail: 'imankh@gmail.com',
      inviteCode: 'a1b2c3d4',
    });

    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('imankh');
    expect(body).not.toContain('@gmail.com');
  });
});
