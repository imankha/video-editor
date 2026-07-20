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
    // T4933 (landscape clip-editor sidebar clipped below the fold) is FIXED: the
    // desktop clip list, details editor, and add-clip form each own a scroll region
    // inside the h-dvh sidebar, so their controls stay reachable on a short
    // landscape-phone sm sidebar. The knownIssues entry was removed when the fix
    // landed (the audit self-heals — it throws if a stale entry no longer repros).
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
    // T5360 (invariant #4, coarse-pointer projects only): the icon-only playback
    // controls (shared Button size="sm" iconOnly via Controls.jsx) that collapsed to
    // ~26px on tablets. Each must render >= 44px on touch. Kept SEPARATE from
    // `actions` (the reachability set) because these are size-checked, not part of
    // T4880's reachability list — and because a nav/text control is legitimately
    // shorter than a 44px icon box. Verified present+visible+enabled at 44x44 on the
    // iPad project. (Zoom controls live in ZoomControls.jsx but are hidden in the
    // mobile/tablet Framing layout, so they are not listed here; the shared-Button
    // fix covers them on any touch layout that DOES render them.)
    touchTargets: [
      { label: 'Step backward', locator: (p) => p.locator('[title="Step backward (one frame)"]') },
      // Play/Pause share one control; its title toggles with playback state.
      { label: 'Play/Pause', locator: (p) => p.locator('[title="Play"], [title="Pause"]') },
      { label: 'Restart', locator: (p) => p.locator('[title="Restart (go to beginning)"]') },
      { label: 'Step forward', locator: (p) => p.locator('[title="Step forward (one frame)"]') },
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
    // T5430 (invariant #4, coarse-pointer projects only): Overlay-specific icon
    // controls that T5360 never covered and still collapsed to ~24px on touch.
    //
    // Only the spotlight color swatches are asserted here: they render
    // UNCONDITIONALLY in the Overlay export settings (disabled until a spotlight is
    // enabled, but always present + sized), so checking them mutates NOTHING on the
    // real fixture account. The other two T5430 controls are deliberately NOT in the
    // automated set:
    //   - "Delete region" only exists once a spotlight REGION exists, and
    //   - the player-detection timeline markers only exist with detection data.
    // Reaching either would require ADDING a spotlight in setup, which — persistence
    // being gesture-based (CLAUDE.md) — would POST a region to the seeded account and
    // corrupt the fixture. Their 44px floors (RegionLayer delete: coarse min-w/h-11;
    // DetectionMarkerLayer: a coarse 44px hit-pad) are verified on a real coarse
    // pointer / staging instead. Swatches carry the automated regression guard.
    touchTargets: [
      { label: 'Highlight color: White', locator: (p) => p.getByRole('button', { name: 'White', exact: true }) },
      { label: 'Highlight color: Cyan', locator: (p) => p.getByRole('button', { name: 'Cyan', exact: true }) },
      { label: 'Highlight color: None', locator: (p) => p.getByRole('button', { name: 'None', exact: true }) },
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
      // T5420: ProfileSportButton mounts ASYNCHRONOUSLY — it renders null until the
      // profile store finishes init (isAuthenticated && isInitialized), which lands a
      // beat after the Home shell's Games button. Checking count()/clicking immediately
      // was a race: on a slow/mobile project it read count 0 and SKIPPED with a MISLEADING
      // "single-profile account" reason (imankh is multi-profile), or clicked before the
      // button was actionable and hit a locator.click timeout. WAIT for it to render first,
      // so this only skips when the switcher is GENUINELY absent, and a real un-clickable
      // switcher surfaces as an honest failure (not a silent skip). Verified on staging:
      // once rendered, the button is clickable on desktop AND mobile (opens the modal).
      const switcher = page.getByRole('button', { name: /Switch sport or profile/i }).first();
      const rendered = await switcher.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
      if (!rendered) return { ready: false, reason: 'profile switcher never rendered (single-profile account or profile store did not initialize)' };
      await switcher.click();
      return { ready: true };
    },
    actions: [
      // The Profile-management SCREEN is the ManageProfilesModal the setup opens. Audit a
      // primary control INSIDE that modal ("+ Add Profile"), NOT the switcher button that
      // opened it — once the modal is up, the switcher is occluded by the modal, so a
      // trial-click on it fails "receives events" and read as a false click-timeout (T5420:
      // that was the reported iphone/android/tablet failure — a manifest bug auditing the
      // wrong element, NOT a product usability regression; the modal itself is reachable).
      { label: 'Add Profile', locator: (p) => p.getByRole('button', { name: /Add Profile/i }).first() },
    ],
  },
];
