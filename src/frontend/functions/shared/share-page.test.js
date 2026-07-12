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

  it('emits og:image + twitter:image + <video poster> when a poster URL is present (T4890)', () => {
    const withPoster = {
      ...share,
      video_poster_url: 'https://r2.example.com/final/posters/abc.mp4.jpg?sig=pqr',
      video_poster_width: 1080,
      video_poster_height: 1920,
    };
    const html = renderSharePage(withPoster);
    const posterEsc = escapeHtml(withPoster.video_poster_url);
    expect(html).toContain(`<meta property="og:image" content="${posterEsc}">`);
    expect(html).toContain('property="og:image:type" content="image/jpeg"');
    expect(html).toContain('<meta property="og:image:width" content="1080">');
    expect(html).toContain('<meta property="og:image:height" content="1920">');
    expect(html).toContain(`<meta name="twitter:image" content="${posterEsc}">`);
    expect(html).toMatch(new RegExp(`<video[^>]*\\bposter="${posterEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  });

  it('omits og:image/width/height/twitter:image and the poster attr when no poster (no silent fallback)', () => {
    const html = renderSharePage(share); // share has no video_poster_url
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('twitter:image');
    expect(html).not.toMatch(/<video[^>]*\bposter=/);
  });

  it('omits og:image:width/height when dimensions are missing but still emits og:image', () => {
    const html = renderSharePage({ ...share, video_poster_url: 'https://r2.example.com/p.jpg' });
    expect(html).toContain('property="og:image" content=');
    expect(html).not.toContain('og:image:width');
    expect(html).not.toContain('og:image:height');
  });

  it('escapes a hostile poster URL so it cannot break out of attributes', () => {
    const hostile = {
      ...share,
      video_poster_url: `https://r2.example.com/p.jpg"><script>alert(1)</script>`,
    };
    const html = renderSharePage(hostile);
    expect(html).not.toContain('"><script>alert(1)');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
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

  describe('branded end-card (T3950 playback compositing)', () => {
    it('renders the end-card overlay with wordmark and replay button', () => {
      const html = renderSharePage(share);
      expect(html).toContain('id="end-card"');
      expect(html).toContain('Made with Reel Ballers');
      expect(html).toContain('reelballers.com');
      expect(html).toContain('id="replay"');
    });

    it('end-card is hidden by default (display:none) and shown on ended via JS', () => {
      const html = renderSharePage(share);
      // CSS: #end-card{display:none ...}; toggled via .show class by JS
      expect(html).toMatch(/#end-card\{[^}]*display:none/);
      expect(html).toMatch(/#end-card\.show\{display:flex\}/);
      // JS: ended listener adds .show
      expect(html).toContain('"ended"');
      expect(html).toContain('classList.add("show")');
    });

    it('replay button resets the video and hides the card', () => {
      const html = renderSharePage(share);
      expect(html).toContain('classList.remove("show")');
      expect(html).toContain('v.currentTime=0');
      expect(html).toContain('v.play()');
    });

    it('page still fits under 15KB with the end-card included', () => {
      const html = renderSharePage(share);
      const bytes = new TextEncoder().encode(html).length;
      expect(bytes).toBeLessThan(15 * 1024);
    });
  });
});
