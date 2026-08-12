import { createRoot } from 'react-dom/client';
import '../index.css'; // Tailwind — without it every class is inert (0px measures)
import { IntroCardEditorContainer } from '../components/introcards/IntroCardEditorContainer';
import { useIntroCardStore, useProfileStore, useCurrentProfile } from '../stores';

/**
 * T5205 / T6640 — DEV-ONLY real-browser harness for the intro card editor.
 *
 * Mounts the REAL IntroCardEditorContainer (+ Stage + Rail) driven by the REAL
 * Zustand stores, with only the NETWORK actions stubbed to stay local (no
 * backend in the sandbox — same constraint and precedent as T5643/T5610's
 * harnesses). Every gesture therefore exercises the real optimistic-store
 * path, the real focal/zoom math against the real boundingBox, and the real
 * Tailwind layout. T6640 removed the per-slot styling editor from the card
 * rail (the shared `TextSpecEditor` no longer mounts here at all — decision 12
 * makes typography template-owned); it is still used by the Overlay text rail
 * elsewhere in the app.
 *
 * T6640 round 2 — an optional `window.__INTRODIAG_CONFIG__` (set via
 * `page.addInitScript` BEFORE navigation, so it exists when this module's
 * top-level code runs) lets a test configure the exact scenario from a COLD
 * page load (fonts not yet fetched), which matters because the preview/export
 * parity bug this harness caught (T6640) is a font-settle TIMING race —
 * mutating the store AFTER mount can land on an already-warm font and
 * silently fail to reproduce it. All fields optional; defaults reproduce the
 * harness's original T5205 scenario unchanged. (URL query params were tried
 * first but this dev server's SPA history fallback intermittently swallows
 * them before this module runs; an init-script global sidesteps that
 * entirely.)
 *   fullName            -> profile.full_name (the card title)
 *   shown                -> card.shown_fields (array, any of position/class/team)
 *   positionValue/classValue/teamValue -> profile fact values
 */
const diagConfig = (typeof window !== 'undefined' && window.__INTRODIAG_CONFIG__) || {};

// A wide (landscape) photo so a portrait 9:16 box has horizontal overflow to
// pan: left half is red, right half blue, with a marker dot, so a drag's
// direction is visually + numerically checkable.
const PHOTO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
     <rect x="0" y="0" width="160" height="180" fill="#ef4444"/>
     <rect x="160" y="0" width="160" height="180" fill="#3b82f6"/>
     <circle cx="160" cy="90" r="30" fill="#ffffff"/>
   </svg>`
);

const MOCK_CARD = {
  id: 1,
  name: 'Stafford intro',
  shown_fields: diagConfig.shown || ['position'],
  treatment: diagConfig.treatment || 'gold',
  // T6570: no title_text — the title resolves from the profile's Full Name below.
  image_key: 'intro/mock.png',
  focal_x: 0.5,
  focal_y: 0.5,
  zoom: 1.0,
  // text_elements dropped (T6640): dead column, typography is template-owned.
  duration: 3.0,
  composition: 'hero',
  previewUrl: PHOTO,
  created_at: '2026-08-05T00:00:00Z',
  updated_at: '2026-08-05T00:00:00Z',
};

const MOCK_PROFILE = {
  id: 'profile-1',
  name: 'Stafford',
  isCurrent: true,
  introConsentAt: '2026-08-05T00:00:00Z', // consented -> skip the gate
  introPhotoKey: 'intro/mock.png',
  introPhotoUrl: PHOTO,
  full_name: diagConfig.fullName || 'CHAMPION', // T6570: the card title reads from here, not a text box
  position: diagConfig.positionValue ?? 'Midfielder 6-8-10',
  class: diagConfig.classValue ?? '', // deliberately empty by default -> exercises the "unfilled fact" prompt
  team: diagConfig.teamValue ?? 'Riverside FC',
};

// Seed stores + stub network actions (keep the real optimistic patchCardLocal).
useIntroCardStore.setState({
  cards: [MOCK_CARD],
  isInitialized: true,
  isLoading: false,
  fetchCards: async () => {},
  updateCard: async (cardId, fields) => {
    // Mirror the server: presign a fresh previewUrl when the image key changes.
    const extra = 'image_key' in fields
      ? { previewUrl: fields.image_key ? PHOTO : null }
      : {};
    let updated = null;
    useIntroCardStore.setState((s) => ({
      cards: s.cards.map((c) => {
        if (c.id !== cardId) return c;
        updated = { ...c, ...fields, ...extra };
        return updated;
      }),
    }));
    return updated;
  },
});

useProfileStore.setState({
  profiles: [MOCK_PROFILE],
  currentProfileId: 'profile-1',
  isInitialized: true,
  setIntroConsent: async () => '2026-08-05T00:00:00Z',
  uploadIntroImage: async () => ({ success: true, key: 'intro/uploaded.png', previewUrl: PHOTO }),
});

function Harness() {
  const card = useIntroCardStore((s) => s.cards.find((c) => c.id === 1) || null);
  const profile = useCurrentProfile();
  if (!card || !profile) return null;
  // Reproduce IntroCardsModal.jsx's EXACT box so the harness is not more
  // generous than production: a 1024px width cap (max-w-5xl) AND a fixed 85vh
  // height whose BODY is the scroll region (flex-1 min-h-0 overflow-y-auto).
  // Without this the editor spread into the whole viewport and the h-[85vh]
  // scroll condition that produced the original "cramped rail" complaint was
  // never reproduced. Keep these classes in step with IntroCardsModal.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4">
      <div className="bg-gray-900 rounded-lg shadow-xl border border-gray-700 w-full max-w-6xl h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-white">Intro cards</h2>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <IntroCardEditorContainer
            card={card}
            profile={profile}
            onBack={() => {}}
            onEditProfile={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('introcarddiag-root')).render(<Harness />);
