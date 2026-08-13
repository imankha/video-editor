// T4840: unit tests for the edge share-page render helpers. Pure functions, no
// Workers runtime needed. Integration (routing, fallthrough, beacon, caching) is
// covered by `wrangler pages dev` in the task verification.
import { describe, it, expect, vi } from 'vitest';
import { renderSharePage, renderIntroCard, escapeHtml, apiBase, absolutizePosterUrl } from './[token].js';

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

describe('absolutizePosterUrl', () => {
  // Regression: og:image originally embedded a presigned R2 URL, which expires
  // in 4h - unfurl crawlers refetching later (or hitting edge-cached HTML) got
  // a dead link and showed no image. The API now sends a stable relative proxy
  // path that must be absolutized against the API base.
  it('prefixes a relative proxy path with the API base', () => {
    const share = { video_poster_url: '/api/shared/tok/poster.jpg' };
    absolutizePosterUrl(share, 'https://api.example.com');
    expect(share.video_poster_url).toBe('https://api.example.com/api/shared/tok/poster.jpg');
  });

  it('leaves absolute URLs and missing posters untouched', () => {
    const abs = { video_poster_url: 'https://cdn.example.com/p.jpg' };
    absolutizePosterUrl(abs, 'https://api.example.com');
    expect(abs.video_poster_url).toBe('https://cdn.example.com/p.jpg');

    const none = {};
    absolutizePosterUrl(none, 'https://api.example.com');
    expect(none.video_poster_url).toBeUndefined();
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
    // NEVER card=player: we emit no twitter:player URL, and an invalid player
    // card makes renderers show an EMPTY media pane (found live on staging).
    expect(html).not.toContain('content="player"');
  });

  it('twitter:card is summary_large_image with a poster, summary without', () => {
    const withPoster = { ...share, video_poster_url: 'https://r2.example.com/p.jpg' };
    expect(renderSharePage(withPoster)).toContain('name="twitter:card" content="summary_large_image"');
    expect(renderSharePage(share)).toContain('name="twitter:card" content="summary"');
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

  describe('intro pre-roll (T5220 Scope B, design §5.3)', () => {
    const intro = {
      card: { image_key: 'k.png', shown_fields: ['position', 'team'], duration: 3.5 },
      previewUrl: 'https://r2.example.com/card.jpg',
      field_values: { full_name: 'Jordan Vega', position: 'Point Guard', team: 'Hawks' },
    };

    it('absent intro -> today\'s immediate autoplay, no intro-card markup', () => {
      const html = renderSharePage(share);
      expect(html).toMatch(/<video[^>]*\bautoplay\b/);
      expect(html).not.toContain('id="intro-card"');
    });

    it('present intro -> video has no autoplay attribute; an intro-card renders instead', () => {
      const html = renderSharePage({ ...share, intro });
      expect(html).not.toMatch(/<video[^>]*\bautoplay\b/);
      expect(html).toContain('id="intro-card"');
      expect(html).toContain('Jordan Vega');
      expect(html).toContain('Point Guard');
      expect(html).toContain('Hawks');
      expect(html).toContain(escapeHtml(intro.previewUrl));
      expect(html).toContain('--ic-dur:3.5s');
    });

    it('a shown_field with no value is omitted, never a blank line', () => {
      const html = renderSharePage({
        ...share,
        intro: { ...intro, field_values: { full_name: 'Jordan Vega', position: '' } },
      });
      expect(html).toContain('Jordan Vega');
      expect(html).not.toContain('<div class="ic-fact"></div>');
    });

    it('no photo -> no background-image div, card still renders (title-only)', () => {
      const html = renderSharePage({ ...share, intro: { ...intro, previewUrl: null } });
      expect(html).toContain('id="intro-card"');
      expect(html).not.toContain('class="ic-photo"');
    });

    it('escapes hostile facts/name so intro-card XSS is impossible', () => {
      const hostile = {
        ...intro,
        field_values: { full_name: `<script>alert(1)</script>`, position: `"><img src=x onerror=alert(2)>` },
      };
      const html = renderSharePage({ ...share, intro: hostile });
      expect(html).not.toContain('<script>alert(1)');
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      const scriptOpens = (html.match(/<script/g) || []).length;
      expect(scriptOpens).toBe(1);
    });

    it('T6960: animations are gated behind .play; JS preloads the photo (8s cap) before starting', () => {
      const html = renderSharePage({ ...share, intro });
      // Base rules carry NO animation — the JS adds .play once the photo has
      // preloaded (or the cap fires), so the 3.5s card can't run photoless.
      expect(html).toContain('.ic-photo{position:absolute;inset:0;background-size:cover;background-position:center}');
      expect(html).toContain('#intro-card.play .ic-photo{animation:icPush');
      expect(html).toContain('#intro-card.play .ic-text{animation:icFade');
      expect(html).toContain('#intro-card.play .ic-flash{animation:icFlash');
      expect(html).toContain('setTimeout(icStart,8000)');
      expect(html).toContain('icImg.onload');
      // The hide-timer moved inside icStart — it must not start at parse.
      expect(html).toContain('function icStart()');
    });

    it('T6970: the card is sized to the video box (icSize on load/metadata/resize)', () => {
      const html = renderSharePage({ ...share, intro });
      expect(html).toContain('function icSize()');
      expect(html).toContain('v.getBoundingClientRect()');
      expect(html).toContain('v.addEventListener("loadedmetadata",icSize)');
      expect(html).toContain('window.addEventListener("resize",icSize)');
    });

    it('T6960: photoless intro starts immediately (empty icPhoto takes the else branch)', () => {
      const html = renderSharePage({ ...share, intro: { ...intro, previewUrl: null } });
      expect(html).toContain('var icPhoto=""');
      expect(html).toContain('else{icStart()}');
    });

    it('T6960: a hostile previewUrl cannot break out of the inline script', () => {
      const hostile = { ...intro, previewUrl: 'https://x/a.jpg?</script><script>alert(9)</script>' };
      const html = renderSharePage({ ...share, intro: hostile });
      expect(html).not.toContain('</script><script>alert(9)');
      expect(html).toContain('\\u003c/script'); // JSON-escaped inside the JS literal
      const scriptOpens = (html.match(/<script/g) || []).length;
      expect(scriptOpens).toBe(1);
    });

    it('stays well under the 15KB budget even with an intro', () => {
      const html = renderSharePage({ ...share, intro });
      const bytes = new TextEncoder().encode(html).length;
      expect(bytes).toBeLessThan(15 * 1024);
    });

    it('T6970: executing the emitted JS against a fake layout pins the card to the video box, scales type, and runs the play/hide sequence', () => {
      // Behavioral (reviewer MINOR-4): source-text assertions can't catch
      // inverted math or mis-wired listeners — run the real inline JS in
      // jsdom against stubbed geometry. Photoless card -> the .play branch
      // fires immediately (no Image() involved).
      vi.useFakeTimers();
      try {
        document.body.innerHTML = '<main><video id="v"></video></main>';
        const { html: cardHtml, js } = renderIntroCard({
          card: { shown_fields: ['position'], duration: 3.5 },
          previewUrl: null,
          field_values: { full_name: 'Jordan Vega', position: 'Point Guard' },
        });
        const main = document.querySelector('main');
        main.insertAdjacentHTML('beforeend', cardHtml);
        const v = document.getElementById('v');
        // Portrait 9:16 video pillarboxed in a wide main.
        v.getBoundingClientRect = () => ({ left: 350, top: 40, width: 300, height: 533 });
        main.getBoundingClientRect = () => ({ left: 0, top: 40, width: 1000, height: 600 });
        v.play = vi.fn();
        new Function('v', js)(v);

        const ic = document.getElementById('intro-card');
        expect(ic.style.left).toBe('350px');
        expect(ic.style.top).toBe('0px');
        expect(ic.style.width).toBe('300px');
        expect(ic.style.height).toBe('533px');
        expect(ic.style.right).toBe('auto');
        expect(ic.querySelector('.ic-name').style.fontSize).toBe('18px'); // min(28, 300*.06)
        expect(ic.querySelector('.ic-fact').style.fontSize).toBe('10px'); // min(15, 300*.034)
        // Photoless -> started immediately; after the (fallback 4s) duration
        // + 60ms grace the card hides and the video plays.
        expect(ic.classList.contains('play')).toBe(true);
        expect(v.play).not.toHaveBeenCalled();
        vi.advanceTimersByTime(4100);
        expect(ic.classList.contains('hide')).toBe(true);
        expect(v.play).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
        document.body.innerHTML = '';
      }
    });
  });

  describe('branded end-card (T3950 playback compositing)', () => {
    it('CTA has exact spec text and correct UTM href', () => {
      const html = renderSharePage(share);
      expect(html).toContain('id="end-card"');
      expect(html).toContain('Make your own reel at www.reelballers.com');
      expect(html).toContain('utm_source=share_endcard&amp;utm_medium=viral&amp;utm_campaign=reel_endcard');
    });

    it('secondary row contains Made With + Reel + emblem + Ballers', () => {
      const html = renderSharePage(share);
      expect(html).toContain('Made With');
      expect(html).toContain('>Reel<');
      expect(html).toContain('>Ballers<');
      expect(html).toContain('id="emblem"');
      expect(html).toContain('aria-label="Replay"');
    });

    it('no headline and no bottom link — URL lives in CTA text only', () => {
      const html = renderSharePage(share);
      expect(html).not.toContain('Your athlete deserves');
      expect(html).not.toContain('ec-hl');
      expect(html).not.toContain('ec-ql');
    });

    it('emblem replay wired to emblem id, not a ghost "replay" id', () => {
      const html = renderSharePage(share);
      expect(html).toContain('getElementById("emblem")');
      expect(html).not.toContain('getElementById("replay")');
      expect(html).toContain('classList.remove("show")');
      expect(html).toContain('v.currentTime=0');
      expect(html).toContain('v.play()');
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

    it('page still fits under 15KB with the end-card included', () => {
      const html = renderSharePage(share);
      const bytes = new TextEncoder().encode(html).length;
      expect(bytes).toBeLessThan(15 * 1024);
    });
  });
});
