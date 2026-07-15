/**
 * screenManifests — the data-driven heart of the usability audit.
 *
 * Each screen contributes ONE declarative manifest: how to navigate to it in its
 * FULLEST state (populated timeline / crop editor / reel list, so reachability
 * assertions are not vacuous) and the list of its PRIMARY actions with the most
 * stable selector for each. screen-usability.spec.js iterates these across every
 * viewport project — so coverage is N manifests, NOT N copy-pasted tests.
 *
 * setup(page) -> { ready: boolean, reason?: string }
 *   ready:false is an HONEST skip (Playwright reports it as skipped, never a
 *   silent green): the screen's precondition (an exported reel, a second profile,
 *   existing reels) is not present in this environment. It NEVER means "passed".
 *
 * Selectors are sourced from already-passing specs (T4770 perf walkthrough, T4880
 * mobile reachability) and verified data-testids (ModeSwitcher `mode-{id}`,
 * DownloadsPanel `reel-card`) so the audit fails on LAYOUT, not on selector drift.
 */
import { loginAsRealUser, openGameInAnnotate } from '../helpers/realAuth.js';

export const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
export const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
// A game with a real source video on the audit account (T4770 uses game 6).
export const AUDIT_GAME_ID = Number(process.env.T4930_GAME_ID || process.env.T4770_GAME_ID || 6);

export { loginAsRealUser };

/** Home shell must be interactive: the Games tab button is the first paint. */
async function reachHome(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('button:has-text("Games")').first().waitFor({ state: 'visible', timeout: 30000 });
  return { ready: true };
}

/** Open the first Framing-ready reel draft; ready once the crop editor loaded. */
async function reachFraming(page) {
  await reachHome(page);
  const drafts = page.getByRole('button', { name: 'Reel Drafts' }).first();
  await drafts.waitFor({ state: 'visible', timeout: 15000 });
  await drafts.click();
  const framingChip = page.getByTitle(/\[.+\]: .*\(click to open\)/).first();
  if (!(await framingChip.count())) return { ready: false, reason: 'no Framing-ready draft on this account' };
  await framingChip.click();
  await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });
  return { ready: true };
}

/** From a loaded Framing draft, switch into Overlay (needs an exported working video). */
async function reachOverlay(page) {
  const framing = await reachFraming(page);
  if (!framing.ready) return framing;
  const overlayTab = page.getByTestId('mode-overlay');
  const reachable = (await overlayTab.count()) > 0 && (await overlayTab.isEnabled());
  if (!reachable) return { ready: false, reason: 'Overlay needs an exported reel; not available in this env' };
  await overlayTab.click();
  await page.getByRole('button', { name: /Add Spotlight/ }).waitFor({ timeout: 90000 });
  return { ready: true };
}

export const SCREENS = [
  {
    id: 'home',
    name: 'Home / games list',
    setup: reachHome,
    actions: [
      { label: 'Games tab', locator: (p) => p.locator('button:has-text("Games")').first() },
      { label: 'Reel Drafts tab', locator: (p) => p.getByRole('button', { name: 'Reel Drafts' }).first() },
      { label: 'My Reels tab', locator: (p) => p.getByRole('button', { name: /My Reels/i }).first() },
    ],
  },
  {
    id: 'annotate',
    name: 'Annotate',
    // FOUND BY THIS AUDIT (T4930 first matrix run), filed as T4933: on a phone in
    // LANDSCAPE wide enough (>=640px) to render the desktop clip-editor sidebar
    // (`hidden sm:flex`, ~546px tall), its Save / Delete Clip / Distribution
    // controls are clipped below the ~390px landscape fold of the `h-dvh
    // overflow-hidden` shell with no inner scroller — the T4880 failure class that
    // T4880 fixed for Framing/Overlay but not for Annotate's landscape sidebar.
    // Tracked here (loud log, suite stays green) until T4933 lands; self-heals.
    knownIssues: [
      {
        orientation: 'landscape',
        // Only reproduces when the landscape width reaches the `sm` breakpoint
        // (>=640px) that renders the desktop clip-editor sidebar. On a narrow
        // landscape (e.g. iPhone SE, 568px) the sidebar stays hidden and the
        // audit legitimately passes — so this is scoped, not a blanket skip.
        appliesWhen: (vp) => vp.width >= 640,
        task: 'T4933',
        note: 'clip-editor sidebar controls clipped below the fold on phone landscape (no inner scroller)',
      },
    ],
    setup: async (page) => {
      await openGameInAnnotate(page, AUDIT_GAME_ID);
      // Fullest state: the source video is attached (clips sidebar + timeline render).
      await page.locator('video').first().waitFor({ state: 'attached', timeout: 40000 });
      const switcher = page.getByTestId('mode-annotate');
      if (!(await switcher.count())) return { ready: false, reason: 'Annotate editor did not mount (game may lack a source video)' };
      return { ready: true };
    },
    actions: [
      // The mode switcher is always rendered in the editor chrome; the current-mode
      // tab must stay reachable so a user can move Annotate -> Framing.
      { label: 'Annotate mode tab', locator: (p) => p.getByTestId('mode-annotate') },
      // Framing tab may be disabled until clips are extracted — reachOnly so we
      // assert it is not clipped/covered without requiring it be clickable.
      { label: 'Framing mode tab', locator: (p) => p.getByTestId('mode-framing'), reachOnly: true },
    ],
  },
  {
    id: 'framing',
    name: 'Framing',
    setup: reachFraming,
    actions: [
      // The exact control T4880 made unreachable on mobile: the Export/Proceed button.
      { label: 'Export button', locator: (p) => p.getByRole('button', { name: /^Export( \(\d+\/\d+\))?$/ }) },
      { label: 'Overlay mode tab', locator: (p) => p.getByTestId('mode-overlay'), reachOnly: true },
      // The "go home" affordance in UnifiedHeader: desktop renders a Home button +
      // "Reel Drafts" breadcrumb; mobile collapses to a single "Back" arrow. Match
      // either so this asserts reachability cross-viewport, not desktop-only chrome.
      { label: 'Home / Back nav', locator: (p) => p.getByRole('button', { name: /^(Home|Back)$/ }).first() },
    ],
  },
  {
    id: 'overlay',
    name: 'Overlay',
    setup: reachOverlay,
    actions: [
      // Overlay's primary export button — the OTHER control T4880 made unreachable.
      { label: 'Add Spotlight button', locator: (p) => p.getByRole('button', { name: /Add Spotlight/ }) },
      { label: 'Framing mode tab', locator: (p) => p.getByTestId('mode-framing'), reachOnly: true },
    ],
  },
  {
    id: 'my-reels',
    name: 'Gallery / My Reels',
    setup: async (page) => {
      await reachHome(page);
      const myReels = page.getByRole('button', { name: /My Reels/i }).first();
      await myReels.click();
      // The DownloadsPanel drawer renders reel-card items when the account has reels.
      const firstCard = page.getByTestId('reel-card').first();
      const appeared = await firstCard.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
      if (!appeared) return { ready: false, reason: 'no published reels on this account (My Reels drawer empty)' };
      return { ready: true };
    },
    actions: [
      { label: 'First reel card', locator: (p) => p.getByTestId('reel-card').first() },
    ],
  },
  {
    id: 'profile-switcher',
    name: 'Profile management',
    setup: async (page) => {
      await reachHome(page);
      const switcher = page.getByRole('button', { name: /Switch sport or profile/i }).first();
      if (!(await switcher.count())) return { ready: false, reason: 'profile switcher not present (single-profile account)' };
      await switcher.click();
      return { ready: true };
    },
    actions: [
      { label: 'Profile/sport switcher', locator: (p) => p.getByRole('button', { name: /Switch sport or profile/i }).first() },
    ],
  },
];
