import { createRoot } from 'react-dom/client';

/**
 * T6580 item 4 — TREATMENT sample matrix (dev-only, for the design decision).
 *
 * Each cell is a photo "hero" card (name + one fact over a full-bleed photo) —
 * the common case where treatment is currently a near no-op. Rows are design
 * directions; columns are the three treatments. Prototype styling is INLINE here
 * (not the real contract) purely to render comparison samples; the chosen
 * direction gets built into intro_card_geometry (+ JS mirror + export) after the
 * supervisor picks.
 */

// A photographic-ish SVG "photo" (warm-lit stadium, player silhouette) so tint /
// vignette / scrim differences are visible the way a real photo would show them.
const PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16233f"/>
      <stop offset="0.55" stop-color="#c86a2e"/>
      <stop offset="0.82" stop-color="#e6a552"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.58" r="0.5">
      <stop offset="0" stop-color="#fff4d6" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#fff4d6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#sky)"/>
  <rect y="560" width="1200" height="240" fill="#3a5a2e"/>
  <ellipse cx="600" cy="780" rx="560" ry="70" fill="#2c4622"/>
  <circle cx="600" cy="470" r="300" fill="url(#glow)"/>
  <g fill="#0e1216">
    <ellipse cx="600" cy="300" rx="40" ry="46"/>
    <path d="M552 350 q48 -22 96 0 l14 150 q-62 26 -124 0 z"/>
    <rect x="556" y="356" width="26" height="150" rx="12" transform="rotate(12 569 431)"/>
    <rect x="620" y="356" width="26" height="150" rx="12" transform="rotate(-16 633 431)"/>
    <rect x="566" y="495" width="28" height="170" rx="13"/>
    <rect x="608" y="495" width="28" height="170" rx="13" transform="rotate(8 622 580)"/>
  </g>
</svg>`);

const TREATMENTS = [
  { key: 'gold', label: 'Gold' },
  { key: 'dark', label: 'Dark' },
  { key: 'photo-forward', label: 'Photo forward' },
];

// --- Prototype look tokens per direction ------------------------------------
// CURRENT: what ships today — only the default title accent colour survives on a
// full-bleed photo (scrim is composition-owned, identical across treatments).
const CURRENT = {
  gold: { accent: '#f7e28b' },
  dark: { accent: '#e5e7eb' },
  'photo-forward': { accent: '#ffffff' },
};

// A) ACCENT + TINTED SCRIM: treatment owns the accent colour, an accent rule
// above the name, and the scrim's tint + strength.
const OPT_A = {
  gold: { accent: '#f7e28b', rule: '#f7e28b',
    scrim: 'linear-gradient(to top, rgba(28,20,6,0.92) 0%, rgba(28,20,6,0.35) 34%, rgba(28,20,6,0) 60%)' },
  dark: { accent: '#d7e3f4', rule: '#9fb6d6',
    scrim: 'linear-gradient(to top, rgba(6,11,20,0.94) 0%, rgba(6,11,20,0.4) 38%, rgba(6,11,20,0) 64%)' },
  'photo-forward': { accent: '#ffffff', rule: null,
    scrim: 'linear-gradient(to top, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.18) 30%, rgba(0,0,0,0) 52%)' },
};

// B) ACCENT BAND: treatment owns a solid lower-third band behind the text.
const OPT_B = {
  gold: { accent: '#1a1204', band: 'linear-gradient(to right, #caa63c, #f7e28b)', factColor: '#2a1e06',
    scrim: 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 40%)' },
  dark: { accent: '#ffffff', band: 'linear-gradient(to right, #17233a, #26374f)', factColor: '#cdd7e5',
    scrim: 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 40%)' },
  'photo-forward': { accent: '#ffffff', band: null, factColor: '#e8ecf2',
    scrim: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.2) 32%, rgba(0,0,0,0) 55%)' },
};

// C) PHOTO MOOD: treatment owns a colour grade (tint) + vignette + scrim + accent.
const OPT_C = {
  gold: { accent: '#f7e28b', rule: '#f7e28b',
    tint: 'linear-gradient(to top, rgba(120,70,20,0.42), rgba(150,95,30,0.14))',
    vignette: 'radial-gradient(120% 90% at 50% 42%, rgba(0,0,0,0) 52%, rgba(20,12,2,0.6) 100%)',
    scrim: 'linear-gradient(to top, rgba(24,16,4,0.9) 0%, rgba(24,16,4,0) 56%)' },
  dark: { accent: '#dbe6f5', rule: '#93accf',
    tint: 'linear-gradient(to top, rgba(20,30,48,0.5), rgba(30,42,64,0.24))',
    vignette: 'radial-gradient(120% 90% at 50% 42%, rgba(0,0,0,0) 44%, rgba(2,6,12,0.72) 100%)',
    scrim: 'linear-gradient(to top, rgba(5,9,16,0.92) 0%, rgba(5,9,16,0) 58%)' },
  'photo-forward': { accent: '#ffffff', rule: null,
    tint: null, vignette: null,
    scrim: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.16) 30%, rgba(0,0,0,0) 52%)' },
};

const TITLE_FONT = '"Arial Narrow", "Oswald", system-ui, sans-serif';

function Card({ tok, direction }) {
  const W = 250, H = 444;
  return (
    <div style={{
      position: 'relative', width: W, height: H, overflow: 'hidden',
      borderRadius: 10, background: '#04060a', boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
    }}>
      <img src={PHOTO} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      {tok.tint && <div style={{ position: 'absolute', inset: 0, background: tok.tint, mixBlendMode: 'multiply' }} />}
      {tok.vignette && <div style={{ position: 'absolute', inset: 0, background: tok.vignette }} />}
      {tok.scrim && <div style={{ position: 'absolute', inset: 0, background: tok.scrim }} />}
      {tok.band && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 132, background: tok.band }} />
      )}
      <div style={{ position: 'absolute', left: 20, right: 20, bottom: 26 }}>
        {tok.rule && <div style={{ width: 40, height: 4, background: tok.rule, borderRadius: 2, marginBottom: 10 }} />}
        <div style={{
          fontFamily: TITLE_FONT, fontWeight: 800, fontSize: 34, lineHeight: 1, letterSpacing: 0.5,
          color: tok.accent, textTransform: 'uppercase',
          textShadow: direction === 'B' && tok.band ? 'none' : '0 2px 8px rgba(0,0,0,0.55)',
        }}>Jordan Vega</div>
        <div style={{
          fontFamily: TITLE_FONT, fontWeight: 600, fontSize: 15, marginTop: 6, letterSpacing: 1.2,
          color: tok.factColor || '#ffffff', textTransform: 'uppercase',
          textShadow: direction === 'B' && tok.band ? 'none' : '0 1px 5px rgba(0,0,0,0.6)',
        }}>Midfielder</div>
      </div>
    </div>
  );
}

function Row({ title, subtitle, toks, direction }) {
  return (
    <div style={{ marginBottom: 34 }}>
      <div style={{ color: '#fff', fontFamily: 'system-ui', fontSize: 19, fontWeight: 700 }}>{title}</div>
      <div style={{ color: '#9aa4b2', fontFamily: 'system-ui', fontSize: 13, marginBottom: 12, maxWidth: 820 }}>{subtitle}</div>
      <div style={{ display: 'flex', gap: 22 }}>
        {TREATMENTS.map((t) => (
          <div key={t.key} data-testid={`cell-${direction}-${t.key}`}>
            <Card tok={toks[t.key]} direction={direction} />
            <div style={{ color: '#c7cdd6', fontFamily: 'system-ui', fontSize: 13, textAlign: 'center', marginTop: 8 }}>{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  return (
    <div style={{ padding: 28 }} data-testid="samples-root">
      <div style={{ color: '#fff', fontFamily: 'system-ui', fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
        Treatment directions — photo hero card
      </div>
      <div style={{ color: '#9aa4b2', fontFamily: 'system-ui', fontSize: 14, marginBottom: 26, maxWidth: 900 }}>
        Same card + same photo under Gold / Dark / Photo forward. Row 1 is what ships today
        (the scrim is composition-owned, so only the title colour changes). Rows A-C are candidate
        directions where the treatment also owns what you SEE on a photo card.
      </div>
      <div data-testid="row-current">
        <Row direction="current" title="CURRENT (ships today)"
          subtitle="Only the default title accent colour differs; the backdrop is hidden behind the full-bleed photo and the scrim is identical. This is the near no-op the user reported."
          toks={CURRENT} />
      </div>
      <div data-testid="row-A">
        <Row direction="A" title="A - Accent + tinted scrim"
          subtitle="Treatment owns the accent colour, a short accent rule above the name, and the scrim's TINT + strength. Subtle/editorial; safe, cheap on both preview and export."
          toks={OPT_A} />
      </div>
      <div data-testid="row-B">
        <Row direction="B" title="B - Accent band"
          subtitle="Treatment owns a solid lower-third band (Gold/Dark) behind the text; Photo forward keeps a clean scrim. Bold/broadcast; highest contrast between treatments."
          toks={OPT_B} />
      </div>
      <div data-testid="row-C">
        <Row direction="C" title="C - Photo mood (tint + vignette)"
          subtitle="Treatment owns a colour grade + vignette + scrim + accent. Gold=warm/premium, Dark=cool/moody, Photo forward=clean/natural. Most dramatic; changes the whole card."
          toks={OPT_C} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
