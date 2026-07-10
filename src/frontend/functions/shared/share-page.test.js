// T4840: unit tests for the edge share-page render helpers. Pure functions, no
// Workers runtime needed. Integration (routing, fallthrough, beacon, caching) is
// covered by `wrangler pages dev` in the task verification.
import { describe, it, expect } from 'vitest';
import { renderSharePage, escapeHtml, apiBase } from './[token].js';

describe('apiBase', () => {
  it('maps the prod host to the prod API', () => {
    expect(apiBase('app.reelballers.com')).toBe('https://api.reelballers.com');
  });

  it('defaults everything else (staging/preview) to the staging API', () => {
    expect(apiBase('reel-ballers-staging.pages.dev')).toBe('https://reel-ballers-api-staging.fly.dev');
    expect(apiBase('localhost')).toBe('https://reel-ballers-api-staging.fly.dev');
    expect(apiBase('some-preview.pages.dev')).toBe('https://reel-ballers-api-staging.fly.dev');
  });
});

describe('escapeHtml', () => {
  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });

  it('coerces null/undefined to empty string', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('renderSharePage', () => {
  const share = {
    video_name: 'Legends vs Rivals',
    video_url: 'https://r2.example.com/final/abc.mp4?sig=xyz',
    is_public: true,
    video_duration: 12.5,
  };

  it('renders a self-contained page under 15KB with no external JS/CSS', () => {
    const html = renderSharePage(share);
    const bytes = new TextEncoder().encode(html).length;
    expect(bytes).toBeLessThan(15 * 1024);
    // No app bundle / Stripe / GSI / service worker / external scripts.
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/stripe/i);
    expect(html).not.toMatch(/gsi|accounts\.google/i);
  });

  it('embeds a muted autoplay playsinline video pointing at the presigned URL', () => {
    const html = renderSharePage(share);
    expect(html).toMatch(/<video[^>]*\bautoplay\b/);
    expect(html).toMatch(/<video[^>]*\bmuted\b/);
    expect(html).toMatch(/<video[^>]*\bplaysinline\b/);
    expect(html).toMatch(/<video[^>]*\bcontrols\b/);
    expect(html).toContain(escapeHtml(share.video_url));
  });

  it('preconnects to the video origin', () => {
    const html = renderSharePage(share);
    expect(html).toContain('<link rel="preconnect" href="https://r2.example.com" crossorigin>');
  });

  it('includes Open Graph / Twitter meta for unfurls', () => {
    const html = renderSharePage(share);
    expect(html).toContain('property="og:type" content="video.other"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:video"');
    expect(html).toContain('name="twitter:card"');
  });

  it('has the download link and the Open Reel Ballers CTA', () => {
    const html = renderSharePage(share);
    expect(html).toMatch(/<a[^>]*download/);
    expect(html).toContain('https://app.reelballers.com/');
    expect(html).toContain('Open Reel Ballers');
  });

  it('escapes a hostile video_name so XSS is impossible', () => {
    const hostile = {
      ...share,
      video_name: `<script>alert('xss')</script>"><img src=x onerror=alert(1)>`,
    };
    const html = renderSharePage(hostile);
    // The raw injection must NOT appear anywhere in the output.
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain(`onerror=alert(1)>`);
    // It must appear escaped instead.
    expect(html).toContain('&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;');
    // The only <script> tag is our own inline tap-to-unmute handler.
    const scriptOpens = (html.match(/<script/g) || []).length;
    expect(scriptOpens).toBe(1);
  });

  it('escapes a hostile video_url so it cannot break out of attributes', () => {
    const hostile = {
      ...share,
      video_url: `https://r2.example.com/x.mp4"><script>alert(1)</script>`,
    };
    const html = renderSharePage(hostile);
    expect(html).not.toContain('"><script>alert(1)');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('falls back to a default title when video_name is missing', () => {
    const html = renderSharePage({ video_url: 'https://r2.example.com/x.mp4', is_public: true });
    expect(html).toContain('<title>Shared Video | Reel Ballers</title>');
  });
});
