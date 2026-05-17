import { describe, it, expect } from 'vitest';
import { buildInviteMailtoUrl } from './inviteEmail';

describe('buildInviteMailtoUrl', () => {
  describe('basic URL structure', () => {
    it('returns a mailto: URL', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      expect(url).toMatch(/^mailto:\?/);
    });

    it('includes subject parameter', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      expect(url).toContain('subject=');
    });

    it('includes body parameter', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      expect(url).toContain('body=');
    });

    it('has no recipient (mailto:? not mailto:someone@)', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      expect(url.startsWith('mailto:?')).toBe(true);
    });
  });

  describe('subject line', () => {
    it('includes athlete name in subject', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      expect(url).toContain(encodeURIComponent('Check out how I make highlight reels for Jake'));
    });

    it('uses "my kid" in subject when name is null', () => {
      const url = buildInviteMailtoUrl({
        athleteName: null,
        userEmail: 'test@test.com',
        inviteCode: 'abc123',
      });
      expect(url).toContain(encodeURIComponent('highlight reels for my kid'));
    });

    it('uses "my kid" in subject when name is empty', () => {
      const url = buildInviteMailtoUrl({
        athleteName: '',
        userEmail: 'test@test.com',
        inviteCode: 'abc123',
      });
      expect(url).toContain(encodeURIComponent('highlight reels for my kid'));
    });

    it('uses "my kid" in subject when name is whitespace', () => {
      const url = buildInviteMailtoUrl({
        athleteName: '   ',
        userEmail: 'test@test.com',
        inviteCode: 'abc123',
      });
      expect(url).toContain(encodeURIComponent('highlight reels for my kid'));
    });

    it('uses "my kid" when name is undefined', () => {
      const url = buildInviteMailtoUrl({
        athleteName: undefined,
        userEmail: 'test@test.com',
        inviteCode: 'abc123',
      });
      expect(url).toContain(encodeURIComponent('highlight reels for my kid'));
    });
  });

  describe('body content', () => {
    it('includes referral link with invite code', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      expect(url).toContain(encodeURIComponent('https://www.reelballers.com?ref=a1b2c3d4'));
    });

    it('includes greeting', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      expect(url).toContain(encodeURIComponent('Hey!'));
    });

    it('mentions Reel Ballers by name', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      expect(url).toContain(encodeURIComponent('Reel Ballers'));
    });

    it('mentions Instagram or TikTok', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      const body = decodeURIComponent(url.split('body=')[1]);
      expect(body).toContain('Instagram');
      expect(body).toContain('TikTok');
    });

    it('mentions Veo or Trace as competitor comparison', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      const body = decodeURIComponent(url.split('body=')[1]);
      expect(body).toContain('Veo');
      expect(body).toContain('Trace');
    });

    it('uses athlete name in body text', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'mike@example.com',
        inviteCode: 'a1b2c3d4',
      });
      const body = decodeURIComponent(url.split('body=')[1]);
      expect(body).toContain('for Jake');
    });

    it('uses "my kid" in body when name is null', () => {
      const url = buildInviteMailtoUrl({
        athleteName: null,
        userEmail: 'test@test.com',
        inviteCode: 'abc123',
      });
      const body = decodeURIComponent(url.split('body=')[1]);
      expect(body).toContain('for my kid');
    });
  });

  describe('signature line', () => {
    it('includes sender name stripped from email', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'imankh@gmail.com',
        inviteCode: 'a1b2c3d4',
      });
      const body = decodeURIComponent(url.split('body=')[1]);
      expect(body).toContain('imankh');
      expect(body).not.toContain('@gmail.com');
    });

    it('uses full local part for complex emails', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'john.doe+test@company.co.uk',
        inviteCode: 'a1b2c3d4',
      });
      const body = decodeURIComponent(url.split('body=')[1]);
      expect(body).toContain('john.doe+test');
    });

    it('omits signature when email is null', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: null,
        inviteCode: 'a1b2c3d4',
      });
      const body = decodeURIComponent(url.split('body=')[1]);
      const lines = body.split('\n');
      const lastNonEmpty = lines.filter(l => l.trim()).pop();
      expect(lastNonEmpty).toContain('reelballers.com');
    });

    it('omits signature when email is undefined', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: undefined,
        inviteCode: 'a1b2c3d4',
      });
      const body = decodeURIComponent(url.split('body=')[1]);
      expect(body.trim().endsWith('a1b2c3d4')).toBe(true);
    });

    it('omits signature when email is empty string', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: '',
        inviteCode: 'a1b2c3d4',
      });
      const body = decodeURIComponent(url.split('body=')[1]);
      expect(body.trim().endsWith('a1b2c3d4')).toBe(true);
    });
  });

  describe('URI encoding', () => {
    it('properly encodes special characters in athlete name', () => {
      const url = buildInviteMailtoUrl({
        athleteName: "O'Brien & Sons",
        userEmail: 'user@test.com',
        inviteCode: 'xyz789',
      });
      // Raw special chars should NOT appear in the URL
      expect(url).not.toContain("O'Brien & Sons");
      // But encoded versions should
      expect(url).toContain(encodeURIComponent("O'Brien & Sons"));
    });

    it('encodes newlines in body as %0A', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'test@test.com',
        inviteCode: 'abc123',
      });
      // URL should not contain literal newlines
      expect(url).not.toContain('\n');
      // But should contain encoded newlines
      expect(url).toContain('%0A');
    });

    it('encodes spaces as %20', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'test@test.com',
        inviteCode: 'abc123',
      });
      // encodeURIComponent encodes space as %20
      expect(url).toContain('%20');
    });

    it('handles unicode characters in name', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jose',
        userEmail: 'test@test.com',
        inviteCode: 'abc123',
      });
      expect(url).toContain(encodeURIComponent('Jose'));
    });

    it('handles ampersand in name', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Tom & Jerry',
        userEmail: 'test@test.com',
        inviteCode: 'abc123',
      });
      // & should be encoded, not left raw
      const body = url.split('body=')[1];
      expect(body).not.toMatch(/(?<!%26.*)&(?!.*body)/);
    });
  });

  describe('invite code passthrough', () => {
    it('includes exact invite code in URL', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'test@test.com',
        inviteCode: 'deadbeef',
      });
      expect(url).toContain(encodeURIComponent('ref=deadbeef'));
    });

    it('handles codes with numbers only', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'test@test.com',
        inviteCode: '12345678',
      });
      expect(url).toContain(encodeURIComponent('ref=12345678'));
    });

    it('handles short codes', () => {
      const url = buildInviteMailtoUrl({
        athleteName: 'Jake',
        userEmail: 'test@test.com',
        inviteCode: 'ab',
      });
      expect(url).toContain(encodeURIComponent('ref=ab'));
    });
  });
});
