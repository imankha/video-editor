// T14560: marking plays takes time, so no surface promises highlights "in minutes".
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildInviteMailtoUrl } from '../utils/inviteEmail';

const TAGLINE = 'Transform game film into high-quality highlights using AI upscaling';
const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

describe('T14560 tagline on every surface', () => {
  it('T14560:C2 the app meta descriptions carry the tagline without "in minutes"', () => {
    const contents = [...indexHtml.matchAll(/<meta (?:name|property)="(?:description|og:description|twitter:description)" content="([^"]*)"/g)].map((m) => m[1]);
    expect(contents).toHaveLength(3);
    contents.forEach((c) => expect(c.startsWith(`${TAGLINE}.`)).toBe(true));
  });

  it('T14560:C3 the invite email does not promise highlights within minutes of upload', () => {
    const url = buildInviteMailtoUrl({ athleteName: 'Sam', userEmail: 'a@b.co', inviteCode: 'abc' });
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).not.toMatch(/\b(with)?in minutes\b/i);
    expect(body).toMatch(/mark/i);
  });
});
